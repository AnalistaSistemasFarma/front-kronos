import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { addScopeEntry, openReadingFile, recordReadingEvent } from '../../../lib/sgc/db/dissemination';
import { createInitialDocument, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getCurrentFlowVersion, loadDefinition } from '../../../lib/sgc/db/flows';
import { cancelRequest, closeDissemination, createRedissemination, getRequestDetail, previewRedissemination } from '../../../lib/sgc/db/requests';
import { signTask, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * 2026-10-26 contra un SQL Server REAL (efímero en CI): REDIVULGACIÓN de un
 * documento vigente (flujo REDIV). Se divulga la MISMA versión vigente (sin
 * versión nueva ni firmas nuevas); al cerrarse no publica nada; a quien ya
 * la leyó le vuelve a aparecer la lectura, con la confirmación previa de
 * Calidad y el aviso al grupo de Calidad. Empresa propia (id 126) sembrada
 * con los SQL del pase.
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · redivulgación de un documento vigente con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 126;
  const PW = 'Clave-Rediv-ci#2026';
  const E = {
    cal: 'calidad.rediv@onelatampharma.com',
    // Otra persona del grupo de Calidad: el aviso no le llega a quien lanza la redivulgación (recipients la excluye).
    cal2: 'calidad2.rediv@onelatampharma.com',
    gestor: 'gestor.rediv@onelatampharma.com',
    l1: 'lector1.rediv@onelatampharma.com',
    l2: 'lector2.rediv@onelatampharma.com',
    l3: 'lector3.rediv@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.12.6.6', userAgent: 'vitest-rediv' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) =>
    fs
      .readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8')
      .replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`)
      // La base efímera de CI no se llama KRONOSDB_PRUEBAS: se quita solo la guarda de la base.
      .replace(/IF DB_NAME\(\) <> N'KRONOSDB_PRUEBAS'\s+THROW[^;]*;/, '');
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `rediv-${++n}`;
    store.set(id, new Uint8Array(content));
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 750, size: 11, font });
    return pdf.save();
  };
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (itemId) => store.get(itemId)!,
    htmlToPdf: async () => pdfOf('no se usa'),
    docxToHtml: async () => '',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: { orderBy: { sign_order: 'asc' } } } });
  const readAndSign = async (idRequest: number, email: string) => {
    const t = await taskOf(idRequest, 'divulgacion');
    const a = t.assignees.find((x) => x.user_email === email && x.status === 'pendiente')!;
    await openReadingFile(prisma, a.id_task_assignee, await viewer(email), actor(email));
    await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 1 }, { email }, actor(email));
    await signTask(prisma, deps, t.id_task, { meaning: 'leyo', reason: 'Leí el documento completo', consentAccepted: true, password: PW, idAssignee: a.id_task_assignee }, actor(email));
  };

  let dept = 0;
  let idDoc = 0;
  let idV1 = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA REDIV CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, header_mandatory: false, storage_root: 'SGC/REDIV', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (REDIV CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    dept = (await prisma.department.create({ data: { department: `Producción REDIV CI ${Date.now()}` } })).id_department;
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[], boolean][] = [
      [E.cal, ['calidad'], false],
      [E.cal2, ['calidad'], false],
      [E.gestor, ['gestion'], false],
      [E.l1, ['lectura'], true],
      [E.l2, ['lectura'], true],
      [E.l3, ['lectura'], false],
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
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba de redivulgación' }, actor('ci@x.co'));
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal2, reason: 'Calidad de la prueba de redivulgación' }, actor('ci@x.co'));
    const cat = await getCatalogs(prisma, CO);
    const doc = await createInitialDocument(
      prisma,
      upload,
      { idCompany: CO, idProcess: cat.processes.find((p) => p.code === 'GC')!.id, idDocumentType: cat.documentTypes.find((t) => t.code === 'PR')!.id, title: 'Control de documentos REDIV', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-01-15', pdf: { bytes: await pdfOf('vigente V1'), fileName: 'v1.pdf' } },
      actor(E.cal)
    );
    idDoc = doc.idDocument;
    idV1 = doc.idVersion;
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-053] sin el flujo REDIV no se redivulga; el SQL del pase lo siembra (idempotente) con solicitud → divulgación', async () => {
    const cal = await accessOf(E.cal);
    await expect(createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries: [{ kind: 'departamento', idDepartment: dept }], reason: 'Reinducción del área de producción' }, actor(E.cal))).rejects.toThrow(/falta el flujo REDIV/);
    await prisma.$executeRawUnsafe(seed('2026-10-26-sgc-redivulgacion-flujo-olp-PRUEBAS.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-26-sgc-redivulgacion-flujo-olp-PRUEBAS.sql'));
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'REDIV');
    expect(version.version_number).toBe(1);
    expect(await prisma.sgcFlowVersion.count({ where: { id_flow_process: process.id_flow_process } })).toBe(1);
    const def = await loadDefinition(prisma, version.id_flow_version);
    expect(def.tasks.map((t) => [t.key, t.assignment, t.signatureMeaning])).toEqual([
      ['solicitud', 'solicitante', null],
      ['divulgacion', 'alcance', 'leyo'],
    ]);
    expect(def.transitions.map((t) => `${t.from}:${t.action}->${t.to ?? t.terminalStatus}`).sort()).toEqual(['divulgacion:aprobar->completada', 'divulgacion:cancelar->cancelada', 'solicitud:aprobar->divulgacion', 'solicitud:cancelar->cancelada']);
  });

  it('[SGC-REQ-053] solo Calidad; vista previa sin guardar; se divulga la MISMA versión vigente y al cerrar no publica nada', async () => {
    const cal = await accessOf(E.cal);
    const entries = [{ kind: 'departamento', idDepartment: dept }];
    await expect(previewRedissemination(prisma, await accessOf(E.gestor), { idDocument: idDoc, entries })).rejects.toMatchObject({ status: 403 });
    await expect(createRedissemination(prisma, notifier, await accessOf(E.gestor), { idDocument: idDoc, entries, reason: 'Sin permiso de Calidad' }, actor(E.gestor))).rejects.toMatchObject({ status: 403 });
    await expect(previewRedissemination(prisma, cal, { idDocument: 99999999, entries })).rejects.toMatchObject({ status: 404 });
    await expect(previewRedissemination(prisma, cal, { idDocument: idDoc, entries: [] })).rejects.toThrow(/a quién se redivulga/);
    await expect(previewRedissemination(prisma, cal, { idDocument: idDoc, entries: Array.from({ length: 51 }, (_, i) => ({ kind: 'persona', email: `p${i}@x.co` })) })).rejects.toThrow(/Máximo 50/);
    const before = await prisma.sgcRequest.count({ where: { id_company: CO } });
    const preview = await previewRedissemination(prisma, cal, { idDocument: idDoc, entries: [...entries, ...entries] });
    expect(preview).toMatchObject({ idDocument: idDoc, versionNumber: 1, readers: 2, alreadyRead: 0, openRequest: null });
    expect(await prisma.sgcRequest.count({ where: { id_company: CO } })).toBe(before);
    await expect(createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries, reason: 'corto' }, actor(E.cal))).rejects.toThrow(/motivo/);
    await expect(createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries: [{ kind: 'persona', email: 'nadie@x.co' }], reason: 'Persona sin acceso al SGC' }, actor(E.cal))).rejects.toThrow(/no tiene lectores/);

    sent.length = 0;
    const created = await createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries, reason: 'Documento de la carga inicial sin divulgar' }, actor(E.cal));
    expect(created).toMatchObject({ readers: 2, alreadyRead: 0 });
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: created.idRequest } });
    expect(req).toMatchObject({ request_type: 'redivulgacion', id_document: idDoc, id_document_version: idV1, controlled_pdf_status: 'generado', status: 'abierta', current_task_key: 'divulgacion' });
    expect((await taskOf(created.idRequest, 'divulgacion')).assignees.map((a) => a.user_email).sort()).toEqual([E.l1, E.l2]);
    expect(sent.some((x) => x.emails.includes(E.l1))).toBe(true);
    const detail = await getRequestDetail(prisma, created.idRequest, await viewer(E.cal));
    expect(detail.request.requestTypeLabel).toBe('Redivulgación de un documento vigente');
    // Una sola redivulgación en curso por documento (se amplía la que está abierta).
    expect((await previewRedissemination(prisma, cal, { idDocument: idDoc, entries })).openRequest).toBe(created.idRequest);
    await expect(createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries, reason: 'Otra al mismo tiempo' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    expect(await addScopeEntry(prisma, notifier, cal, created.idRequest, { entry: { kind: 'persona', email: E.l3 }, reason: 'Personal nuevo' }, actor(E.cal))).toMatchObject({ added: 1 });

    await readAndSign(created.idRequest, E.l1);
    await closeDissemination(prisma, notifier, cal, created.idRequest, { reason: 'Cierre de la redivulgación de la prueba' }, actor(E.cal));
    expect(await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: created.idRequest } })).toMatchObject({ status: 'completada' });
    // La versión vigente sigue igual: ni versión nueva ni obsoleta.
    expect(await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: idV1 } })).toMatchObject({ status: 'vigente' });
    expect(await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: idDoc } })).toMatchObject({ status: 'vigente', current_version_id: idV1 });
    expect(await prisma.sgcDocumentVersion.count({ where: { id_document: idDoc } })).toBe(1);
  });

  it('[SGC-REQ-053] a quien ya leyó la versión le vuelve a aparecer: Calidad debe confirmarlo y el grupo de Calidad recibe el aviso; cancelar no toca la vigente', async () => {
    const cal = await accessOf(E.cal);
    const entries = [{ kind: 'departamento', idDepartment: dept }];
    const preview = await previewRedissemination(prisma, cal, { idDocument: idDoc, entries });
    expect(preview).toMatchObject({ readers: 2, alreadyRead: 1, alreadyReadEmails: [E.l1] });
    await expect(createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries, reason: 'Reinducción anual del área' }, actor(E.cal))).rejects.toThrow(/1 persona\(s\) del alcance ya leyeron .* Confírmelo/);
    sent.length = 0;
    const again = await createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries, reason: 'Reinducción anual del área', confirmRepeat: true }, actor(E.cal));
    expect(again).toMatchObject({ readers: 2, alreadyRead: 1 });
    expect((await taskOf(again.idRequest, 'divulgacion')).assignees.find((a) => a.user_email === E.l1)).toMatchObject({ status: 'pendiente' });
    expect(sent.some((x) => x.emails.includes(E.cal2) && /vuelve a aparecer/.test(x.payload.body))).toBe(true);
    expect(sent.some((x) => x.emails.includes(E.cal) && /vuelve a aparecer/.test(x.payload.body))).toBe(false);
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, entity: 'request', entity_id: String(again.idRequest) } });
    expect(JSON.parse(audit.after_json!)).toMatchObject({ requestType: 'redivulgacion', alreadyRead: 1, confirmRepeat: true });
    await cancelRequest(prisma, notifier, cal, again.idRequest, { reason: 'Fin de la prueba de redivulgación' }, actor(E.cal));
    expect(await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: again.idRequest } })).toMatchObject({ status: 'cancelada' });
    expect(await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: idV1 } })).toMatchObject({ status: 'vigente' });
    // La reversa retira el flujo: ya no se puede redivulgar (lo hecho se conserva).
    await prisma.$executeRawUnsafe(seed('2026-10-26-sgc-redivulgacion-flujo-olp-reversa.sql').replace(/IF DB_NAME\(\) NOT IN[^;]*;/, ''));
    await expect(createRedissemination(prisma, notifier, cal, { idDocument: idDoc, entries, reason: 'Después de la reversa', confirmRepeat: true }, actor(E.cal))).rejects.toThrow(/falta el flujo REDIV/);
    expect(await prisma.sgcRequest.count({ where: { id_company: CO, request_type: 'redivulgacion' } })).toBe(2);
  });
});
