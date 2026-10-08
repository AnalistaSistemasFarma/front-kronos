import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { addCargoMember, deactivateCargoMember, listCargoMembers } from '../../../lib/sgc/db/cargoMembers';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { addScopeEntry, getMyReading, openReadingFile, recordReadingEvent, removeScopeEntry, sendReadingReminders } from '../../../lib/sgc/db/dissemination';
import { canViewDocument, createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getCurrentFlowVersion, loadDefinition } from '../../../lib/sgc/db/flows';
import { addNote, cancelRequest, closeDissemination, confirmSuggestions, createRequest, decideTask, excludeReader, getAttachmentForDownload, getRequestDetail, getTaskDetail, listTaskInbox, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import { listDraftRevisions } from '../../../lib/sgc/db/drafts';
import { signTask, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import { saveTraining, uploadTrainingResults } from '../../../lib/sgc/db/training';
import { verifyVersionByCode } from '../../../lib/sgc/db/verify';
import { annulUnpublishedVersion, colombiaToday, publishApprovedVersion } from '../../../lib/sgc/db/vigencia';
import { signedContentInTx } from '../../../lib/sgc/db/signatureRecord';
import { normalizeFlowDefinition } from '../../../lib/sgc/flows/definition';
import { SGC_DOCUMENT_FLOW_V3 } from '../../../lib/sgc/flows/documentFlow';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import { readManifest } from '../../../lib/sgc/pdf/controlledPdf';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';
import { sha256HexOf } from '../../../lib/sgc/signature/record';

/**
 * Sprint 4 contra un SQL Server REAL (efímero en CI): DIVULGACIÓN con
 * lectura obligatoria firmada («Leyó» con el servicio de firma propio del
 * S3), alcance por departamento, cargo y persona, cobertura y recordatorios;
 * CAPACITACIÓN con el Excel de resultados de Microsoft Forms y firma
 * «Capacitó»; VIGENCIA automática (la versión nueva pasa a vigente y la
 * anterior a obsoleta), cancelación en la divulgación (anula la versión
 * aprobada) y verificación por QR.
 *
 * Usa una empresa PROPIA (id 70) sembrada con los mismos SQL del pase (S1,
 * S2, S3 y S4, cambiando solo el id).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 4 · divulgación, capacitación y vigencia con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 70;
  const PW = 'Clave-S4-ci#2026';
  // 2026-10-05: el solicitante (sol) solo SUGIERE firmantes y alcance; el elaborador (elab) es de
  // Aseguramiento de Calidad y es quien los confirma o asigna (SGC_ASIGNACION_PERMISO = tarea_y_calidad).
  const E = {
    sol: 'sol.s4@onelatampharma.com',
    elab: 'elab.s4@onelatampharma.com',
    rev: 'rev.s4@onelatampharma.com',
    apr: 'apr.s4@onelatampharma.com',
    cal: 'calidad.s4@onelatampharma.com',
    l1: 'lector1.s4@onelatampharma.com',
    l2: 'lector2.s4@onelatampharma.com',
    l3: 'lector3.s4@onelatampharma.com',
    sinAcceso: 'sin.acceso.s4@onelatampharma.com',
    ajeno: 'ajeno.s4@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.4.4.4', userAgent: 'vitest-s4' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const store = new Map<string, Uint8Array>();
  const uploads: { id: string; segments: string[]; fileName: string }[] = [];
  const upload: SgcUploader = async (segments, fileName, content) => {
    const id = `s4-${uploads.length + 1}`;
    store.set(id, new Uint8Array(content));
    uploads.push({ id, segments, fileName });
    return { id };
  };
  const pdfOf = async (text: string, pages = 1) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) pdf.addPage([595.28, 841.89]).drawText(`${text} · página ${i + 1}`, { x: 50, y: 750, size: 11, font });
    return pdf.save();
  };
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (itemId) => {
      const b = store.get(itemId);
      if (!b) throw new Error(`item ${itemId} no existe`);
      return b;
    },
    htmlToPdf: async () => pdfOf('Contenido convertido', 2),
    docxToHtml: async () => '<h1>Procedimiento S4</h1><p>Contenido del Word convertido.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: { orderBy: { sign_order: 'asc' } } } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba de integración S4`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  const xlsx = async (rows: unknown[][]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Form1');
    rows.forEach((r) => ws.addRow(r));
    return new Uint8Array(await wb.xlsx.writeBuffer());
  };
  const HEAD = ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Total de puntos'];

  let procGC = 0;
  let typePR = 0;
  let dept = 0;
  let cargo = 0;
  let idDoc = 0;
  let idV1 = 0;
  let reqA = 0;

  /** Solicitud de nueva versión llevada por elaboración, revisión y aprobación (con PDF controlado). */
  async function approvedRequest(subject: string): Promise<number> {
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nueva_version', subject, description: 'Nueva versión para la prueba del Sprint 4.', idDocument: idDoc, formValues: { urgencia: 'Normal' } }, actor(E.sol));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx(subject) }, await viewer(E.elab), actor(E.elab));
    return idRequest;
  }
  async function signThroughApproval(idRequest: number) {
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(idRequest, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    return signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
  }
  async function readToEnd(idRequest: number, email: string) {
    const t = await taskOf(idRequest, 'divulgacion');
    const a = t.assignees.find((x) => x.user_email === email)!;
    await openReadingFile(prisma, a.id_task_assignee, await viewer(email), actor(email));
    await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 4 }, { email }, actor(email));
    return { idTask: t.id_task, idAssignee: a.id_task_assignee };
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S4 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    // Sprint 8: esta suite usa borradores PDF y el encabezado opcional (modo configurable header_mandatory = 0);
    // el encabezado OBLIGATORIO se prueba en tests/integration/sgc/s8.integration.test.ts.
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, header_mandatory: false, storage_root: 'SGC/S4', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true, header_mandatory: false } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S4 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    dept = (await prisma.department.create({ data: { department: `Producción S4 CI ${Date.now()}` } })).id_department;
    cargo = (await prisma.cargo.create({ data: { nombre_normalizado: `ANALISTA DE CALIDAD S4 CI ${Date.now()}` } })).id_cargo;
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[], boolean][] = [
      [E.sol, ['gestion'], false],
      [E.elab, ['gestion', 'calidad'], false],
      [E.rev, ['gestion'], true],
      [E.apr, ['gestion'], false],
      [E.cal, ['calidad'], false],
      [E.l1, ['lectura'], true],
      [E.l2, ['lectura'], true],
      [E.l3, ['lectura'], false],
      [E.sinAcceso, [], true],
      [E.ajeno, ['lectura'], false],
    ];
    for (const [email, perms, inDept] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
      if (inDept) await prisma.departmentUser.create({ data: { id_user: user.id, id_department: dept } });
    }
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s1-maestros-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s2-flujo-documental-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s3-firma-calidad-olp.sql'));
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    // 2026-10-05 (#536): el elaborador sale de la matriz de responsables (proceso × tipo); una fila
    // por persona deja determinista quién elabora (el elaborador de Calidad de la prueba).
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typePR, userEmail: E.elab, reason: 'Elaborador de Calidad de la prueba' }, actor(E.cal));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba S4' }, actor('ci@x.co'));
    const doc = await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title: 'Control de documentos S4', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-01-15', pdf: { bytes: await pdfOf('vigente V1'), fileName: 'v1.pdf' } }, actor(E.cal));
    idDoc = doc.idDocument;
    idV1 = doc.idVersion;
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-052] las 6 tablas del S4 viven en `sgc` con sus triggers; el SQL del pase publica DOC con los pasos 4 y 5 habilitados (idempotente) y coincide con el código', async () => {
    const rows = await prisma.$queryRaw<{ tabla: string; esquema: string }[]>`
      SELECT t.name AS tabla, s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name IN ('dissemination_scope','read_record','training','training_upload','training_result','cargo_member')`;
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.esquema))).toEqual(new Set(['sgc']));
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('dissemination_scope_sin_borrado','read_record_sin_borrado','read_record_firma_inmodificable','training_sin_borrado','training_upload_solo_insercion','training_result_solo_insercion','cargo_member_sin_borrado')`;
    expect(trg).toHaveLength(7);
    const before = await getCurrentFlowVersion(prisma, CO, 'DOC');
    await prisma.$executeRawUnsafe(seed('2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql'));
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'DOC');
    expect(version.version_number).toBe(before.version.version_number + 1);
    expect(await prisma.sgcFlowVersion.findUniqueOrThrow({ where: { id_flow_version: before.version.id_flow_version } })).toMatchObject({ status: 'retirada' });
    const def = await loadDefinition(prisma, version.id_flow_version);
    expect(normalizeFlowDefinition(def)).toEqual(normalizeFlowDefinition(JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V3))));
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: 'version.publicada', id_flow_version: version.id_flow_version } })).toBe(1);
    expect(process.code).toBe('DOC');
  });

  it('[SGC-REQ-064] Calidad registra personas por cargo (no se borran; una sola fila activa por persona y cargo)', async () => {
    await addCargoMember(prisma, CO, { idCargo: cargo, email: E.l3, reason: 'Inducción S4' }, actor(E.cal));
    await expect(addCargoMember(prisma, CO, { idCargo: cargo, email: E.l3, reason: 'Repetido' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(addCargoMember(prisma, CO, { idCargo: cargo, email: 'nadie@x.co', reason: 'No existe' }, actor(E.cal))).rejects.toThrow(/no pertenece/);
    await expect(addCargoMember(prisma, CO, { idCargo: 0, email: E.l3, reason: 'x' }, actor(E.cal))).rejects.toThrow(/cargo/);
    const { id } = await addCargoMember(prisma, CO, { idCargo: cargo, email: E.ajeno, reason: 'Temporal' }, actor(E.cal));
    await deactivateCargoMember(prisma, CO, id, { reason: 'Ya no ocupa el cargo' }, actor(E.cal));
    await expect(deactivateCargoMember(prisma, CO, id, { reason: 'Otra vez' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const list = await listCargoMembers(prisma, CO);
    expect(list.members.filter((m) => m.idCargo === cargo).map((m) => m.email)).toEqual([E.l3]);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[cargo_member] WHERE id_company = ${CO}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-053] el alcance se define antes de la divulgación (lo sugiere el solicitante y lo confirma el elaborador de Calidad) por departamento, cargo y persona; nada se borra', async () => {
    reqA = await approvedRequest('Nueva versión con divulgación S4');
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.rev), reqA, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(E.rev))).rejects.toMatchObject({ status: 403 });
    // 2026-10-05 (decisión de Nicolás): antes «el elaborador o Calidad»; con la política por defecto (tarea_y_calidad)
    // selecciona quien ejecuta la primera tarea (la elaboración) con el permiso de Calidad. Calidad sin ser el elaborador, no.
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.cal), reqA, { entry: { kind: 'cargo', idCargo: cargo }, reason: 'Analistas de Calidad' }, actor(E.cal))).rejects.toMatchObject({ status: 403 });
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqA, { entry: { kind: 'departamento', idDepartment: dept }, reason: 'Área usuaria del procedimiento' }, actor(E.elab));
    // El solicitante SUGIERE (queda pendiente) y el elaborador de Calidad confirma con un clic.
    expect(await addScopeEntry(prisma, notifier, await accessOf(E.sol), reqA, { entry: { kind: 'cargo', idCargo: cargo }, reason: 'Analistas de Calidad' }, actor(E.sol))).toMatchObject({ suggested: true });
    expect(await prisma.sgcDisseminationScope.findFirstOrThrow({ where: { id_request: reqA, kind: 'cargo' } })).toMatchObject({ is_active: false, removed_at: null, added_by: E.sol });
    const pendingView = (await getRequestDetail(prisma, reqA, await viewer(E.elab))).dissemination!;
    expect(pendingView.scope.map((s) => [s.kind, s.suggested])).toEqual([
      ['departamento', false],
      ['cargo', true],
    ]);
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.sol), reqA, { entry: { kind: 'cargo', idCargo: cargo }, reason: 'Repetido' }, actor(E.sol))).rejects.toThrow(/ya está sugerida/);
    // Quien sugiere retira lo que sugirió, pero no lo confirmado.
    const sugAjeno = await addScopeEntry(prisma, notifier, await accessOf(E.sol), reqA, { entry: { kind: 'persona', email: E.ajeno }, reason: 'Sugerencia que se retira' }, actor(E.sol));
    await removeScopeEntry(prisma, await accessOf(E.sol), reqA, sugAjeno.idScope, { reason: 'Ya no se sugiere' }, actor(E.sol));
    const deptRow = await prisma.sgcDisseminationScope.findFirstOrThrow({ where: { id_request: reqA, kind: 'departamento', is_active: true } });
    await expect(removeScopeEntry(prisma, await accessOf(E.sol), reqA, deptRow.id_scope, { reason: 'Retirar lo confirmado' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    // Lo sugerido sin confirmar no deja completar la primera tarea (la elaboración).
    await expect(decideTask(prisma, notifier, (await taskOf(reqA, 'elaboracion')).id_task, { decision: 'aprobar' }, actor(E.elab))).rejects.toThrow(/SUGERIDOS sin confirmar/);
    await expect(confirmSuggestions(prisma, notifier, reqA, actor(E.sol), await accessOf(E.sol))).rejects.toMatchObject({ status: 403 });
    expect(await confirmSuggestions(prisma, notifier, reqA, actor(E.elab), await accessOf(E.elab))).toEqual({ confirmed: 0, confirmedScope: 1, confirmedTraining: false });
    const tmp = await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqA, { entry: { kind: 'persona', email: E.ajeno }, reason: 'Por error' }, actor(E.elab));
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.elab), reqA, { entry: { kind: 'departamento', idDepartment: dept }, reason: 'Repetido' }, actor(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.elab), reqA, { entry: { kind: 'departamento', idDepartment: 999999 }, reason: 'No existe' }, actor(E.elab))).rejects.toThrow(/no existe/);
    await removeScopeEntry(prisma, await accessOf(E.elab), reqA, tmp.idScope, { reason: 'Se agregó por error' }, actor(E.elab));
    await expect(removeScopeEntry(prisma, await accessOf(E.elab), reqA, tmp.idScope, { reason: 'Otra vez' }, actor(E.elab))).rejects.toMatchObject({ status: 409 });
    const detail = await getRequestDetail(prisma, reqA, await viewer(E.elab));
    expect(detail.dissemination).toMatchObject({ started: false, canEditScope: true, canRemoveScope: true });
    expect(detail.dissemination!.scope.map((s) => s.kind)).toEqual(['departamento', 'cargo']);
    expect(detail.dissemination!.withoutAccess).toEqual([E.sinAcceso]);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[dissemination_scope] WHERE id_request = ${reqA}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-054][SGC-REQ-065] al aprobarse, la divulgación crea una tarea de lectura por persona del alcance (con acceso al SGC) y lo notifica; la versión anterior sigue vigente', async () => {
    sent.length = 0;
    const res = await signThroughApproval(reqA);
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'divulgacion', controlledPdf: { status: 'generado' } });
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    expect(r).toMatchObject({ status: 'abierta', current_task_key: 'divulgacion', controlled_pdf_status: 'generado' });
    const t = await taskOf(reqA, 'divulgacion');
    expect(t.assignees.map((a) => a.user_email).sort()).toEqual([E.l1, E.l2, E.l3, E.rev].sort());
    expect(t.assignees.every((a) => a.signature_meaning === 'leyo' && a.status === 'pendiente')).toBe(true);
    expect(await prisma.sgcReadRecord.count({ where: { id_task: t.id_task } })).toBe(4);
    expect(sent.some((n) => n.payload.title.includes('Lectura obligatoria') && n.emails.includes(E.l1))).toBe(true);
    // La V1 sigue vigente mientras tanto.
    expect(await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).toMatchObject({ status: 'vigente', current_version_id: idV1 });
    // El PDF controlado lleva la URL de verificación del QR.
    const v2 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: r.id_document_version! } });
    expect((await readManifest(store.get(v2.pdf_item_id)!))!.verifyUrl).toBe(`https://synerlink.test/process/sgc-documental/verificar?empresa=${CO}&codigo=${encodeURIComponent((await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).code)}&version=2`);
    // Bandeja del lector y vista SOLO de lectura (sin el expediente de elaboración).
    const inbox = await listTaskInbox(prisma, E.l1, await getSgcAccessForUser(prisma, E.l1), { idRequest: reqA });
    expect(inbox).toEqual([expect.objectContaining({ idTask: t.id_task, status: 'abierta' })]);
    const mine = await getTaskDetail(prisma, t.id_task, await viewer(E.l1));
    expect(mine).toMatchObject({ readerOnly: true, interactions: [], attachments: [], currentDraft: null, dissemination: null, training: null });
    expect(mine.tasks).toHaveLength(1);
    expect(mine.tasks[0].assignees.map((a) => a.email)).toEqual([E.l1]);
    expect(mine.tasks[0].myAction).toMatchObject({ kind: 'leer', signatureMeaning: 'leyo' });
    expect(mine.reading).toMatchObject({ status: 'pendiente', pdfReady: true, openedAt: null, content: { ref: `version:${v2.id_document_version}`, sha256: v2.pdf_sha256.trim() } });
    // El revisor, aunque también es lector, sigue viendo todo (participó en la elaboración).
    expect((await getRequestDetail(prisma, reqA, await viewer(E.rev))).readerOnly).toBe(false);
    await expect(getRequestDetail(prisma, reqA, await viewer(E.ajeno))).rejects.toMatchObject({ status: 404 });
  });

  it('[SGC-REQ-085] quien SOLO es lector no entra al expediente por la API: ni notas, ni adjuntos, ni borradores', async () => {
    const asReader = await viewer(E.l1);
    await expect(addNote(prisma, notifier, reqA, { body: 'Nota de un lector' }, asReader, actor(E.l1))).rejects.toMatchObject({ status: 404 });
    await expect(uploadAttachment(prisma, upload, reqA, { purpose: 'soporte', ...docx('soporte') }, asReader, actor(E.l1))).rejects.toMatchObject({ status: 404 });
    const att = await prisma.sgcAttachment.findFirstOrThrow({ where: { id_request: reqA } });
    await expect(getAttachmentForDownload(prisma, reqA, att.id_attachment, asReader, actor(E.l1))).rejects.toMatchObject({ status: 404 });
    await expect(listDraftRevisions(prisma, reqA, asReader)).rejects.toMatchObject({ status: 404 });
    // El revisor (también lector) sí, porque participó en la elaboración.
    await expect(getAttachmentForDownload(prisma, reqA, att.id_attachment, await viewer(E.rev), actor(E.rev))).resolves.toMatchObject({ fileName: att.file_name });
    // Su lectura sí la ve (vista propia del lector) y la versión en divulgación se verifica como tal.
    const t = await taskOf(reqA, 'divulgacion');
    expect(await getMyReading(prisma, t.id_task, E.l1)).toMatchObject({ status: 'pendiente', pdfReady: true, fileUrl: expect.stringContaining('/api/sgc/reading/') });
    expect(await getMyReading(prisma, t.id_task, E.ajeno)).toBeNull();
    const code = (await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).code;
    expect(await verifyVersionByCode(prisma, asReader.access, await getAccessSubject(prisma, E.l1), { idCompany: CO, code, versionNumber: 2 }, actor(E.l1))).toMatchObject({ verdict: 'en_divulgacion' });
  });

  it('[SGC-REQ-055] «Leído» NO se firma sin abrir el documento desde el servidor y llegar al final', async () => {
    const t = await taskOf(reqA, 'divulgacion');
    const a = t.assignees.find((x) => x.user_email === E.l1)!;
    await expect(signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(E.l1))).rejects.toThrow(/Abra el documento/);
    await expect(recordReadingEvent(prisma, a.id_task_assignee, { event: 'final' }, { email: E.l1 }, actor(E.l1))).rejects.toMatchObject({ status: 409 });
    await expect(openReadingFile(prisma, a.id_task_assignee, await viewer(E.l2), actor(E.l2))).rejects.toMatchObject({ status: 404 });
    const file = await openReadingFile(prisma, a.id_task_assignee, await viewer(E.l1), actor(E.l1));
    expect(file).toMatchObject({ versionNumber: 2, state: 'divulgacion' });
    await expect(signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(E.l1))).rejects.toThrow(/llega al final/);
    expect(await recordReadingEvent(prisma, a.id_task_assignee, { event: 'abierto' }, { email: E.l1 }, actor(E.l1))).toMatchObject({ reachedEndAt: null });
    const end = await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 4 }, { email: E.l1 }, actor(E.l1));
    expect(end.reachedEndAt).toBeTruthy();
    const rec = await prisma.sgcReadRecord.findUniqueOrThrow({ where: { id_task_assignee: a.id_task_assignee } });
    expect(rec).toMatchObject({ status: 'pendiente', open_count: 1, pages: 4 });
    expect(await prisma.sgcAuditLog.count({ where: { action: 'divulgacion.lectura_final', entity_id: String(rec.id_read_record) } })).toBe(1);
  });

  it('[SGC-REQ-056] firmar «Leído» reautentica y firma sobre el PDF controlado; la lectura firmada ya no cambia', async () => {
    const t = await taskOf(reqA, 'divulgacion');
    const a = t.assignees.find((x) => x.user_email === E.l1)!;
    await expect(signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee, password: 'errada' }), actor(E.l1))).rejects.toMatchObject({ status: 403 });
    await expect(signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee, draftSha256: 'f'.repeat(64) }), actor(E.l1))).rejects.toMatchObject({ status: 409 });
    const res = await signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(E.l1));
    expect(res).toMatchObject({ outcome: 'abierta', next: 'divulgacion' });
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    const v2 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: r.id_document_version! } });
    const sig = await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: reqA, meaning: 'leyo' } });
    expect(sig).toMatchObject({ signer_email: E.l1, content_kind: 'pdf_controlado', content_ref: `version:${v2.id_document_version}`, content_sha256: v2.pdf_sha256, auth_method: 'contrasena_synerlink', ip: '10.4.4.4' });
    const rec = await prisma.sgcReadRecord.findUniqueOrThrow({ where: { id_task_assignee: a.id_task_assignee } });
    expect(rec).toMatchObject({ status: 'leido', id_signature: sig.id_signature });
    await expect(signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(E.l1))).rejects.toThrow(/ya firmó/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[read_record] SET status = N'pendiente', id_signature = NULL, signed_at = NULL WHERE id_read_record = ${rec.id_read_record}`)).rejects.toThrow(/no cambia/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[read_record] WHERE id_read_record = ${rec.id_read_record}`)).rejects.toThrow(/no se borra/);
    // El PDF controlado alterado en OneDrive no se firma.
    const b = await readToEnd(reqA, E.l2);
    const good = store.get(v2.pdf_item_id)!;
    const bad = new Uint8Array(good);
    bad[100] ^= 1;
    store.set(v2.pdf_item_id, bad);
    await expect(signTask(prisma, deps, b.idTask, firma('leyo', { idAssignee: b.idAssignee }), actor(E.l2))).rejects.toThrow(/huella/);
    store.set(v2.pdf_item_id, good);
    expect((await getMyReading(prisma, b.idTask, E.l2))!.reachedEndAt).toBeTruthy();
  });

  it('[SGC-REQ-053][SGC-REQ-057] cobertura, recordatorios, ampliación del alcance por Calidad durante la divulgación y exclusión justificada', async () => {
    // 2026-10-05: el elaborador ahora es de Calidad; quien no es de Calidad (el solicitante) no envía recordatorios.
    await expect(sendReadingReminders(prisma, notifier, await accessOf(E.sol), reqA, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    sent.length = 0;
    expect(await sendReadingReminders(prisma, notifier, await accessOf(E.cal), reqA, actor(E.cal))).toEqual({ sent: 3 });
    expect(sent[0].payload.title).toMatch(/Recordatorio/);
    // 2026-10-05: durante la divulgación el solicitante ya no sugiere; amplía quien ejecutó la elaboración con el permiso de Calidad.
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.sol), reqA, { entry: { kind: 'persona', email: E.ajeno }, reason: 'Ampliar' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(removeScopeEntry(prisma, await accessOf(E.cal), reqA, 1, { reason: 'Retirar durante' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const add = await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqA, { entry: { kind: 'persona', email: E.ajeno }, reason: 'Ampliación: usa el procedimiento' }, actor(E.elab));
    expect(add.added).toBe(1);
    const t = await taskOf(reqA, 'divulgacion');
    const recAjeno = await prisma.sgcReadRecord.findFirstOrThrow({ where: { id_task: t.id_task, user_email: E.ajeno } });
    await expect(excludeReader(prisma, notifier, await accessOf(E.cal), reqA, recAjeno.id_read_record, { reason: 'corto' }, actor(E.cal))).rejects.toThrow(/mínimo 10/);
    await excludeReader(prisma, notifier, await accessOf(E.cal), reqA, recAjeno.id_read_record, { reason: 'Se retiró de la empresa (prueba S4)' }, actor(E.cal));
    await expect(excludeReader(prisma, notifier, await accessOf(E.cal), reqA, recAjeno.id_read_record, { reason: 'Se retiró de la empresa (prueba S4)' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    // Sprint 6 [SGC-REQ-085]: una lectura excluida ya no da acceso al PDF controlado.
    const cupoAjeno = await prisma.sgcTaskAssignee.findFirstOrThrow({ where: { id_task: t.id_task, user_email: E.ajeno } });
    await expect(openReadingFile(prisma, cupoAjeno.id_task_assignee, await viewer(E.ajeno), actor(E.ajeno))).rejects.toMatchObject({ status: 404 });
    const d = (await getRequestDetail(prisma, reqA, await viewer(E.cal))).dissemination!;
    expect(d.coverage).toMatchObject({ total: 5, read: 1, pending: 3, excluded: 1, percent: 25 });
    expect(d.readers.find((r) => r.email === E.l2)).toMatchObject({ status: 'pendiente', remindersSent: 1 });
    // 2026-10-05: Calidad gestiona la divulgación; ampliar el alcance queda en quien ejecutó la elaboración (de Calidad).
    expect(d).toMatchObject({ started: true, open: true, canManage: true, canEditScope: false, canRemoveScope: false });
    expect((await getRequestDetail(prisma, reqA, await viewer(E.elab))).dissemination).toMatchObject({ canManage: true, canEditScope: true, canRemoveScope: false });
  });

  it('[SGC-REQ-056][SGC-REQ-057] cuando todos los del alcance firman, la divulgación se cierra sola y pasa a la capacitación', async () => {
    for (const email of [E.l2, E.l3, E.rev]) {
      const { idTask, idAssignee } = await readToEnd(reqA, email);
      await signTask(prisma, deps, idTask, firma('leyo', { idAssignee }), actor(email));
    }
    expect(await taskOf(reqA, 'divulgacion')).toMatchObject({ status: 'resuelta' });
    // Sprint 6 [SGC-REQ-085]: cerrada la divulgación, la lectura ya firmada no vuelve a abrir el PDF por esta vía.
    const cupoL1 = await prisma.sgcTaskAssignee.findFirstOrThrow({ where: { id_task: (await taskOf(reqA, 'divulgacion')).id_task, user_email: E.l1 } });
    await expect(openReadingFile(prisma, cupoL1.id_task_assignee, await viewer(E.l1), actor(E.l1))).rejects.toMatchObject({ status: 409 });
    const cap = await taskOf(reqA, 'capacitacion');
    expect(cap.status).toBe('abierta');
    expect(cap.assignees).toEqual([expect.objectContaining({ user_email: null, pool_type_code: 'SGC-VERIF-CALIDAD', signature_meaning: 'capacito' })]);
    expect(await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).toMatchObject({ current_version_id: idV1 });
  });

  it('[SGC-REQ-058][SGC-REQ-059] Calidad registra la capacitación y carga el Excel de Forms: aprobados, reprobados, sin resultado y fuera del alcance', async () => {
    const training = { mode: 'mixta', title: 'Capacitación del procedimiento S4', videoUrl: 'https://stream.example/v/s4', formsUrl: 'https://forms.office.com/r/s4', sessionDate: '2026-10-05', maxScore: 10, minScorePct: 80 };
    await expect(saveTraining(prisma, await accessOf(E.sol), reqA, training, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(uploadTrainingResults(prisma, upload, await accessOf(E.cal), reqA, { fileName: 'r.xlsx', bytes: await xlsx([HEAD]) }, actor(E.cal))).rejects.toThrow(/Registre primero/);
    await saveTraining(prisma, await accessOf(E.cal), reqA, training, actor(E.cal));
    // Sprint 10: también se acepta el CSV de Google Forms; otro formato se rechaza.
    await expect(uploadTrainingResults(prisma, upload, await accessOf(E.cal), reqA, { fileName: 'r.pdf', bytes: new Uint8Array([1]) }, actor(E.cal))).rejects.toThrow(/\.xlsx/);
    const bytes = await xlsx([
      HEAD,
      [1, 'a', 'b', E.l1, 'L1', 9],
      [2, 'a', 'b', E.l2, 'L2', 5],
      [3, 'a', 'b', E.l2, 'L2', 7],
      [4, 'a', 'b', E.rev, 'REV', 10],
      [5, 'a', 'b', 'otro@x.co', 'Otro', 10],
    ]);
    const up = await uploadTrainingResults(prisma, upload, await accessOf(E.cal), reqA, { fileName: 'Resultados Forms.xlsx', bytes }, actor(E.cal));
    expect(up.summary).toMatchObject({ rows: 5, inScope: 3, passed: 2, failed: 1, outOfScope: 1, missing: [E.l3] });
    expect(uploads.find((u) => u.segments.includes('_capacitacion'))!.segments).toEqual(['SGC', 'S4', '_capacitacion', `SOL-${reqA}`]);
    await expect(saveTraining(prisma, await accessOf(E.cal), reqA, { ...training, minScorePct: 60 }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await saveTraining(prisma, await accessOf(E.cal), reqA, { ...training, instructor: 'Jefe de Calidad' }, actor(E.cal));
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[training_upload] SET passed = 3`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[training_result]`)).rejects.toThrow(/solo inserción/);
    const view = (await getRequestDetail(prisma, reqA, await viewer(E.cal))).training!;
    expect(view).toMatchObject({ open: true, canManage: true, uploadsCount: 1, training: { instructor: 'Jefe de Calidad', minScorePct: 80 }, upload: { sha256: up.sha256, needsJustification: true } });
    // Sprint 10: L2 reprobó en sus 2 intentos (los que cuentan por defecto) → queda en recapacitación.
    expect(Object.fromEntries(view.people.map((p) => [p.email, p.status]))).toEqual({ [E.l1]: 'aprobo', [E.l2]: 'recapacitacion', [E.l3]: 'sin_resultado', [E.rev]: 'aprobo' });
    expect(view.people.find((p) => p.email === E.l2)).toMatchObject({ score: 7, attempts: 2 });
    expect(view.outOfScope.map((o) => o.email)).toEqual(['otro@x.co']);
  });

  it('[SGC-REQ-060][SGC-REQ-061][SGC-REQ-065] «Capacitó» exige justificación con reprobados; al firmarla, la V2 queda VIGENTE y la V1 OBSOLETA en la misma transacción', async () => {
    const cap = await taskOf(reqA, 'capacitacion');
    await expect(signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal))).rejects.toThrow(/justificación/);
    sent.length = 0;
    const res = await signTask(prisma, deps, cap.id_task, firma('capacito', { comment: 'Se reprograma a L2 y L3; cobertura suficiente según Calidad.' }), actor(E.cal));
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'completada', published: { versionNumber: 2, obsolete: { versionNumber: 1 } } });
    const sig = await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: reqA, meaning: 'capacito' } });
    const lastUp = await prisma.sgcTrainingUpload.findFirstOrThrow({ orderBy: { id_training_upload: 'desc' } });
    expect(sig).toMatchObject({ content_kind: 'resultados_capacitacion', content_ref: `training_upload:${lastUp.id_training_upload}`, content_sha256: lastUp.sha256 });
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    expect(r.status).toBe('completada');
    const doc = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } });
    const v1 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: idV1 } });
    const v2 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: r.id_document_version! } });
    const today = colombiaToday(new Date());
    expect(doc).toMatchObject({ status: 'vigente', current_version_id: v2.id_document_version });
    expect(v2).toMatchObject({ status: 'vigente' });
    expect(v2.effective_date!.toISOString().slice(0, 10)).toBe(today.toISOString().slice(0, 10));
    expect(v2.review_due_date!.getUTCFullYear()).toBe(today.getUTCFullYear() + 3);
    expect(doc.next_review_date!.toISOString()).toBe(v2.review_due_date!.toISOString());
    expect(v1).toMatchObject({ status: 'obsoleto', id_superseded_by: v2.id_document_version });
    expect(v1.obsolete_date!.toISOString().slice(0, 10)).toBe(today.toISOString().slice(0, 10));
    expect(await prisma.sgcAuditLog.count({ where: { action: 'documento.vigente', entity_id: String(v2.id_document_version) } })).toBe(1);
    expect(await prisma.sgcAuditLog.count({ where: { action: 'documento.version_obsoleta', entity_id: String(idV1) } })).toBe(1);
    const notice = sent.find((n) => n.payload.title.includes('Documento vigente'))!;
    expect(notice.emails).toEqual(expect.arrayContaining([E.elab, E.rev, E.apr, E.l1, E.l2]));
    expect(notice.emails).not.toContain(E.cal);
  });

  it('[SGC-REQ-063] la verificación por QR dice si la versión sigue vigente (V2), es obsoleta (V1) o no existe; exige acceso y queda auditada', async () => {
    const code = (await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).code;
    const v = await viewer(E.l1);
    const subject = await getAccessSubject(prisma, E.l1);
    expect(await verifyVersionByCode(prisma, v.access, subject, { idCompany: CO, code, versionNumber: 2 }, actor(E.l1))).toMatchObject({ verdict: 'vigente', title: 'Control de documentos S4', currentVersionNumber: 2 });
    expect(await verifyVersionByCode(prisma, v.access, subject, { idCompany: String(CO), code: code.toLowerCase(), versionNumber: '1' }, actor(E.l1))).toMatchObject({ verdict: 'obsoleta', currentVersionNumber: 2, obsoleteDate: expect.any(String) });
    expect(await verifyVersionByCode(prisma, v.access, subject, { idCompany: CO, code, versionNumber: 9 }, actor(E.l1))).toMatchObject({ verdict: 'no_encontrada' });
    await expect(verifyVersionByCode(prisma, v.access, subject, { idCompany: 3, code, versionNumber: 2 }, actor(E.l1))).rejects.toMatchObject({ status: 404 });
    await expect(verifyVersionByCode(prisma, v.access, subject, { idCompany: CO, code: '', versionNumber: 2 }, actor(E.l1))).rejects.toMatchObject({ status: 400 });
    expect(await canViewDocument(prisma, v.access, subject, idDoc)).toBe(true);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'documento.verificacion_qr' } })).toBe(4); // 3 de esta prueba + 1 en divulgación (S6)
  });

  it('[SGC-REQ-062] cancelar en la divulgación solo lo hace Calidad: la versión aprobada se ANULA y la vigente no cambia; o Calidad cierra la divulgación con justificación', async () => {
    const reqB = await approvedRequest('Nueva versión cancelada en divulgación S4');
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqB, { entry: { kind: 'persona', email: E.l1 }, reason: 'Lector único' }, actor(E.elab));
    await signThroughApproval(reqB);
    // 2026-10-05: el elaborador ahora es de Calidad; el solicitante (sin Calidad) no cancela en la divulgación.
    await expect(cancelRequest(prisma, notifier, await accessOf(E.sol), reqB, { reason: 'Ya no se necesita' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    const elabDetail = await getRequestDetail(prisma, reqB, await viewer(E.sol));
    expect(elabDetail.permissions).toMatchObject({ canCancel: false, canChangeSigners: false, canEditForm: false });
    await cancelRequest(prisma, notifier, await accessOf(E.cal), reqB, { reason: 'Se detectó un error en el contenido aprobado' }, actor(E.cal));
    const rB = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqB } });
    expect(await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: rB.id_document_version! } })).toMatchObject({ status: 'anulado', version_number: 3 });
    expect(await prisma.sgcReadRecord.findFirstOrThrow({ where: { id_request: reqB } })).toMatchObject({ status: 'excluido', exclude_reason: expect.stringContaining('Solicitud cancelada') });
    const doc = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } });
    expect(doc).toMatchObject({ status: 'vigente' });
    expect((await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: doc.current_version_id! } })).version_number).toBe(2);

    // Otra solicitud: Calidad cierra la divulgación con justificación (sin lectores que firmaran).
    const reqC = await approvedRequest('Nueva versión con cierre de divulgación S4');
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqC, { entry: { kind: 'persona', email: E.l2 }, reason: 'Lector único' }, actor(E.elab));
    await signThroughApproval(reqC);
    await expect(closeDissemination(prisma, notifier, await accessOf(E.sol), reqC, { reason: 'Cierre por el solicitante' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(closeDissemination(prisma, notifier, await accessOf(E.cal), reqC, { reason: 'corto' }, actor(E.cal))).rejects.toThrow(/mínimo 10/);
    const closed = await closeDissemination(prisma, notifier, await accessOf(E.cal), reqC, { reason: 'La persona está de vacaciones; se divulga al regresar (prueba S4).' }, actor(E.cal));
    expect(closed).toMatchObject({ read: 0, excluded: 1, next: 'capacitacion' });
    await expect(closeDissemination(prisma, notifier, await accessOf(E.cal), reqC, { reason: 'Otra vez el cierre de la divulgación' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await cancelRequest(prisma, notifier, await accessOf(E.cal), reqC, { reason: 'Fin de la prueba del cierre de divulgación' }, actor(E.cal));
    expect((await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).status).toBe('vigente');
  });

  it('[SGC-REQ-057][SGC-REQ-085] si los demás ya firmaron, excluir con justificación al último pendiente cierra la divulgación', async () => {
    const reqC = await approvedRequest('Divulgación cerrada por exclusión S6');
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqC, { entry: { kind: 'persona', email: E.l3 }, reason: 'Lector de la prueba S6' }, actor(E.elab));
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), reqC, { entry: { kind: 'persona', email: E.l2 }, reason: 'Lector de la prueba S6' }, actor(E.elab));
    await signThroughApproval(reqC);
    // Uno lee y firma; el otro (el último pendiente) se excluye con justificación.
    const { idTask, idAssignee } = await readToEnd(reqC, E.l2);
    await signTask(prisma, deps, idTask, firma('leyo', { idAssignee }), actor(E.l2));
    const t = await taskOf(reqC, 'divulgacion');
    const rec = await prisma.sgcReadRecord.findFirstOrThrow({ where: { id_task: t.id_task, user_email: E.l3 } });
    await excludeReader(prisma, notifier, await accessOf(E.cal), reqC, rec.id_read_record, { reason: 'Ya no pertenece al área (prueba S6)' }, actor(E.cal));
    expect(await taskOf(reqC, 'divulgacion')).toMatchObject({ status: 'resuelta' });
    expect(await taskOf(reqC, 'capacitacion')).toMatchObject({ status: 'abierta' });
    // Se cierra la solicitud de prueba (Calidad cancela en la capacitación) para no estorbar a las siguientes.
    await cancelRequest(prisma, notifier, await accessOf(E.cal), reqC, { reason: 'Fin de la prueba de exclusión del S6' }, actor(E.cal));
  });

  it('[SGC-REQ-053][SGC-REQ-061] un documento NUEVO sin alcance usa el departamento dueño del proceso y, si se cancela en la divulgación, el documento queda anulado', async () => {
    await prisma.sgcProcessMap.update({ where: { id_process_map: procGC }, data: { id_department: dept } });
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Instructivo nuevo S4', description: 'Documento nuevo sin alcance definido (S4).', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } }, actor(E.sol));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx('nuevo') }, await viewer(E.elab), actor(E.elab));
    await signThroughApproval(idRequest);
    const scope = await prisma.sgcDisseminationScope.findMany({ where: { id_request: idRequest } });
    expect(scope).toEqual([expect.objectContaining({ kind: 'departamento', id_department: dept, change_reason: expect.stringContaining('por defecto') })]);
    expect((await taskOf(idRequest, 'divulgacion')).assignees.map((a) => a.user_email).sort()).toEqual([E.l1, E.l2, E.rev].sort());
    await cancelRequest(prisma, notifier, await accessOf(E.cal), idRequest, { reason: 'Prueba de anulación del documento nuevo' }, actor(E.cal));
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest }, include: { document: true } });
    expect(r.document).toMatchObject({ status: 'anulado', annul_reason: expect.stringContaining('antes de la vigencia') });
  });

  it('[SGC-REQ-055][SGC-REQ-060][SGC-REQ-061][SGC-REQ-064] bordes: contenido firmado que no cuadra, vigencia sin PDF, pasos cerrados y datos inválidos se rechazan', async () => {
    const t = await taskOf(reqA, 'divulgacion');
    const cap = await taskOf(reqA, 'capacitacion');
    const a1 = t.assignees.find((x) => x.user_email === E.l1)!;
    const rA = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    const v2 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: rA.id_document_version! } });
    const inTx = (kind: 'pdf_controlado' | 'resultados_capacitacion' | 'borrador_editor', ref: string, sha: string, idTask = t.id_task) =>
      prisma.$transaction((tx) => signedContentInTx(tx, reqA, idTask, a1.id_task_assignee, { kind, ref, name: 'x', sha256: sha }));
    await expect(inTx('pdf_controlado', 'version:0', v2.pdf_sha256)).rejects.toThrow(/ya no es el PDF controlado/);
    await expect(inTx('pdf_controlado', `version:${v2.id_document_version}`, v2.pdf_sha256.trim())).rejects.toThrow(/no está pendiente/);
    await expect(inTx('resultados_capacitacion', 'training_upload:0', 'a'.repeat(64), cap.id_task)).rejects.toThrow(/cambiaron/);
    await expect(inTx('borrador_editor', 'revision:0', 'a'.repeat(64))).rejects.toThrow(/borrador cambió/);
    await expect(prisma.$transaction((tx) => publishApprovedVersion(tx, { id_request: reqA, id_company: CO, id_document_version: null, controlled_pdf_status: null }, actor(E.cal), new Date()))).rejects.toThrow(/no tiene PDF controlado/);
    await expect(prisma.$transaction((tx) => publishApprovedVersion(tx, rA, actor(E.cal), new Date()))).rejects.toThrow(/ya está vigente/);
    expect(await prisma.$transaction((tx) => annulUnpublishedVersion(tx, { id_request: reqA, id_company: CO, id_document_version: null }, 'x', actor(E.cal), new Date()))).toBeNull();
    expect(await prisma.$transaction((tx) => annulUnpublishedVersion(tx, rA, 'x', actor(E.cal), new Date()))).toBeNull();
    // Pasos cerrados: nada de alcance, recordatorios ni capacitación sobre una solicitud completada.
    const cal = await accessOf(E.cal);
    await expect(addScopeEntry(prisma, notifier, cal, reqA, { entry: { kind: 'empresa' }, reason: 'Después de cerrar' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(sendReadingReminders(prisma, notifier, cal, reqA, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(saveTraining(prisma, cal, reqA, { mode: 'video', title: 'Tarde para capacitar', videoUrl: 'https://v.x/1', formsUrl: 'https://forms.office.com/r/s4tarde', maxScore: 10 }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(uploadTrainingResults(prisma, upload, cal, reqA, { fileName: 'r.xlsx', bytes: await xlsx([HEAD]) }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const otra = { ...cal, idCompany: 999 };
    await expect(addScopeEntry(prisma, notifier, otra, reqA, { entry: { kind: 'empresa' }, reason: 'Otra empresa' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(saveTraining(prisma, otra, reqA, { mode: 'video', title: 'Otra empresa', videoUrl: 'https://v.x/1', formsUrl: 'https://forms.office.com/r/s4tarde', maxScore: 10 }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(sendReadingReminders(prisma, notifier, otra, reqA, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(addScopeEntry(prisma, notifier, cal, 99999999, { entry: { kind: 'empresa' }, reason: 'No existe' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    expect(await recordReadingEvent(prisma, a1.id_task_assignee, { event: 'final' }, { email: E.l1 }, actor(E.l1))).toMatchObject({ status: 'leido' });
    // Solicitud nueva antes de la divulgación: validación del alcance y lectura aún no disponible.
    const reqD = await approvedRequest('Nueva versión para los bordes S4');
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.elab), reqD, { entry: { kind: 'cargo', idCargo: 99999999 }, reason: 'Cargo inexistente' }, actor(E.elab))).rejects.toThrow(/cargo no existe/);
    await expect(addScopeEntry(prisma, notifier, await accessOf(E.elab), reqD, { entry: { kind: 'persona', email: 'nadie@x.co' }, reason: 'Persona inexistente' }, actor(E.elab))).rejects.toThrow(/no existe o está inactiva/);
    await expect(removeScopeEntry(prisma, await accessOf(E.elab), reqD, 99999999, { reason: 'No existe' }, actor(E.elab))).rejects.toMatchObject({ status: 404 });
    await expect(removeScopeEntry(prisma, await accessOf(E.rev), reqD, 1, { reason: 'Sin permiso' }, actor(E.rev))).rejects.toMatchObject({ status: 403 });
    await expect(sendReadingReminders(prisma, notifier, cal, reqD, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await cancelRequest(prisma, notifier, await accessOf(E.elab), reqD, { reason: 'Fin de la prueba de bordes' }, actor(E.elab));
    await expect(removeScopeEntry(prisma, await accessOf(E.elab), reqD, 1, { reason: 'Cerrada' }, actor(E.elab))).rejects.toMatchObject({ status: 409 });
    // Personas por cargo: datos inválidos y registro ajeno.
    await expect(addCargoMember(prisma, CO, { idCargo: cargo, email: 'x', reason: 'Correo malo' }, actor(E.cal))).rejects.toThrow(/correo/);
    await expect(addCargoMember(prisma, CO, { idCargo: cargo, email: E.l1, reason: 'no' }, actor(E.cal))).rejects.toThrow(/motivo/);
    await expect(addCargoMember(prisma, CO, { idCargo: 99999999, email: E.l1, reason: 'Cargo inexistente' }, actor(E.cal))).rejects.toThrow(/no existe/);
    await expect(deactivateCargoMember(prisma, CO, 99999999, { reason: 'No existe' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(deactivateCargoMember(prisma, CO, 1, { reason: 'no' }, actor(E.cal))).rejects.toThrow(/motivo/);
    // Una versión anulada se verifica como ANULADA.
    const code = (await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).code;
    expect(await verifyVersionByCode(prisma, (await viewer(E.cal)).access, await getAccessSubject(prisma, E.cal), { idCompany: CO, code, versionNumber: 3 }, actor(E.cal))).toMatchObject({ verdict: 'anulada' });
  });
});

