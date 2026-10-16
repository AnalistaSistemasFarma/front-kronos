import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { getApproverPolicy, grantApproverAuthorization, listApproverAuthorizations } from '../../../lib/sgc/db/approvers';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { SGC_DEPARTMENT_LEADERS_ACTION, getCompanySettings, saveCompanySettings } from '../../../lib/sgc/db/companySettings';
import { addScopeEntry, openReadingFile, recordReadingEvent } from '../../../lib/sgc/db/dissemination';
import { createInitialDocument, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getCurrentFlowVersion, loadDefinition } from '../../../lib/sgc/db/flows';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { createRequest, decideTask, getRequestDetail, reassignTask, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import { signTask, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import { saveTraining, uploadTrainingResults } from '../../../lib/sgc/db/training';
import { normalizeFlowDefinition, type SgcFlowDefinition } from '../../../lib/sgc/flows/definition';
import { canApproveFor, signerScopeFor, substituteApproverCheck } from '../../../lib/sgc/db/roleModel';
import { SGC_DOCUMENT_FLOW_V7 } from '../../../lib/sgc/flows/documentFlow';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * S15 contra un SQL Server REAL (efímero en CI): NUEVO MODELO DE ROLES del
 * flujo documental, DOC v7 (plan sgc-plan-sprints-requerimientos-2026-10-13):
 *   R15 · Calidad autoriza o rechaza la creación (el rechazo cierra con motivo
 *         y documento enlazado; si el solicitante es de Calidad, autoriza otra
 *         persona de Calidad, D15);
 *   R16 · el solicitante elabora (sin matriz; la redirección es solo de Calidad);
 *   R17 · el elaborador asigna firmantes de su departamento (sin sugerencia);
 *   R18 · revisor del área o de Calidad; aprobador del área;
 *   R19 · lista de líderes por departamento, sin restricción hasta que se
 *         enciende (D16);
 *   R27 · el creador prepara y dicta la capacitación; Calidad la cierra (D18);
 *   y las solicitudes en curso CONSERVAN su versión del flujo.
 * Empresa propia (id 116).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · S15 · modelo de roles DOC v7 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 116;
  const PW = 'Clave-S15-ci#2026';
  const E = {
    sol: 'sol.s15@onelatampharma.com',
    par: 'par.s15@onelatampharma.com',
    jefe: 'jefe.s15@onelatampharma.com',
    otro: 'otro.s15@onelatampharma.com',
    cal1: 'calidad1.s15@onelatampharma.com',
    cal2: 'calidad2.s15@onelatampharma.com',
    elabV6: 'elab.v6.s15@onelatampharma.com',
    l1: 'lector1.s15@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.15.15.15', userAgent: 'vitest-s15' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s15-${++n}`;
    store.set(id, new Uint8Array(content));
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (id) => store.get(id)!,
    htmlToPdf: async () => pdfOf('Contenido convertido S15'),
    docxToHtml: async () => '<h1>Procedimiento S15</h1><p>Contenido.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: true } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba del S15`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  const canon = (def: SgcFlowDefinition) => {
    const d = normalizeFlowDefinition(JSON.parse(JSON.stringify(def)));
    return { ...d, transitions: [...d.transitions].sort((a, b) => `${a.from}:${a.action}`.localeCompare(`${b.from}:${b.action}`)) };
  };
  let procGC = 0;
  let typePR = 0;
  let deptProd = 0;
  let deptMerc = 0;
  let idVigente = 0;
  let idV6Request = 0;

  const newRequest = async (requester: string, subject: string, requiresTraining: unknown = 'no') =>
    (await createRequest(prisma, notifier, await accessOf(requester), { idCompany: CO, requestType: 'nuevo', subject, description: `Solicitud de la prueba del S15: ${subject}.`, idProcess: procGC, idDocumentType: typePR, requiresTraining, formValues: { urgencia: 'Normal' } }, actor(requester))).idRequest;
  const authorize = async (idRequest: number, by = E.cal1) => decideTask(prisma, notifier, (await taskOf(idRequest, 'autorizacion_creacion')).id_task, { decision: 'aprobar', comment: 'Creación autorizada' }, actor(by));

  beforeAll(async () => {
    // La política vigente en pruebas y producción para el modelo anterior (RN 2026-10-05): quien ejecuta la primera tarea O Calidad.
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'tarea_o_calidad');
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S15 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S15', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S15 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    deptProd = (await prisma.department.create({ data: { department: 'S15 PRODUCCIÓN' } })).id_department;
    deptMerc = (await prisma.department.create({ data: { department: 'S15 MERCADEO' } })).id_department;
    const deptGC = (await prisma.department.create({ data: { department: 'S15 GARANTÍA DE CALIDAD' } })).id_department;
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[], number | null][] = [
      [E.sol, ['gestion'], deptProd],
      [E.par, ['gestion'], deptProd],
      [E.jefe, ['gestion'], deptProd],
      [E.otro, ['gestion'], deptMerc],
      [E.cal1, ['gestion', 'calidad'], deptGC],
      [E.cal2, ['gestion', 'calidad'], deptGC],
      [E.elabV6, ['gestion'], deptProd],
      [E.l1, ['lectura'], deptProd],
    ];
    for (const [email, perms, dept] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
      if (dept) await prisma.departmentUser.create({ data: { id_user: user.id, id_department: dept } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql', '2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typePR, userEmail: E.elabV6, reason: 'Elaborador de la versión anterior (S15)' }, actor(E.cal1));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    for (const email of [E.cal1, E.cal2]) await grantAuthorizationTypeUser(prisma, CO, calType.id, { email, reason: 'Calidad de la prueba del S15' }, actor('ci@x.co'));
    const vig = await createInitialDocument(
      prisma,
      upload,
      { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title: 'Procedimiento vigente de la prueba S15', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-10-01', pdf: { bytes: await pdfOf('Vigente S15'), fileName: 'vigente.pdf' } },
      actor(E.cal1)
    );
    idVigente = vig.idDocument;
    // Una solicitud del DOC v6 EN CURSO antes del pase del S15: debe conservar su versión.
    idV6Request = await newRequest(E.sol, 'Solicitud en curso con el flujo anterior');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-158] la migración agrega role_model, id_department y «rechazar»; el SQL publica el DOC v7 igual a la definición (idempotente) y las solicitudes en curso conservan su versión', async () => {
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE (object_id = OBJECT_ID('sgc.flow_version') AND name = 'role_model') OR (object_id = OBJECT_ID('sgc.approver_authorization') AND name = 'id_department')`;
    expect(cols).toHaveLength(2);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261014100000_sgc_s15_modelo_roles/migration.sql'), 'utf8'));
    const before = await getCurrentFlowVersion(prisma, CO, 'DOC');
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s15-flujo-doc-v7-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s15-flujo-doc-v7-olp.sql'));
    const after = await getCurrentFlowVersion(prisma, CO, 'DOC');
    expect(after.version.version_number).toBe(before.version.version_number + 1);
    expect(after.version.role_model).toBe('solicitante_elabora');
    expect(canon(await loadDefinition(prisma, after.version.id_flow_version))).toEqual(canon(SGC_DOCUMENT_FLOW_V7));
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, id_flow_version: after.version.id_flow_version, action: 'version.publicada' } })).toBe(1);
    // La solicitud v6 sigue con su versión y su modelo (el elaborador por la matriz).
    const v6 = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idV6Request } });
    expect(v6.id_flow_version).toBe(before.version.id_flow_version);
    expect(v6.elaborator_email).toBe(E.elabV6);
    const detail = await getRequestDetail(prisma, idV6Request, await viewer(E.elabV6));
    expect(detail.request.roleModel).toBe('calidad_asigna');
    expect(detail.tasks.at(-1)).toMatchObject({ key: 'elaboracion', canReject: false });
  });

  it('[SGC-REQ-158][SGC-REQ-159] R15/R16: quien pide elabora; Calidad autoriza primero (mientras tanto nadie elabora) y el solicitante no se autoriza a sí mismo', async () => {
    const r = await newRequest(E.sol, 'Procedimiento de limpieza de áreas');
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } });
    expect(req).toMatchObject({ elaborator_email: E.sol, current_task_key: 'autorizacion_creacion', requires_training: false });
    expect(await prisma.sgcTask.count({ where: { id_request: r, task_key: 'elaboracion' } })).toBe(0);
    const auth = await taskOf(r, 'autorizacion_creacion');
    expect(auth.assignees).toEqual([expect.objectContaining({ user_email: null, pool_type_code: 'SGC-VERIF-CALIDAD', status: 'pendiente' })]);
    expect(await prisma.sgcAuthorization.count({ where: { id_request: r, status: 'pendiente' } })).toBe(1);
    expect(sent.some((x) => x.emails.includes(E.cal1) && x.payload.url.endsWith(`/tareas/${auth.id_task}`))).toBe(true);
    await expect(decideTask(prisma, notifier, auth.id_task, { decision: 'aprobar' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    expect(await authorize(r)).toMatchObject({ outcome: 'resuelta', next: 'elaboracion' });
    const elab = await taskOf(r, 'elaboracion');
    expect(elab.assignees).toEqual([expect.objectContaining({ user_email: E.sol, status: 'pendiente' })]);
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, action: 'solicitud.creada', entity_id: String(r) } });
    expect(JSON.parse(audit.after_json!)).toMatchObject({ elaborator: E.sol, elaboratorSource: 'solicitante', roleModel: 'solicitante_elabora' });

    // D15: el solicitante de Calidad no autoriza su propia creación; la autoriza otra persona de Calidad.
    const q = await newRequest(E.cal1, 'Instructivo pedido por Calidad');
    const qAuth = await taskOf(q, 'autorizacion_creacion');
    await expect(decideTask(prisma, notifier, qAuth.id_task, { decision: 'aprobar' }, actor(E.cal1))).rejects.toThrow(/otra persona de Aseguramiento de Calidad/);
    expect((await getRequestDetail(prisma, q, await viewer(E.cal1))).tasks.find((t) => t.key === 'autorizacion_creacion')).toMatchObject({ myAction: null, canReject: true, blockedReason: expect.stringMatching(/otra persona/) });
    expect(await authorize(q, E.cal2)).toMatchObject({ next: 'elaboracion' });
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: q } })).elaborator_email).toBe(E.cal1);

    // R16: la redirección de la elaboración es solo de Calidad (con motivo); el elaborador no la pasa a otro.
    await expect(reassignTask(prisma, notifier, await accessOf(E.sol), elab.id_task, { toEmail: E.par, reason: 'Que la haga mi compañero' }, actor(E.sol))).rejects.toThrow(/solo Aseguramiento de Calidad redirige/);
    expect(await reassignTask(prisma, notifier, await accessOf(E.cal1), elab.id_task, { toEmail: E.par, reason: 'Excepción: el solicitante está de vacaciones' }, actor(E.cal1))).toMatchObject({ idAssignee: expect.any(Number) });
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } })).elaborator_email).toBe(E.par);
    await reassignTask(prisma, notifier, await accessOf(E.cal1), (await taskOf(r, 'elaboracion')).id_task, { toEmail: E.sol, reason: 'Regresó el solicitante, vuelve a elaborar' }, actor(E.cal1));
  });

  it('[SGC-REQ-158] R15: el rechazo de la creación CIERRA la solicitud con su motivo y el documento vigente enlazado, avisa al solicitante y queda en la auditoría', async () => {
    const r = await newRequest(E.sol, 'Procedimiento que ya existe');
    const auth = await taskOf(r, 'autorizacion_creacion');
    await expect(decideTask(prisma, notifier, auth.id_task, { decision: 'rechazar', comment: 'corto' }, actor(E.cal1))).rejects.toThrow(/mínimo 10/);
    await expect(decideTask(prisma, notifier, auth.id_task, { decision: 'rechazar', comment: 'Ya existe un procedimiento vigente', linkedDocumentId: 999_999 }, actor(E.cal1))).rejects.toMatchObject({ status: 409 });
    sent.length = 0;
    const res = await decideTask(prisma, notifier, auth.id_task, { decision: 'rechazar', comment: 'Ya existe un procedimiento vigente que cubre el tema', linkedDocumentId: idVigente }, actor(E.cal1));
    expect(res).toMatchObject({ outcome: 'rechazada', next: 'cancelada' });
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } });
    expect(req).toMatchObject({ status: 'cancelada', current_task_key: null, closed_by: E.cal1 });
    expect(req.cancel_reason).toMatch(/^Creación NO autorizada por Aseguramiento de Calidad: Ya existe un procedimiento vigente que cubre el tema \(ya existe .+Procedimiento vigente de la prueba S15\)$/);
    expect(await prisma.sgcAuthorization.findFirstOrThrow({ where: { id_request: r } })).toMatchObject({ status: 'rechazada', decided_by: E.cal1 });
    expect(sent.find((x) => x.emails.includes(E.sol))?.payload.title).toMatch(/no autorizada/);
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, action: 'tarea.decision', entity_id: String(auth.id_task) } });
    expect(JSON.parse(audit.after_json!)).toMatchObject({ decision: 'rechazar', outcome: 'rechazada', next: 'cancelada', linkedDocument: { id: idVigente } });
    await expect(decideTask(prisma, notifier, auth.id_task, { decision: 'aprobar' }, actor(E.cal2))).rejects.toMatchObject({ status: 409 });
    // En un paso sin «rechazar» (versión anterior), rechazar desde Autorizaciones sigue siendo devolver.
    expect((await getRequestDetail(prisma, r, await viewer(E.sol))).request).toMatchObject({ status: 'cancelada', roleModel: 'solicitante_elabora' });
  });

  it('[SGC-REQ-159][SGC-REQ-160] R17/R18: el elaborador asigna (sin sugerencia) a personas de su departamento; el revisor también puede ser de Calidad; el aprobador no', async () => {
    const r = await newRequest(E.sol, 'Procedimiento de despeje de línea');
    await authorize(r);
    await expect(setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.par], mode: 'paralelo' }, actor(E.otro), await accessOf(E.otro))).rejects.toMatchObject({ status: 403 });
    await expect(setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.otro], mode: 'paralelo' }, actor(E.sol), await accessOf(E.sol))).rejects.toThrow(/no es del departamento de quien elabora \(S15 PRODUCCIÓN\) ni de Aseguramiento de Calidad/);
    await expect(setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.sol], mode: 'paralelo' }, actor(E.sol), await accessOf(E.sol))).rejects.toThrow(/El elaborador no puede/);
    expect(await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.par, E.cal1], mode: 'paralelo' }, actor(E.sol), await accessOf(E.sol))).toEqual({ changed: true });
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.cal2], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).rejects.toThrow(/no puede quedar en «Aprobación»/);
    expect(await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).toEqual({ changed: true });
    // Quedan CONFIRMADOS (no sugeridos) y la pantalla solo ofrece al departamento.
    expect(await prisma.sgcRequestSigner.count({ where: { id_request: r, is_active: true } })).toBe(3);
    const detail = await getRequestDetail(prisma, r, await viewer(E.sol));
    expect(detail.permissions).toMatchObject({ canChangeSigners: true, signersSuggestOnly: false, canConfirmSuggestion: false, isElaborator: true, isRequester: true });
    expect(detail.signerScope).toMatchObject({ restricted: true, departments: ['S15 PRODUCCIÓN'], leadersEnforced: false, notice: null });
    expect(detail.signerScope!.reviewers).toEqual(expect.arrayContaining([E.par, E.jefe, E.cal1, E.cal2]));
    expect(detail.signerScope!.reviewers).not.toContain(E.otro);
    expect(detail.signerScope!.approvers).toEqual(expect.arrayContaining([E.par, E.jefe]));
    expect(detail.signerScope!.approvers).not.toContain(E.cal1);
  });

  it('[SGC-REQ-161] R19/D16: con la lista por departamento APAGADA aprueba cualquiera del departamento; encendida, solo sus líderes (sin líderes cargados, avisa); la lista del S12 no se activa por ellos', async () => {
    expect((await getCompanySettings(prisma, CO)).approverDepartmentEnforced).toBe(false);
    await saveCompanySettings(prisma, CO, { approverDepartmentEnforced: true, reason: 'Prueba: aprueban solo los líderes de departamento' }, actor(E.cal1));
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: SGC_DEPARTMENT_LEADERS_ACTION } })).toBe(1);
    const r = await newRequest(E.sol, 'Procedimiento con líder obligatorio');
    await authorize(r);
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).rejects.toThrow(/no tiene líderes aprobadores cargados/);
    // La pantalla tampoco ofrece aprobadores y avisa; sin departamento del elaborador, avisa a TI; el modelo anterior no restringe.
    const req0 = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } });
    expect(await signerScopeFor(prisma, req0, { roleModel: 'solicitante_elabora' })).toMatchObject({ restricted: true, leadersEnforced: true, approvers: [], notice: expect.stringMatching(/líder/) });
    expect(await signerScopeFor(prisma, { ...req0, elaborator_email: 'sin.departamento@ci.test' }, { roleModel: 'solicitante_elabora' })).toMatchObject({ departments: [], notice: expect.stringMatching(/no tiene departamento/) });
    expect(await signerScopeFor(prisma, req0, {})).toBeNull();
    const cal = await accessOf(E.cal1);
    await expect(grantApproverAuthorization(prisma, cal, { email: E.otro, idDepartment: deptProd, reason: 'Líder de producción (no pertenece)' }, actor(E.cal1))).rejects.toThrow(/no pertenece a ese departamento/);
    await expect(grantApproverAuthorization(prisma, cal, { email: E.jefe, idDepartment: deptProd, idProcessMap: procGC, reason: 'Ambos a la vez' }, actor(E.cal1))).rejects.toThrow(/por departamento o por proceso/);
    await grantApproverAuthorization(prisma, cal, { email: E.jefe, idDepartment: deptProd, reason: 'Jefe de producción: líder que aprueba' }, actor(E.cal1));
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.par], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).rejects.toThrow(/no es líder aprobador vigente/);
    expect(await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).toEqual({ changed: true });
    expect((await getRequestDetail(prisma, r, await viewer(E.sol))).signerScope).toMatchObject({ leadersEnforced: true, approvers: [E.jefe] });
    // Al decidir la aprobación y al sustituir a un aprobador se aplica la misma lista (y la del S12 en el modelo anterior).
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } });
    const v7 = { roleModel: 'solicitante_elabora' as const };
    expect(await canApproveFor(prisma, req, v7, E.jefe, new Date())).toBe(true);
    expect(await canApproveFor(prisma, req, v7, E.par, new Date())).toBe(false);
    expect(await canApproveFor(prisma, req, {}, E.par, new Date())).toBe(true);
    const aprob = { assignment: 'firmantes', signatureMeaning: 'aprobo' } as const;
    expect(await substituteApproverCheck(prisma, req, v7, aprob, E.par, new Date())).toEqual({ mustBeAuthorizedApprover: true, isAuthorizedApprover: false });
    expect(await substituteApproverCheck(prisma, req, v7, aprob, E.jefe, new Date())).toEqual({ mustBeAuthorizedApprover: true, isAuthorizedApprover: true });
    expect(await substituteApproverCheck(prisma, req, {}, aprob, E.par, new Date())).toEqual({ mustBeAuthorizedApprover: true, isAuthorizedApprover: true });
    expect(await substituteApproverCheck(prisma, req, v7, { assignment: 'firmantes', signatureMeaning: 'reviso' }, E.otro, new Date())).toEqual({ mustBeAuthorizedApprover: false, isAuthorizedApprover: false });
    // La lista del S12 (por proceso) sigue vacía: los líderes no la activan.
    expect((await getApproverPolicy(prisma, CO)).applies).toBe(false);
    expect(await listApproverAuthorizations(prisma, cal)).toMatchObject({ applies: false, departmentEnforced: true, departmentLeaders: 1 });
    await saveCompanySettings(prisma, CO, { approverDepartmentEnforced: false, reason: 'Prueba: vuelve a sin restricción (D16)' }, actor(E.cal1));
    expect(await canApproveFor(prisma, req, v7, E.par, new Date())).toBe(true);
    expect(await substituteApproverCheck(prisma, req, v7, aprob, E.par, new Date())).toEqual({ mustBeAuthorizedApprover: false, isAuthorizedApprover: true });
  });

  it('[SGC-REQ-159][SGC-REQ-162] de punta a punta: firmas del departamento, el CREADOR prepara y dicta la capacitación y Calidad la cierra (D18); la versión queda vigente', async () => {
    const r = await newRequest(E.sol, 'Procedimiento con capacitación del creador', 'si');
    await authorize(r);
    await uploadAttachment(prisma, upload, r, { purpose: 'borrador', ...docx('Procedimiento con capacitación') }, await viewer(E.sol), actor(E.sol));
    // Sin firmantes no se envía (el mensaje habla al elaborador).
    await expect(signTask(prisma, deps, (await taskOf(r, 'elaboracion')).id_task, firma('elaboro'), actor(E.sol))).rejects.toThrow(/Asigne los firmantes de «Revisión» \(personas de su departamento\)/);
    await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.par], mode: 'paralelo' }, actor(E.sol), await accessOf(E.sol));
    await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe], mode: 'orden' }, actor(E.sol), await accessOf(E.sol));
    await addScopeEntry(prisma, notifier, await accessOf(E.sol), r, { entry: { kind: 'persona', email: E.l1 }, reason: 'Lectora de la prueba del S15' }, actor(E.sol));
    await signTask(prisma, deps, (await taskOf(r, 'elaboracion')).id_task, firma('elaboro'), actor(E.sol));
    await signTask(prisma, deps, (await taskOf(r, 'revision')).id_task, firma('reviso'), actor(E.par));
    const apr = await taskOf(r, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.jefe));
    expect(await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal2))).toMatchObject({ next: 'preparacion_capacitacion' });
    // R27: la preparación llega al creador (sin grupo); él registra el material con «Quién dicta».
    const prep = await taskOf(r, 'preparacion_capacitacion');
    expect(prep.assignees).toEqual([expect.objectContaining({ user_email: E.sol, pool_type_code: null })]);
    const training = { mode: 'sesion', title: 'Capacitación del procedimiento S15', formsUrl: 'https://forms.office.com/r/s15', sessionDate: '2026-10-20', instructor: 'SOL.S15 (sol.s15@onelatampharma.com)', maxScore: 10, minScorePct: 80 };
    await expect(saveTraining(prisma, await accessOf(E.otro), r, training, actor(E.otro))).rejects.toThrow(/o el creador del documento/);
    await saveTraining(prisma, await accessOf(E.sol), r, training, actor(E.sol));
    expect((await getRequestDetail(prisma, r, await viewer(E.sol))).training).toMatchObject({ phase: 'material', canManage: true, byCreator: true, training: { instructor: training.instructor } });
    expect(await decideTask(prisma, notifier, prep.id_task, { decision: 'aprobar', comment: 'Material listo' }, actor(E.sol))).toMatchObject({ next: 'divulgacion' });
    const div = await taskOf(r, 'divulgacion');
    const a = div.assignees.find((x) => x.user_email === E.l1)!;
    await openReadingFile(prisma, a.id_task_assignee, await viewer(E.l1), actor(E.l1));
    await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 1 }, { email: E.l1 }, actor(E.l1));
    expect(await signTask(prisma, deps, div.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(E.l1))).toMatchObject({ next: 'capacitacion' });
    // Capacitación: el creador (primero) y el cierre del grupo de Calidad (después), en orden.
    const cap = await taskOf(r, 'capacitacion');
    expect(cap.signing_mode).toBe('orden');
    expect(cap.assignees.map((x) => [x.user_email, x.pool_type_code, x.sign_order])).toEqual([
      [E.sol, null, 1],
      [null, 'SGC-VERIF-CALIDAD', 2],
    ]);
    const csv = ['Marca temporal,Dirección de correo electrónico,Puntuación', `20/10/2026 10:00:00,${E.l1},9 / 10`].join('\n');
    await uploadTrainingResults(prisma, upload, await accessOf(E.sol), r, { fileName: 'Resultados.csv', bytes: new TextEncoder().encode(csv) }, actor(E.sol));
    await expect(signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal2))).rejects.toMatchObject({ status: 409 });
    expect(await signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.sol))).toMatchObject({ outcome: 'abierta' });
    const res = await signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal2));
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'completada', published: { versionNumber: 1 } });
  });

  /** Solicitud de Calidad (Garantía de Calidad) llevada hasta la tarea de capacitación. */
  async function calidadToTraining(subject: string) {
    const r = await newRequest(E.cal1, subject, 'si');
    await authorize(r, E.cal2);
    await uploadAttachment(prisma, upload, r, { purpose: 'borrador', ...docx(subject) }, await viewer(E.cal1), actor(E.cal1));
    // Calidad elabora: sus firmantes son de SU departamento (Garantía de Calidad); el revisor también puede aprobar.
    await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.cal2], mode: 'paralelo' }, actor(E.cal1), await accessOf(E.cal1));
    await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.cal2], mode: 'orden' }, actor(E.cal1), await accessOf(E.cal1));
    await addScopeEntry(prisma, notifier, await accessOf(E.cal1), r, { entry: { kind: 'persona', email: E.l1 }, reason: 'Lectora de la prueba del S15' }, actor(E.cal1));
    await signTask(prisma, deps, (await taskOf(r, 'elaboracion')).id_task, firma('elaboro'), actor(E.cal1));
    await signTask(prisma, deps, (await taskOf(r, 'revision')).id_task, firma('reviso'), actor(E.cal2));
    const apr = await taskOf(r, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.cal2));
    // El cupo del grupo de verificación no lo toma quien elaboró.
    await expect(signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal1))).rejects.toMatchObject({ status: 403 });
    expect(await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal2))).toMatchObject({ next: 'preparacion_capacitacion' });
    await saveTraining(prisma, await accessOf(E.cal1), r, { mode: 'video', title: `Video: ${subject}`, videoUrl: 'https://www.youtube.com/watch?v=s15', formsUrl: 'https://forms.office.com/r/s15b', maxScore: 10, minScorePct: 80 }, actor(E.cal1));
    await decideTask(prisma, notifier, (await taskOf(r, 'preparacion_capacitacion')).id_task, { decision: 'aprobar' }, actor(E.cal1));
    const div = await taskOf(r, 'divulgacion');
    const a = div.assignees.find((x) => x.user_email === E.l1)!;
    await openReadingFile(prisma, a.id_task_assignee, await viewer(E.l1), actor(E.l1));
    await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 1 }, { email: E.l1 }, actor(E.l1));
    await signTask(prisma, deps, div.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(E.l1));
    const csv = ['Marca temporal,Dirección de correo electrónico,Puntuación', `20/10/2026 10:00:00,${E.l1},10 / 10`].join('\n');
    await uploadTrainingResults(prisma, upload, await accessOf(E.cal1), r, { fileName: 'Resultados.csv', bytes: new TextEncoder().encode(csv) }, actor(E.cal1));
    return { r, cap: await taskOf(r, 'capacitacion') };
  }

  it('[SGC-REQ-162] D18 encendida: quien dictó y firmó «Capacitó» no toma también el cierre del grupo, aunque sea de Calidad', async () => {
    const { r, cap } = await calidadToTraining('Instructivo de Calidad con cierre de otra persona');
    expect(cap.assignees.map((x) => [x.user_email, x.pool_type_code])).toEqual([
      [E.cal1, null],
      [null, 'SGC-VERIF-CALIDAD'],
    ]);
    expect(await signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal1))).toMatchObject({ outcome: 'abierta' });
    await expect(signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal1))).rejects.toThrow(/el cierre del grupo lo hace otra persona/);
    expect((await getRequestDetail(prisma, r, await viewer(E.cal1))).tasks.find((t) => t.key === 'capacitacion')).toMatchObject({ myAction: null, blockedReason: expect.stringMatching(/otra persona/) });
    expect(await signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal2))).toMatchObject({ outcome: 'resuelta', next: 'completada' });
  });

  it('[SGC-REQ-162] D18 apagada: la capacitación la cierra el creador solo (sin cupo del grupo)', async () => {
    await saveCompanySettings(prisma, CO, { trainingClosedByQuality: false, reason: 'Prueba: el creador cierra la capacitación' }, actor(E.cal1));
    expect((await getCompanySettings(prisma, CO)).trainingClosedByQuality).toBe(false);
    const { cap } = await calidadToTraining('Instructivo de Calidad cerrado por el creador');
    expect(cap.assignees.map((x) => x.user_email)).toEqual([E.cal1]);
    expect(cap.signing_mode).toBeNull();
    expect(await signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal1))).toMatchObject({ outcome: 'resuelta', next: 'completada' });
    await saveCompanySettings(prisma, CO, { trainingClosedByQuality: true, reason: 'Prueba: vuelve al cierre de Calidad (D18)' }, actor(E.cal1));
  });

  it('[SGC-REQ-158] la reversa de datos publica una versión con el modelo anterior (idempotente) y no toca las versiones ni las solicitudes', async () => {
    const before = await getCurrentFlowVersion(prisma, CO, 'DOC');
    const v7Requests = await prisma.sgcRequest.count({ where: { id_flow_version: before.version.id_flow_version } });
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s15-flujo-doc-v7-reversa.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s15-flujo-doc-v7-reversa.sql'));
    const after = await getCurrentFlowVersion(prisma, CO, 'DOC');
    expect(after.version.version_number).toBe(before.version.version_number + 1);
    expect(after.version.role_model).toBeNull();
    const def = await loadDefinition(prisma, after.version.id_flow_version);
    expect(def.roleModel).toBeUndefined();
    expect(def.tasks.map((t) => [t.key, t.stepOrder, t.assignment])).toEqual([
      ['solicitud', 0, 'solicitante'],
      ['elaboracion', 1, 'elaborador'],
      ['revision', 2, 'firmantes'],
      ['aprobacion', 3, 'firmantes'],
      ['preparacion_capacitacion', 4, 'calidad'],
      ['divulgacion', 5, 'alcance'],
      ['capacitacion', 6, 'calidad'],
    ]);
    expect(normalizeFlowDefinition(def)).toBeTruthy();
    expect(await prisma.sgcRequest.count({ where: { id_flow_version: before.version.id_flow_version } })).toBe(v7Requests);
    // Y otra vez hacia adelante (el SQL del DOC v7 es idempotente sobre la versión vigente).
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s15-flujo-doc-v7-olp.sql'));
    expect((await getCurrentFlowVersion(prisma, CO, 'DOC')).version.role_model).toBe('solicitante_elabora');
  });
});
