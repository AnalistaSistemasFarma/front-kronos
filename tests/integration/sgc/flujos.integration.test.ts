import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import {
  getPoolMembers,
  grantAuthorizationTypeUser,
  listAuthorizationInbox,
  listAuthorizationTypes,
  revokeAuthorizationTypeUser,
  saveAuthorizationType,
} from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { createInitialDocument, type SgcUploader } from '../../../lib/sgc/db/documents';
import {
  createDraftVersion,
  createFlowProcess,
  discardDraftVersion,
  getCurrentFlowVersion,
  getFlowVersion,
  listConfigChanges,
  listFlowProcesses,
  loadDefinition,
  parseOptions,
  publishFlowVersion,
  saveDraftDefinition,
  starterDefinition,
  updateFlowProcess,
} from '../../../lib/sgc/db/flows';
import { addMatrixEntry, deactivateMatrixEntry, listMatrix, suggestForTarget } from '../../../lib/sgc/db/matrix';
import {
  addNote,
  cancelRequest,
  companyOfRequest,
  createRequest,
  decideTask,
  getAttachmentForDownload,
  getRequestDetail,
  getRequestForm,
  getTaskDetail,
  listEligibleUsers,
  listMyRequests,
  listTaskInbox,
  reassignTask,
  requestOfTask,
  saveFormValues,
  setSigners,
  taskOfAuthorization,
  uploadAttachment,
  withdrawAttachment,
} from '../../../lib/sgc/db/requests';
import { normalizeFlowDefinition } from '../../../lib/sgc/flows/definition';
import { SGC_DOCUMENT_FLOW_V1 } from '../../../lib/sgc/flows/documentFlow';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';
import { currentDraftInTx } from '../../../lib/sgc/db/signatureRecord';

/**
 * Sprint 2 contra un SQL Server REAL (efímero en CI): motor de flujos
 * validados (definiciones versionadas, registro de cambios de solo
 * inserción), solicitud documental de punta a punta (elaboración → revisión
 * con 2 revisores en paralelo → aprobación en orden + verificación de
 * Calidad), cambio de firmantes con registro, devolución, reasignación,
 * cancelación, Autorizaciones SGC y permisos.
 *
 * Usa una empresa PROPIA (id 50) sembrada con los mismos SQL del pase (S1 y
 * S2, cambiando solo el id), para no interferir con las demás suites que
 * comparten la base.
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 2 · flujos, tareas y autorizaciones con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 50;
  const E = {
    elab: 'elab.s2@onelatampharma.com',
    elab2: 'elab2.s2@onelatampharma.com',
    rev1: 'rev1.s2@onelatampharma.com',
    rev2: 'rev2.s2@onelatampharma.com',
    apr1: 'apr1.s2@onelatampharma.com',
    cal: 'calidad.s2@onelatampharma.com',
    flujos: 'flujos.s2@onelatampharma.com',
    lector: 'lector.s2@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.1.1.1', userAgent: 'vitest' });
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const uploads: { segments: string[]; fileName: string }[] = [];
  const upload: SgcUploader = async (segments, fileName) => {
    uploads.push({ segments, fileName });
    return { id: `it-${uploads.length}` };
  };
  const word = (text = 'borrador') => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new TextEncoder().encode(`PK\u0003\u0004${text}`) });
  const accessOf = async (email: string): Promise<SgcCompanyAccess> => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  // Sprint 3: aprobar un paso con firma exige la firma electrónica (ya reautenticada; aquí se prueba el motor).
  const sig = async (idTask: number) => {
    const t = await prisma.sgcTask.findUniqueOrThrow({ where: { id_task: idTask }, include: { taskDef: true } });
    const d = (await currentDraftInTx(prisma as never, t.id_request))!;
    return { meaning: t.taskDef.signature_meaning as 'elaboro', reason: 'Firma de la prueba de integración', signerName: null, verifiedDraft: { kind: d.kind, ref: d.ref, name: d.name, sha256: d.sha256 }, uploadEvidence: upload, now: new Date() };
  };
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: { orderBy: { sign_order: 'asc' } } } });

  let procGC = 0;
  let typePR = 0;
  let docId = 0;
  let req1 = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S2 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({
      where: { id_company: CO },
      create: { id_company: CO, is_active: true, storage_root: 'SGC/S2', activated_by: 'ci', activated_at: new Date() },
      update: {},
    });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S2 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const grants: [string, string[]][] = [
      [E.elab, ['gestion']],
      [E.elab2, ['gestion']],
      [E.rev1, ['gestion']],
      [E.rev2, ['gestion']],
      [E.apr1, ['gestion']],
      [E.cal, ['calidad']],
      [E.flujos, ['flujos']],
      [E.lector, ['lectura']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase() } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s1-maestros-olp.sql'));
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
  });

  afterAll(async () => {
    // La empresa de prueba no queda activa: otras suites verifican que solo OLP lo está.
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-026] las 17 tablas del S2 viven en `sgc`, con triggers de solo inserción e índice de una sola versión vigente', async () => {
    const rows = await prisma.$queryRaw<{ tabla: string; esquema: string }[]>`
      SELECT t.name AS tabla, s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name IN ('flow_process','flow_version','flow_task_def','flow_transition','flow_form_field','responsible_matrix','config_change_log','request','request_signer','task','task_assignee','form_value','interaction','attachment','authorization_type','authorization_type_user','authorization')`;
    expect(rows).toHaveLength(17);
    expect(new Set(rows.map((r) => r.esquema))).toEqual(new Set(['sgc']));
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('config_change_log_solo_insercion','interaction_solo_insercion') ORDER BY name`;
    expect(trg.map((t) => t.name)).toEqual(['config_change_log_solo_insercion', 'interaction_solo_insercion']);
    const idx = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sys.indexes WHERE name = 'flow_version_una_vigente_uq' AND has_filter = 1 AND is_unique = 1`;
    expect(Number(idx[0].n)).toBe(1);
  });

  it('[SGC-REQ-027] el flujo documental v1 se siembra con el SQL del pase (idempotente) y coincide con la definición del código', async () => {
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s2-flujo-documental-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s2-flujo-documental-olp.sql'));
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'DOC');
    expect(process.name).toBe('Gestión documental');
    expect(version).toMatchObject({ version_number: 1, status: 'vigente' });
    const def = await loadDefinition(prisma, version.id_flow_version);
    expect(normalizeFlowDefinition(def)).toEqual(normalizeFlowDefinition(JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V1))));
    expect(await prisma.sgcFlowVersion.count({ where: { id_flow_process: process.id_flow_process } })).toBe(1);
    const types = await listAuthorizationTypes(prisma, CO);
    expect(types.map((t) => t.code).sort()).toEqual(['SGC-APROBACION', 'SGC-VERIF-CALIDAD']);
    expect(types.find((t) => t.code === 'SGC-VERIF-CALIDAD')!.members.map((m) => m.email)).toEqual(['nicolas.rivera@gsslatam.com']);
    const matrix = await listMatrix(prisma, CO);
    expect(matrix).toHaveLength(4);
    expect(matrix.every((m) => m.isExample && m.cargoName)).toBe(true);
    const log = await listConfigChanges(prisma, CO);
    expect(log.map((c) => c.action)).toEqual(expect.arrayContaining(['proceso.creado', 'version.publicada', 'autorizacion.tipo_creado', 'autorizacion.grupo_agregado', 'matriz.fila_agregada']));
    expect(log.length).toBe(1 + 1 + 2 + 1 + 4);
    expect(parseOptions('no-json')).toEqual([]);
    expect(parseOptions('{"a":1}')).toEqual([]);
  });

  it('[SGC-REQ-026] el registro de cambios y el historial de interacciones son de solo inserción: UPDATE y DELETE los rechaza la base', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[config_change_log] SET reason = N'x'`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[config_change_log]`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[interaction]`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[interaction] SET body = N'x'`)).rejects.toThrow(/solo inserción/);
  });

  it('[SGC-REQ-024][SGC-REQ-025][SGC-REQ-026] se crea y se edita un flujo sin código: borrador → vigente → nueva versión → retirada, todo en el registro', async () => {
    const who = actor(E.flujos);
    await expect(createFlowProcess(prisma, CO, { code: 'x', name: 'X', reason: 'motivo válido' }, who)).rejects.toThrow(/Código del flujo/);
    await expect(createFlowProcess(prisma, CO, { code: 'CC', name: '', reason: 'motivo válido' }, who)).rejects.toThrow(/nombre del flujo/);
    await expect(createFlowProcess(prisma, CO, { code: 'CC', name: 'Control de cambios', reason: 'no' }, who)).rejects.toThrow(/motivo/);
    const created = await createFlowProcess(prisma, CO, { code: 'cc', name: 'Control de cambios', category: 'control_cambios', description: 'Flujo validado de cambios', reason: 'Segundo flujo validado (piloto)', changeReference: 'CC-001' }, who);
    await expect(createFlowProcess(prisma, CO, { code: 'CC', name: 'Otro', category: 'inventada', reason: 'duplicado de código' }, who)).rejects.toMatchObject({ status: 409 });

    const v1 = await getFlowVersion(prisma, CO, created.idFlowVersion);
    expect(v1.version).toMatchObject({ versionNumber: 1, status: 'borrador' });
    expect(v1.definition).toEqual(starterDefinition());
    const def = JSON.parse(JSON.stringify(v1.definition));
    def.tasks.splice(1, 0, { key: 'evaluacion', name: 'Evaluación del cambio', stepOrder: 1, role: 'revisor', assignment: 'firmantes', multiAssignee: true, signingModeDefault: 'orden', signatureMeaning: 'reviso', isAuthorization: true, authorizationTypeCode: 'SGC-APROBACION' });
    def.tasks[2].stepOrder = 2;
    def.transitions[0].to = 'evaluacion';
    def.transitions.push({ from: 'evaluacion', action: 'aprobar', to: 'ejecucion' }, { from: 'evaluacion', action: 'devolver', to: 'solicitud' });
    def.formFields.push({ key: 'impacto', label: 'Impacto', type: 'seleccion', options: ['Bajo', 'Alto'], required: true });
    await expect(saveDraftDefinition(prisma, CO, created.idFlowVersion, { definition: def, reason: 'x' }, who)).rejects.toThrow(/motivo/);
    const bad = JSON.parse(JSON.stringify(def));
    bad.tasks[1].authorizationTypeCode = 'NO-EXISTE';
    await expect(saveDraftDefinition(prisma, CO, created.idFlowVersion, { definition: bad, reason: 'tipo inexistente' }, who)).rejects.toThrow(/NO-EXISTE/);
    const saved = await saveDraftDefinition(prisma, CO, created.idFlowVersion, { definition: def, reason: 'Agrega la evaluación del cambio', changeReference: 'CC-001' }, who);
    expect(saved.changes.join(' ')).toContain('Tarea agregada: Evaluación del cambio');
    expect((await loadDefinition(prisma, created.idFlowVersion)).tasks.map((t) => t.key)).toEqual(['solicitud', 'evaluacion', 'ejecucion']);

    const pub = await publishFlowVersion(prisma, CO, created.idFlowVersion, { reason: 'Aprobado por Calidad', changeReference: 'CC-001' }, who);
    expect(pub).toMatchObject({ published: 1, retired: null });
    await expect(saveDraftDefinition(prisma, CO, created.idFlowVersion, { definition: def, reason: 'editar la vigente' }, who)).rejects.toMatchObject({ status: 409 });
    await expect(publishFlowVersion(prisma, CO, created.idFlowVersion, { reason: 'publicar otra vez' }, who)).rejects.toMatchObject({ status: 409 });
    await expect(discardDraftVersion(prisma, CO, created.idFlowVersion, { reason: 'descartar vigente' }, who)).rejects.toMatchObject({ status: 409 });

    const d2 = await createDraftVersion(prisma, CO, created.idFlowProcess, { reason: 'Ajuste de días objetivo' }, who);
    expect(d2.versionNumber).toBe(2);
    await expect(createDraftVersion(prisma, CO, created.idFlowProcess, { reason: 'otro borrador' }, who)).rejects.toMatchObject({ status: 409 });
    expect((await loadDefinition(prisma, d2.idFlowVersion)).tasks.map((t) => t.key)).toEqual(['solicitud', 'evaluacion', 'ejecucion']);
    const def2 = await loadDefinition(prisma, d2.idFlowVersion);
    def2.tasks[1].targetDays = 3;
    await saveDraftDefinition(prisma, CO, d2.idFlowVersion, { definition: def2, reason: 'Evaluación en 3 días' }, who);
    const pub2 = await publishFlowVersion(prisma, CO, d2.idFlowVersion, { reason: 'Publica la v2' }, who);
    expect(pub2).toMatchObject({ published: 2, retired: 1 });
    const list = (await listFlowProcesses(prisma, CO)).find((f) => f.code === 'CC')!;
    expect(list.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, 'vigente'],
      [1, 'retirada'],
    ]);
    expect(list.currentVersion).toBe(2);
    // La base garantiza UNA sola vigente por proceso.
    await expect(prisma.$executeRawUnsafe(`SET QUOTED_IDENTIFIER ON; UPDATE [sgc].[flow_version] SET status = N'vigente' WHERE id_flow_version = ${created.idFlowVersion}`)).rejects.toThrow();

    const d3 = await createDraftVersion(prisma, CO, created.idFlowProcess, { reason: 'Borrador que se descarta' }, who);
    expect((await discardDraftVersion(prisma, CO, d3.idFlowVersion, { reason: 'No se necesita' }, who)).discarded).toBe(3);
    const upd = await updateFlowProcess(prisma, CO, created.idFlowProcess, { name: 'Control de cambios validado', description: '', isActive: true, reason: 'Nombre oficial' }, who);
    expect(upd).toEqual({ name: 'Control de cambios validado', description: null, isActive: true });
    await expect(updateFlowProcess(prisma, CO, created.idFlowProcess, { name: ' ', reason: 'nombre vacío' }, who)).rejects.toThrow(/nombre/);
    await expect(updateFlowProcess(prisma, CO, 999999, { reason: 'no existe el flujo' }, who)).rejects.toMatchObject({ status: 404 });
    await expect(createDraftVersion(prisma, 3, created.idFlowProcess, { reason: 'otra empresa' }, who)).rejects.toMatchObject({ status: 404 });
    await expect(getFlowVersion(prisma, 3, created.idFlowVersion)).rejects.toMatchObject({ status: 404 });

    const log = await listConfigChanges(prisma, CO, { idFlowProcess: created.idFlowProcess });
    expect(log.map((c) => c.action).reverse()).toEqual([
      'proceso.creado',
      'version.definicion_editada',
      'version.publicada',
      'version.borrador_creado',
      'version.definicion_editada',
      'version.publicada',
      'version.borrador_creado',
      'version.borrador_descartado',
      'proceso.editado',
    ]);
    const edit = log.find((c) => c.action === 'version.definicion_editada' && c.idFlowVersion === created.idFlowVersion)!;
    expect(edit).toMatchObject({ actorEmail: E.flujos, reason: 'Agrega la evaluación del cambio', changeReference: 'CC-001', ip: '10.1.1.1' });
    expect((edit.before as { tasks: unknown[] }).tasks).toHaveLength(2);
    expect((edit.after as { definition: { tasks: unknown[] } }).definition.tasks).toHaveLength(3);
    expect((await listConfigChanges(prisma, CO, { entity: 'flow_process', take: 1 })).length).toBe(1);
  });

  it('[SGC-REQ-034] la matriz por proceso × tipo (persona o cargo) solo sugiere; nada se borra, se desactiva con motivo', async () => {
    const who = actor(E.cal);
    await expect(addMatrixEntry(prisma, CO, { role: 'jefe', reason: 'rol inválido' }, who)).rejects.toThrow(/Rol inválido/);
    await expect(addMatrixEntry(prisma, CO, { role: 'revisor', reason: 'sin persona ni cargo' }, who)).rejects.toThrow(/persona/);
    await expect(addMatrixEntry(prisma, CO, { role: 'revisor', userEmail: E.rev1, cargoName: 'Jefe', reason: 'ambas cosas' }, who)).rejects.toThrow(/no ambas/);
    await expect(addMatrixEntry(prisma, CO, { role: 'revisor', userEmail: 'nadie@x.co', reason: 'usuario inexistente' }, who)).rejects.toThrow(/No existe/);
    await expect(addMatrixEntry(prisma, CO, { role: 'revisor', idProcess: 999999, cargoName: 'X', reason: 'proceso ajeno' }, who)).rejects.toThrow(/proceso/);
    await expect(addMatrixEntry(prisma, CO, { role: 'revisor', idDocumentType: 999999, cargoName: 'X', reason: 'tipo ajeno' }, who)).rejects.toThrow(/tipo documental/);
    await expect(addMatrixEntry(prisma, CO, { role: 'revisor', idProcess: 'x', cargoName: 'X', reason: 'id inválido' }, who)).rejects.toThrow(/inválido/);
    const r1 = await addMatrixEntry(prisma, CO, { role: 'revisor', idProcess: procGC, idDocumentType: typePR, userEmail: E.rev1.toUpperCase(), sortOrder: 1, reason: 'Matriz de Calidad' }, who);
    await addMatrixEntry(prisma, CO, { role: 'revisor', idProcess: procGC, idDocumentType: typePR, userEmail: E.rev2, sortOrder: 2, reason: 'Matriz de Calidad' }, who);
    const s = await suggestForTarget(prisma, CO, { idProcess: procGC, idDocumentType: typePR });
    // Aplica también la fila de EJEMPLO por cargo que siembra el SQL para GC × PR.
    expect(s.find((x) => x.role === 'revisor')).toMatchObject({ specificity: 3, people: [E.rev1, E.rev2], cargos: ['Coordinador(a) de Aseguramiento de Calidad'], fromExample: true });
    await deactivateMatrixEntry(prisma, CO, r1.id, { reason: 'Cambio de cargo' }, who);
    await expect(deactivateMatrixEntry(prisma, CO, r1.id, { reason: 'otra vez' }, who)).rejects.toMatchObject({ status: 409 });
    await expect(deactivateMatrixEntry(prisma, 3, r1.id, { reason: 'otra empresa' }, who)).rejects.toMatchObject({ status: 404 });
    expect((await suggestForTarget(prisma, CO, { idProcess: procGC, idDocumentType: typePR })).find((x) => x.role === 'revisor')!.people).toEqual([E.rev2]);
    expect((await listMatrix(prisma, CO, true)).find((m) => m.id === r1.id)).toMatchObject({ isActive: false, processCode: 'GC', documentTypeCode: 'PR' });
    const log = await listConfigChanges(prisma, CO, { entity: 'responsible_matrix' });
    expect(log[0]).toMatchObject({ action: 'matriz.fila_desactivada', reason: 'Cambio de cargo', actorEmail: E.cal });
  });

  it('[SGC-REQ-033][SGC-REQ-086] Autorizaciones SGC: tipos y grupos propios, con motivo y registro; nada se borra, se revoca', async () => {
    const who = actor(E.cal);
    await expect(saveAuthorizationType(prisma, CO, { code: 'x', name: 'X', reason: 'código inválido' }, who)).rejects.toThrow(/Código/);
    await expect(saveAuthorizationType(prisma, CO, { code: 'SGC-X', name: '', reason: 'sin nombre' }, who)).rejects.toThrow(/nombre/);
    const t = await saveAuthorizationType(prisma, CO, { code: 'sgc-lectura', name: 'Lectura', description: 'Divulgación', reason: 'Tipo para el S4' }, who);
    await expect(saveAuthorizationType(prisma, CO, { code: 'SGC-LECTURA', name: 'Duplicado', reason: 'duplicado' }, who)).rejects.toMatchObject({ status: 409 });
    await saveAuthorizationType(prisma, CO, { id: t.id, name: 'Lectura firmada', isActive: false, reason: 'Se activa en el S4' }, who);
    await expect(saveAuthorizationType(prisma, 3, { id: t.id, name: 'X', reason: 'otra empresa' }, who)).rejects.toMatchObject({ status: 404 });
    const calidadType = (await listAuthorizationTypes(prisma, CO)).find((x) => x.code === 'SGC-VERIF-CALIDAD')!;
    await expect(grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: '', reason: 'sin correo' }, who)).rejects.toThrow(/correo/);
    await expect(grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: 'nadie@x.co', reason: 'no existe' }, who)).rejects.toThrow(/No existe/);
    await expect(grantAuthorizationTypeUser(prisma, 3, calidadType.id, { email: E.cal, reason: 'otra empresa' }, who)).rejects.toMatchObject({ status: 404 });
    // Sprint 6: nadie se agrega a sí mismo, el grupo de Calidad lo administra Calidad y solo entra quien puede decidir.
    await expect(grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: E.cal, reason: 'a sí misma' }, who)).rejects.toMatchObject({ status: 403 });
    await expect(grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: E.rev1, reason: 'solo flujos' }, actor(E.flujos), { actorIsQuality: false })).rejects.toMatchObject({ status: 403 });
    await expect(grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: E.lector, reason: 'solo consulta' }, actor(E.flujos))).rejects.toThrow(/gestión o de Calidad/);
    const g = await grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: E.cal, reason: 'Aseguramiento de Calidad' }, actor(E.flujos));
    await expect(grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: E.cal, reason: 'repetido' }, actor(E.flujos))).rejects.toMatchObject({ status: 409 });
    const tmp = await grantAuthorizationTypeUser(prisma, CO, calidadType.id, { email: E.rev1, reason: 'Temporal' }, who);
    await revokeAuthorizationTypeUser(prisma, CO, tmp.id, { reason: 'Fin del reemplazo' }, who);
    await expect(revokeAuthorizationTypeUser(prisma, CO, tmp.id, { reason: 'otra vez' }, who)).rejects.toMatchObject({ status: 409 });
    await expect(revokeAuthorizationTypeUser(prisma, 3, g.id, { reason: 'otra empresa' }, who)).rejects.toMatchObject({ status: 404 });
    expect((await getPoolMembers(prisma, CO, 'SGC-VERIF-CALIDAD')).sort()).toEqual([E.cal, 'nicolas.rivera@gsslatam.com'].sort());
    const log = await listConfigChanges(prisma, CO, { entity: 'authorization_type_user' });
    expect(log[0]).toMatchObject({ action: 'autorizacion.grupo_retirado', reason: 'Fin del reemplazo' });
  });

  it('[SGC-REQ-028] la solicitud documental exige permiso de gestión, justificación y campos obligatorios, y abre la elaboración', async () => {
    const form = await getRequestForm(prisma, CO);
    expect(form.fields.map((f) => f.key)).toEqual(['referencia_cambio', 'urgencia']);
    expect(form.steps.filter((s) => !s.isEnabled).map((s) => s.key)).toEqual(['divulgacion', 'capacitacion']);
    expect((await listEligibleUsers(prisma, CO)).map((u) => u.email)).not.toContain(E.lector);
    const base = { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento de control de documentos', description: 'Se requiere el procedimiento para la radicación INVIMA.', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Alta' } };
    await expect(createRequest(prisma, notifier, await accessOf(E.lector), base, actor(E.lector))).rejects.toMatchObject({ status: 403 });
    const elabAccess = await accessOf(E.elab);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, requestType: 'anulacion' }, actor(E.elab))).rejects.toThrow(/Tipo de solicitud/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, subject: 'x' }, actor(E.elab))).rejects.toThrow(/asunto/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, description: 'corta' }, actor(E.elab))).rejects.toThrow(/justificación/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, formValues: {} }, actor(E.elab))).rejects.toThrow(/Prioridad/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, formValues: { urgencia: 'Inventada' } }, actor(E.elab))).rejects.toThrow(/opción no permitida/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, idProcess: 999999 }, actor(E.elab))).rejects.toThrow(/proceso activo/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, idDocumentType: 'x' }, actor(E.elab))).rejects.toThrow(/tipo documental activo/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, elaboratorEmail: E.lector }, actor(E.elab))).rejects.toThrow(/no tiene permiso/);
    await expect(createRequest(prisma, notifier, elabAccess, { ...base, requestType: 'nueva_version', idDocument: 999999 }, actor(E.elab))).rejects.toThrow(/documento vigente/);

    const { idRequest } = await createRequest(prisma, notifier, elabAccess, { ...base, formValues: { urgencia: 'Alta', referencia_cambio: 'CC-2026-010' } }, actor(E.elab));
    req1 = idRequest;
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest }, include: { version: true, tasks: true, formValues: true } });
    expect(r).toMatchObject({ status: 'abierta', requester_email: E.elab, elaborator_email: E.elab, current_task_key: 'elaboracion', request_type: 'nuevo' });
    expect(r.version.version_number).toBe(1);
    expect(r.tasks.map((t) => [t.task_key, t.status])).toEqual([
      ['solicitud', 'resuelta'],
      ['elaboracion', 'abierta'],
    ]);
    expect(r.formValues.map((v) => v.value_text).sort()).toEqual(['Alta', 'CC-2026-010']);
    expect(await companyOfRequest(prisma, idRequest)).toBe(CO);
    await expect(companyOfRequest(prisma, 999999)).rejects.toMatchObject({ status: 404 });
  });

  it('[SGC-REQ-030] solo el ELABORADOR asigna revisores y aprobadores (no a sí mismo, solo personas habilitadas) y elige el modo de firma', async () => {
    await expect(setSigners(prisma, notifier, req1, { stepKey: 'revision', signers: [E.rev1] }, actor(E.rev1))).rejects.toMatchObject({ status: 403 });
    await expect(setSigners(prisma, notifier, req1, { stepKey: 'elaboracion', signers: [E.rev1] }, actor(E.elab))).rejects.toThrow(/no admite firmantes/);
    await expect(setSigners(prisma, notifier, req1, { stepKey: 'revision', signers: [E.elab] }, actor(E.elab))).rejects.toThrow(/elaborador no puede/);
    await expect(setSigners(prisma, notifier, req1, { stepKey: 'revision', signers: [E.lector] }, actor(E.elab))).rejects.toThrow(/no tiene permiso/);
    expect(await setSigners(prisma, notifier, req1, { stepKey: 'revision', signers: [E.rev1, E.rev2], mode: 'paralelo' }, actor(E.elab))).toEqual({ changed: true });
    expect(await setSigners(prisma, notifier, req1, { stepKey: 'revision', signers: [E.rev1, E.rev2], mode: 'paralelo', reason: 'sin cambios reales' }, actor(E.elab))).toEqual({ changed: false });
    await setSigners(prisma, notifier, req1, { stepKey: 'aprobacion', signers: [E.apr1, E.rev2], mode: 'orden' }, actor(E.elab));
    await expect(setSigners(prisma, notifier, req1, { stepKey: 'aprobacion', signers: [E.apr1] }, actor(E.elab))).rejects.toThrow(/motivo del cambio/);
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: req1 }, include: { signers: { orderBy: [{ step_key: 'asc' }, { sign_order: 'asc' }] } } });
    expect(JSON.parse(r.signing_modes_json)).toEqual({ revision: 'paralelo', aprobacion: 'orden' });
    expect(r.signers.map((s) => [s.step_key, s.user_email, s.sign_order, s.added_by])).toEqual([
      ['aprobacion', E.apr1, 1, E.elab],
      ['aprobacion', E.rev2, 2, E.elab],
      ['revision', E.rev1, 1, E.elab],
      ['revision', E.rev2, 2, E.elab],
    ]);
    const hist = await prisma.sgcInteraction.findMany({ where: { id_request: req1, kind: 'firmantes' } });
    expect(hist).toHaveLength(2);
    expect(hist[1].body).toContain('Modo de firma: en orden');
  });

  it('[SGC-REQ-032] adjuntos en la carpeta propia con SHA-256: el borrador solo lo carga el elaborador; nada se borra, se retira', async () => {
    await expect(decideTask(prisma, notifier, (await taskOf(req1, 'elaboracion')).id_task, { decision: 'aprobar' }, actor(E.elab))).rejects.toThrow(/borrador del documento/);
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'borrador', ...word() }, await viewer(E.rev1), actor(E.rev1))).rejects.toMatchObject({ status: 403 });
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'borrador', ...word(), fileName: 'x.exe' }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/Word/);
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'soporte', ...word(), bytes: new Uint8Array() }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/vacío/);
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'soporte', ...word(), fileName: '   ' }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/Nombre/);
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'soporte', ...word() }, await viewer(E.lector), actor(E.lector))).rejects.toMatchObject({ status: 404 });
    // Sprint 6: el borrador debe ser de verdad un Word o PDF, y un soporte no puede ser ejecutable ni página web.
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'borrador', ...word(), bytes: new TextEncoder().encode('no soy un word') }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/no es un Word o PDF válido/);
    await expect(uploadAttachment(prisma, upload, req1, { purpose: 'soporte', ...word(), fileName: 'pagina.html' }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/no se admite/);
    const wrong = await uploadAttachment(prisma, upload, req1, { purpose: 'borrador', ...word('versión equivocada') }, await viewer(E.elab), actor(E.elab));
    await withdrawAttachment(prisma, req1, wrong.id, { reason: 'Versión equivocada' }, await viewer(E.elab), actor(E.elab));
    await expect(withdrawAttachment(prisma, req1, wrong.id, { reason: 'otra vez' }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(withdrawAttachment(prisma, req1, 999999, { reason: 'no existe' }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 404 });
    const good = await uploadAttachment(prisma, upload, req1, { purpose: 'borrador', ...word() }, await viewer(E.elab), actor(E.elab));
    // Aviso de borrador duplicado (mismo SHA-256): el retirado no cuenta y uno distinto no es duplicado.
    expect(wrong.duplicateOf).toEqual([]);
    expect(good.duplicateOf).toEqual([]);
    const soporte = await uploadAttachment(prisma, upload, req1, { purpose: 'soporte', ...word('acta'), fileName: 'Acta.pdf', contentType: '' }, await viewer(E.rev1), actor(E.rev1));
    await expect(withdrawAttachment(prisma, req1, soporte.id, { reason: 'no es mío' }, await viewer(E.rev2), actor(E.rev2))).rejects.toMatchObject({ status: 403 });
    expect(uploads.at(-1)!.segments).toEqual(['SGC', 'S2', '_solicitudes', `SOL-${req1}`]);
    const att = await prisma.sgcAttachment.findUniqueOrThrow({ where: { id_attachment: good.id } });
    expect(att).toMatchObject({ purpose: 'borrador', sha256: good.sha256, uploaded_by: E.elab, withdrawn_at: null });
    expect((await prisma.sgcAttachment.findUniqueOrThrow({ where: { id_attachment: wrong.id } })).withdraw_reason).toBe('Versión equivocada');
    const dl = await getAttachmentForDownload(prisma, req1, good.id, await viewer(E.rev1), actor(E.rev1));
    expect(dl).toMatchObject({ itemId: att.item_id, sha256: good.sha256 });
    await expect(getAttachmentForDownload(prisma, req1, 999999, await viewer(E.rev1), actor(E.rev1))).rejects.toMatchObject({ status: 404 });
    expect(await prisma.sgcAuditLog.count({ where: { action: 'documento.consulta', entity: 'attachment', entity_id: String(good.id) } })).toBe(1);
  });

  it('[SGC-REQ-029][SGC-REQ-035][SGC-REQ-036][SGC-REQ-085] enviar abre la revisión con 2 revisores EN PARALELO; no avanza hasta que ambos aprueban', async () => {
    sent.length = 0;
    const elab = await taskOf(req1, 'elaboracion');
    await expect(decideTask(prisma, notifier, elab.id_task, { decision: 'aprobar' }, actor(E.rev1))).rejects.toMatchObject({ status: 403 });
    await expect(decideTask(prisma, notifier, elab.id_task, { decision: 'otra' }, actor(E.elab))).rejects.toThrow(/Decisión inválida/);
    await expect(decideTask(prisma, notifier, 999999, { decision: 'aprobar' }, actor(E.elab))).rejects.toMatchObject({ status: 404 });
    await expect(decideTask(prisma, notifier, elab.id_task, { decision: 'devolver', comment: 'no aplica aquí' }, actor(E.elab))).rejects.toThrow(/no se puede devolver/);
    await expect(decideTask(prisma, notifier, elab.id_task, { decision: 'aprobar', comment: 'Listo para revisión' }, actor(E.elab))).rejects.toThrow(/firma electrónica/);
    const sub = await decideTask(prisma, notifier, elab.id_task, { decision: 'aprobar', comment: 'Listo para revisión', signature: await sig(elab.id_task) }, actor(E.elab));
    expect(sub).toMatchObject({ outcome: 'resuelta', next: 'revision' });
    // Sprint 6 [SGC-REQ-085]: ya en revisión, el borrador que se está firmando no se puede retirar.
    const borrador = await prisma.sgcAttachment.findFirstOrThrow({ where: { id_request: req1, purpose: 'borrador', withdrawn_at: null } });
    await expect(withdrawAttachment(prisma, req1, borrador.id_attachment, { reason: 'Cambiarlo a mitad de la revisión' }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/durante la elaboración/);
    const elabAfter = await taskOf(req1, 'elaboracion');
    expect(elabAfter.assignees[0]).toMatchObject({ status: 'aprobado', signature_status: 'firmada', signature_meaning: 'elaboro', decided_by: E.elab });

    const rev = await taskOf(req1, 'revision');
    expect(rev).toMatchObject({ status: 'abierta', signing_mode: 'paralelo', round: 1 });
    expect(rev.assignees.map((a) => [a.user_email, a.sign_order, a.status, a.signature_status])).toEqual([
      [E.rev1, 1, 'pendiente', 'pendiente'],
      [E.rev2, 2, 'pendiente', 'pendiente'],
    ]);
    expect(sent.find((n) => n.payload.url === `/process/sgc-documental/tareas/${rev.id_task}`)!.emails.sort()).toEqual([E.rev1, E.rev2].sort());
    expect(sent.every((n) => !n.emails.includes(E.elab))).toBe(true);

    const inbox1 = await listTaskInbox(prisma, E.rev1, await getSgcAccessForUser(prisma, E.rev1));
    expect(inbox1.find((t) => t.idTask === rev.id_task)).toMatchObject({ status: 'abierta', statusLabel: 'Abierto', task: 'Revisión', idRequest: req1 });
    expect(await requestOfTask(prisma, rev.id_task)).toEqual({ idRequest: req1, idCompany: CO });

    const partial = await decideTask(prisma, notifier, rev.id_task, { decision: 'aprobar', comment: 'Sin observaciones', signature: await sig(rev.id_task) }, actor(E.rev2));
    expect(partial).toMatchObject({ outcome: 'abierta', next: 'revision' });
    await expect(decideTask(prisma, notifier, rev.id_task, { decision: 'aprobar' }, actor(E.rev2))).rejects.toMatchObject({ status: 403 });
    const done = await decideTask(prisma, notifier, rev.id_task, { decision: 'aprobar', signature: await sig(rev.id_task) }, actor(E.rev1));
    expect(done).toMatchObject({ outcome: 'resuelta', next: 'aprobacion' });
    const hist = await prisma.sgcInteraction.findMany({ where: { id_request: req1, kind: 'decision' }, orderBy: { id_interaction: 'asc' } });
    expect(hist.map((h) => h.author_email)).toEqual([E.elab, E.rev2, E.rev1]);
    expect(hist[1].body).toContain('Firma electrónica: Revisó (firmado electrónicamente)');
  });

  it('[SGC-REQ-029][SGC-REQ-033] la aprobación va EN ORDEN (apr1 → rev2 → grupo de Calidad) y llega también a Autorizaciones SGC', async () => {
    const apr = await taskOf(req1, 'aprobacion');
    expect(apr).toMatchObject({ status: 'abierta', signing_mode: 'orden' });
    expect(apr.assignees.map((a) => [a.user_email, a.pool_type_code, a.sign_order])).toEqual([
      [E.apr1, null, 1],
      [E.rev2, null, 2],
      [null, 'SGC-VERIF-CALIDAD', 3],
    ]);
    const auths = await prisma.sgcAuthorization.findMany({ where: { id_request: req1 }, include: { type: true }, orderBy: { id_authorization: 'asc' } });
    expect(auths.map((a) => [a.type.code, a.assigned_email, a.status])).toEqual([
      ['SGC-APROBACION', E.apr1, 'pendiente'],
      ['SGC-APROBACION', E.rev2, 'pendiente'],
      ['SGC-VERIF-CALIDAD', null, 'pendiente'],
    ]);
    // En orden: solo apr1 recibe la notificación; rev2 y el grupo esperan su turno.
    expect(sent.filter((n) => n.payload.url === `/process/sgc-documental/tareas/${apr.id_task}`).flatMap((n) => n.emails)).toEqual([E.apr1]);
    sent.length = 0;
    const rev2Inbox = await listAuthorizationInbox(prisma, E.rev2, await getSgcAccessForUser(prisma, E.rev2));
    expect(rev2Inbox.find((a) => a.idRequest === req1 && a.status === 'pendiente')).toMatchObject({ inTurn: false, typeCode: 'SGC-APROBACION', statusLabel: 'Pendiente' });
    const calInbox = await listAuthorizationInbox(prisma, E.cal, await getSgcAccessForUser(prisma, E.cal), { status: 'pendiente', idCompany: CO });
    expect(calInbox.find((a) => a.idRequest === req1)).toMatchObject({ isPool: true, inTurn: false });
    expect(await listAuthorizationInbox(prisma, E.cal, [])).toEqual([]);
    await expect(decideTask(prisma, notifier, apr.id_task, { decision: 'aprobar' }, actor(E.rev2))).rejects.toMatchObject({ status: 409 });

    const aprAuth = await taskOfAuthorization(prisma, auths[0].id_authorization);
    await expect(decideTask(prisma, notifier, aprAuth.idTask, { decision: 'aprobar', idAssignee: apr.assignees[1].id_task_assignee }, actor(E.apr1))).rejects.toMatchObject({ status: 409 });
    await expect(taskOfAuthorization(prisma, 999999)).rejects.toMatchObject({ status: 404 });
    await decideTask(prisma, notifier, aprAuth.idTask, { decision: 'aprobar', comment: 'Aprobado por el área', idAssignee: aprAuth.idAssignee, signature: await sig(aprAuth.idTask) }, actor(E.apr1));
    expect((await prisma.sgcAuthorization.findUniqueOrThrow({ where: { id_authorization: auths[0].id_authorization } }))).toMatchObject({ status: 'autorizada', decided_by: E.apr1, decision_comment: 'Aprobado por el área' });
    expect(sent.at(-1)!.emails).toEqual([E.rev2]);
  });

  it('[SGC-REQ-030] el elaborador cambia un aprobador en pleno proceso: queda registrado quién, cuándo y por qué; lo decidido no se retira', async () => {
    await expect(setSigners(prisma, notifier, req1, { stepKey: 'aprobacion', signers: [E.rev2], reason: 'quitar a quien ya aprobó' }, actor(E.elab))).rejects.toMatchObject({ status: 409 });
    sent.length = 0;
    await setSigners(prisma, notifier, req1, { stepKey: 'aprobacion', signers: [E.apr1, E.rev1], reason: 'Rev2 sale a vacaciones' }, actor(E.elab));
    const apr = await taskOf(req1, 'aprobacion');
    expect(apr.assignees.map((a) => [a.user_email ?? a.pool_type_code, a.status, a.sign_order])).toEqual([
      [E.apr1, 'aprobado', 1],
      [E.rev2, 'reemplazado', 2],
      [E.rev1, 'pendiente', 2],
      ['SGC-VERIF-CALIDAD', 'pendiente', 3],
    ]);
    const removed = await prisma.sgcRequestSigner.findFirstOrThrow({ where: { id_request: req1, step_key: 'aprobacion', user_email: E.rev2 } });
    expect(removed).toMatchObject({ is_active: false, removed_by: E.elab, change_reason: 'Rev2 sale a vacaciones' });
    expect(removed.removed_at).toBeInstanceOf(Date);
    expect(await prisma.sgcAuthorization.count({ where: { id_request: req1, assigned_email: E.rev2, status: 'anulada' } })).toBe(1);
    expect(await prisma.sgcAuthorization.count({ where: { id_request: req1, assigned_email: E.rev1, status: 'pendiente' } })).toBe(1);
    expect(sent.flatMap((n) => n.emails)).toEqual([E.rev1]);
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { action: 'solicitud.firmantes', entity_id: String(req1) }, orderBy: { id_audit_log: 'desc' } });
    expect(audit).toMatchObject({ actor_email: E.elab, detail: 'Rev2 sale a vacaciones' });
    // Cambiar el modo en pleno paso también queda registrado.
    await setSigners(prisma, notifier, req1, { stepKey: 'aprobacion', signers: [E.apr1, E.rev1], mode: 'paralelo', reason: 'Se acelera la aprobación' }, actor(E.elab));
    expect((await taskOf(req1, 'aprobacion')).signing_mode).toBe('paralelo');
    await setSigners(prisma, notifier, req1, { stepKey: 'aprobacion', signers: [E.apr1, E.rev1], mode: 'orden', reason: 'Vuelve a orden por Calidad' }, actor(E.elab));
  });

  it('[SGC-REQ-029][SGC-REQ-033][SGC-REQ-027] con la verificación de Calidad (grupo) la aprobación termina y la solicitud queda en espera de divulgación (S4)', async () => {
    const apr = await taskOf(req1, 'aprobacion');
    await expect(decideTask(prisma, notifier, apr.id_task, { decision: 'aprobar' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await decideTask(prisma, notifier, apr.id_task, { decision: 'aprobar', signature: await sig(apr.id_task) }, actor(E.rev1));
    const detailCal = await getTaskDetail(prisma, apr.id_task, await viewer(E.cal));
    expect(detailCal.tasks.find((t) => t.id === apr.id_task)!.myAction).toEqual({ idAssignee: expect.any(Number), kind: 'decidir', signatureMeaning: 'aprobo', checklist: [] });
    await expect(decideTask(prisma, notifier, apr.id_task, { decision: 'aprobar' }, actor(E.elab))).rejects.toMatchObject({ status: 403 });
    const fin = await decideTask(prisma, notifier, apr.id_task, { decision: 'aprobar', comment: 'Estructura conforme a la guía', signature: await sig(apr.id_task) }, actor(E.cal));
    expect(fin).toMatchObject({ outcome: 'resuelta', next: 'divulgacion' });
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: req1 } });
    expect(r).toMatchObject({ status: 'en_espera', current_task_key: 'divulgacion' });
    const div = await taskOf(req1, 'divulgacion');
    expect(div.status).toBe('en_espera');
    expect(div.assignees).toHaveLength(0);
    const pool = (await taskOf(req1, 'aprobacion')).assignees.find((a) => a.pool_type_code)!;
    expect(pool).toMatchObject({ status: 'aprobado', decided_by: E.cal, signature_status: 'firmada', signature_meaning: 'aprobo' });
    await expect(decideTask(prisma, notifier, div.id_task, { decision: 'aprobar' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const calHist = await prisma.sgcInteraction.findFirstOrThrow({ where: { id_request: req1, author_email: E.cal, kind: 'decision' } });
    expect(calHist.body).toContain('grupo SGC-VERIF-CALIDAD');
  });

  it('[SGC-REQ-037][SGC-REQ-032] la solicitud solo la ven los involucrados y Calidad (a los demás, 404); la vista trae historial, firmantes y permisos', async () => {
    await expect(getRequestDetail(prisma, req1, await viewer(E.lector))).rejects.toMatchObject({ status: 404 });
    await expect(getRequestDetail(prisma, req1, await viewer(E.elab2))).rejects.toMatchObject({ status: 404 });
    await expect(getRequestDetail(prisma, req1, { email: E.elab, access: [] })).rejects.toMatchObject({ status: 404 });
    await expect(getRequestDetail(prisma, 999999, await viewer(E.elab))).rejects.toMatchObject({ status: 404 });
    const cal = await getRequestDetail(prisma, req1, await viewer(E.cal));
    expect(cal.permissions).toMatchObject({ isQuality: true, canChangeSigners: false, canNote: true });
    const d = await getRequestDetail(prisma, req1, await viewer(E.elab));
    expect(d.request).toMatchObject({ id: req1, status: 'en_espera', statusLabel: 'En espera', requestTypeLabel: 'Documento nuevo', flow: { code: 'DOC', version: 1 }, process: { code: 'GC' }, documentType: { code: 'PR' } });
    expect(d.tasks.map((t) => [t.key, t.statusLabel])).toEqual([
      ['solicitud', 'Resuelto'],
      ['elaboracion', 'Resuelto'],
      ['revision', 'Resuelto'],
      ['aprobacion', 'Resuelto'],
      ['divulgacion', 'En espera'],
    ]);
    expect(d.steps.find((s) => s.key === 'aprobacion')!.history.map((h) => [h.email, h.isActive])).toEqual([
      [E.apr1, true],
      [E.rev2, false],
      [E.rev1, true],
    ]);
    expect(d.formFields.find((f) => f.key === 'urgencia')!.value).toBe('Alta');
    expect(d.attachments.filter((a) => a.withdrawnAt)).toHaveLength(1);
    expect(d.permissions).toMatchObject({ isElaborator: true, isRequester: true, canCancel: false, canUploadDraft: false });
    expect(d.interactions.length).toBeGreaterThan(8);
    const mine = await listMyRequests(prisma, E.elab, await getSgcAccessForUser(prisma, E.elab), { idCompany: CO });
    expect(mine.find((x) => x.id === req1)).toMatchObject({ statusLabel: 'En espera', currentTask: 'Divulgación' });
    expect((await listMyRequests(prisma, E.cal, await getSgcAccessForUser(prisma, E.cal))).some((x) => x.id === req1)).toBe(true);
    expect(await listMyRequests(prisma, E.rev1, [])).toEqual([]);
    const inbox = await listTaskInbox(prisma, E.rev2, await getSgcAccessForUser(prisma, E.rev2), { idRequest: req1 });
    expect(inbox.map((t) => [t.task, t.status]).sort()).toEqual([
      ['Aprobación', 'cancelada'],
      ['Revisión', 'resuelta'],
    ]);
    expect(await listTaskInbox(prisma, E.rev2, await getSgcAccessForUser(prisma, E.rev2), { status: 'abierta', idRequest: req1 })).toEqual([]);
    expect(await listTaskInbox(prisma, E.rev2, [])).toEqual([]);
    const calInbox = await listTaskInbox(prisma, E.cal, await getSgcAccessForUser(prisma, E.cal), { idCompany: CO, idRequest: req1 });
    expect(calInbox).toEqual([expect.objectContaining({ isPool: true, status: 'resuelta', assigned: 'Grupo SGC-VERIF-CALIDAD' })]);
  });

  it('[SGC-REQ-031][SGC-REQ-028] nueva versión de un vigente: devolver con observaciones abre otra ronda; reasignar y cancelar exigen motivo y permiso', async () => {
    const doc = await createInitialDocument(
      prisma,
      upload,
      { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title: 'Control de registros', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-01-15', pdf: { bytes: new TextEncoder().encode('%PDF-1.7\nx'), fileName: 'x.pdf' } },
      actor(E.cal)
    );
    docId = doc.idDocument;
    const access = await accessOf(E.elab);
    const { idRequest } = await createRequest(prisma, notifier, access, { idCompany: CO, requestType: 'nueva_version', subject: 'Actualizar control de registros', description: 'Cambio de formato por auditoría interna.', idDocument: docId, formValues: { urgencia: 'Normal' } }, actor(E.elab));
    await expect(
      createRequest(prisma, notifier, access, { idCompany: CO, requestType: 'modificacion', subject: 'Otra solicitud', description: 'Segunda solicitud sobre el mismo documento.', idDocument: docId, formValues: { urgencia: 'Normal' } }, actor(E.elab))
    ).rejects.toMatchObject({ status: 409 });
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } });
    expect(r).toMatchObject({ id_document: docId, id_process_map: procGC, id_document_type: typePR });

    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev1], mode: 'orden' }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr1] }, actor(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...word('v2') }, await viewer(E.elab), actor(E.elab));
    await saveFormValues(prisma, idRequest, { values: { resumen_cambios: 'Se agrega el campo de firma' } }, await viewer(E.elab), actor(E.elab));
    await expect(saveFormValues(prisma, idRequest, { values: { urgencia: 'Otra' } }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/opción no permitida/);
    await expect(saveFormValues(prisma, idRequest, { values: { urgencia: 'Alta' } }, await viewer(E.cal), actor(E.cal))).rejects.toMatchObject({ status: 403 });
    expect(await saveFormValues(prisma, idRequest, { values: 'x' }, await viewer(E.elab), actor(E.elab))).toEqual({ saved: {} });
    const elabT = (await taskOf(idRequest, 'elaboracion')).id_task;
    await decideTask(prisma, notifier, elabT, { decision: 'aprobar', signature: await sig(elabT) }, actor(E.elab));

    sent.length = 0;
    const rev = await taskOf(idRequest, 'revision');
    await expect(decideTask(prisma, notifier, rev.id_task, { decision: 'devolver', comment: 'no' }, actor(E.rev1))).rejects.toThrow(/observaciones/);
    const back = await decideTask(prisma, notifier, rev.id_task, { decision: 'devolver', comment: 'Falta el anexo de firmas' }, actor(E.rev1));
    expect(back).toMatchObject({ outcome: 'devuelta', next: 'elaboracion' });
    expect((await taskOf(idRequest, 'revision')).status).toBe('devuelta');
    const round2 = await taskOf(idRequest, 'elaboracion');
    expect(round2).toMatchObject({ status: 'abierta', round: 2 });
    expect(sent.some((n) => n.payload.title.startsWith('Documento devuelto') && n.emails.includes(E.elab))).toBe(true);
    const inboxRound = await listTaskInbox(prisma, E.elab, await getSgcAccessForUser(prisma, E.elab), { idRequest });
    expect(inboxRound.find((t) => t.idTask === round2.id_task)!.task).toBe('Elaboración (ronda 2)');

    const reason = 'El elaborador pasa a otro proyecto';
    await expect(reassignTask(prisma, notifier, await accessOf(E.rev1), round2.id_task, { toEmail: E.elab2, reason }, actor(E.rev1))).rejects.toMatchObject({ status: 403 });
    await expect(reassignTask(prisma, notifier, access, round2.id_task, { toEmail: E.elab2, reason: 'no' }, actor(E.elab))).rejects.toThrow(/motivo/);
    await expect(reassignTask(prisma, notifier, access, round2.id_task, { toEmail: E.rev1, reason }, actor(E.elab))).rejects.toThrow(/firmante del documento/);
    await expect(reassignTask(prisma, notifier, access, round2.id_task, { toEmail: E.lector, reason }, actor(E.elab))).rejects.toThrow(/no tiene permiso/);
    await expect(reassignTask(prisma, notifier, access, round2.id_task, { toEmail: E.elab, reason }, actor(E.elab))).rejects.toThrow(/ya está asignada/);
    await expect(reassignTask(prisma, notifier, access, rev.id_task, { toEmail: E.elab2, reason }, actor(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(reassignTask(prisma, notifier, access, 999999, { toEmail: E.elab2, reason }, actor(E.elab))).rejects.toMatchObject({ status: 404 });
    await reassignTask(prisma, notifier, access, round2.id_task, { toEmail: E.elab2.toUpperCase(), reason }, actor(E.elab));
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } })).elaborator_email).toBe(E.elab2);
    expect((await taskOf(idRequest, 'elaboracion')).assignees.map((a) => [a.user_email, a.status])).toEqual([
      [E.elab, 'reemplazado'],
      [E.elab2, 'pendiente'],
    ]);
    // El nuevo elaborador es quien ahora cambia a los firmantes.
    await expect(setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev2], reason: 'cambio de revisor' }, actor(E.elab))).rejects.toMatchObject({ status: 403 });
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev2], reason: 'Cambio de revisor' }, actor(E.elab2));

    await addNote(prisma, notifier, idRequest, { body: 'Por favor revisar el anexo', notifyEmails: [E.rev2, E.elab2] }, await viewer(E.elab2), actor(E.elab2));
    expect(sent.at(-1)).toMatchObject({ emails: [E.rev2], payload: { title: 'Nueva nota en solicitud documental · SynerLink' } });
    // Sprint 6 [SGC-REQ-085]: una nota solo notifica a personas que pueden actuar en el SGC (no a cualquier correo).
    sent.length = 0;
    await addNote(prisma, notifier, idRequest, { body: 'Aviso a alguien de fuera', notifyEmails: ['externo@otra.com', E.lector, E.rev2] }, await viewer(E.elab2), actor(E.elab2));
    expect(sent.at(-1)).toMatchObject({ emails: [E.rev2] });
    sent.length = 0;
    await addNote(prisma, notifier, idRequest, { body: 'Nota sin avisos' }, await viewer(E.elab2), actor(E.elab2));
    await expect(addNote(prisma, notifier, idRequest, { body: '' }, await viewer(E.elab2), actor(E.elab2))).rejects.toThrow(/nota/);
    await expect(addNote(prisma, notifier, idRequest, { body: 'hola' }, await viewer(E.lector), actor(E.lector))).rejects.toMatchObject({ status: 404 });

    await expect(cancelRequest(prisma, notifier, await accessOf(E.rev2), idRequest, { reason: 'Ya no se requiere' }, actor(E.rev2))).rejects.toMatchObject({ status: 403 });
    await expect(cancelRequest(prisma, notifier, access, idRequest, { reason: 'x' }, actor(E.elab))).rejects.toThrow(/motivo/);
    expect(await cancelRequest(prisma, notifier, access, idRequest, { reason: 'Se decide mantener la versión vigente' }, actor(E.elab))).toEqual({ status: 'cancelada' });
    const c = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } });
    expect(c).toMatchObject({ status: 'cancelada', cancel_reason: 'Se decide mantener la versión vigente', closed_by: E.elab });
    expect((await taskOf(idRequest, 'elaboracion')).status).toBe('cancelada');
    await expect(cancelRequest(prisma, notifier, access, idRequest, { reason: 'otra vez cancelar' }, actor(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(addNote(prisma, notifier, idRequest, { body: 'tarde' }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(uploadAttachment(prisma, upload, idRequest, { purpose: 'soporte', ...word() }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev1], reason: 'cerrada ya' }, actor(E.elab2))).rejects.toMatchObject({ status: 409 });
    // Con la anterior cancelada, el documento admite una nueva solicitud.
    const again = await createRequest(prisma, notifier, access, { idCompany: CO, requestType: 'modificacion', subject: 'Modificar control de registros', description: 'Modificación menor del formato.', idDocument: docId, formValues: { urgencia: 'Normal' } }, actor(E.elab));
    expect(again.idRequest).toBeGreaterThan(idRequest);
    await expect(cancelRequest(prisma, notifier, await accessOf(E.cal), again.idRequest, { reason: 'Calidad cancela por duplicidad' }, actor(E.cal))).resolves.toEqual({ status: 'cancelada' });
  });

  it('[SGC-REQ-025] una instancia en curso conserva la versión del flujo con la que arrancó; las nuevas usan la vigente', async () => {
    const access = await accessOf(E.elab);
    const base = { idCompany: CO, requestType: 'nuevo', subject: 'Instructivo de limpieza de áreas', description: 'Nuevo instructivo solicitado por producción.', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } };
    const old = await createRequest(prisma, notifier, access, base, actor(E.elab));
    const doc = (await listFlowProcesses(prisma, CO)).find((f) => f.code === 'DOC')!;
    const who = actor(E.flujos);
    const draft = await createDraftVersion(prisma, CO, doc.id, { reason: 'Revisión en 3 días (piloto)' }, who);
    const def = await loadDefinition(prisma, draft.idFlowVersion);
    def.tasks.find((t) => t.key === 'revision')!.targetDays = 3;
    def.formFields = def.formFields.filter((f) => f.key !== 'urgencia');
    await saveDraftDefinition(prisma, CO, draft.idFlowVersion, { definition: def, reason: 'Revisión en 3 días y sin prioridad' }, who);
    await publishFlowVersion(prisma, CO, draft.idFlowVersion, { reason: 'Publica DOC v2' }, who);

    const fresh = await createRequest(prisma, notifier, access, { ...base, formValues: {} }, actor(E.elab));
    const [oldReq, newReq] = await Promise.all([
      prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: old.idRequest }, include: { version: true } }),
      prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: fresh.idRequest }, include: { version: true } }),
    ]);
    expect(oldReq.version.version_number).toBe(1);
    expect(newReq.version.version_number).toBe(2);
    // La vieja sigue con la v1 al avanzar: su revisión nace de la definición v1 (5 días) y conserva la prioridad.
    await setSigners(prisma, notifier, old.idRequest, { stepKey: 'revision', signers: [E.rev1] }, actor(E.elab));
    await setSigners(prisma, notifier, old.idRequest, { stepKey: 'aprobacion', signers: [E.apr1] }, actor(E.elab));
    await uploadAttachment(prisma, upload, old.idRequest, { purpose: 'borrador', ...word('instructivo') }, await viewer(E.elab), actor(E.elab));
    const elabOld = (await taskOf(old.idRequest, 'elaboracion')).id_task;
    await decideTask(prisma, notifier, elabOld, { decision: 'aprobar', signature: await sig(elabOld) }, actor(E.elab));
    const revOld = await prisma.sgcTask.findFirstOrThrow({ where: { id_request: old.idRequest, task_key: 'revision' }, include: { taskDef: true } });
    expect(revOld.taskDef).toMatchObject({ id_flow_version: oldReq.id_flow_version, target_days: 5 });
    const detailOld = await getRequestDetail(prisma, old.idRequest, await viewer(E.elab));
    expect(detailOld.formFields.map((f) => f.key)).toContain('urgencia');
    expect((await getRequestDetail(prisma, fresh.idRequest, await viewer(E.elab))).formFields.map((f) => f.key)).not.toContain('urgencia');
    const form = await getRequestForm(prisma, CO);
    expect(form.flow.version).toBe(2);
  });
});
