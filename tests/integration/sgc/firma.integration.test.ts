import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { auditReportToCsv, getDocumentAuditReport } from '../../../lib/sgc/db/auditReport';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getDraftRevision, getVigenteBaseHtml, importWordToHtml, listDraftRevisions, saveDraftRevision } from '../../../lib/sgc/db/drafts';
import { getCurrentFlowVersion, loadDefinition } from '../../../lib/sgc/db/flows';
import { createRequest, decideTask, getRequestDetail, getTaskDetail, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import {
  generateControlledVersion,
  getMasterImageError,
  listSignatureMasters,
  registerSignatureMaster,
  revokeSignatureMaster,
  signTask,
  verifyCompanySignatureChain,
  verifyDocumentVersion,
  type SgcSignatureDeps,
} from '../../../lib/sgc/db/signatures';
import { normalizeFlowDefinition } from '../../../lib/sgc/flows/definition';
import { SGC_DOCUMENT_FLOW_V2 } from '../../../lib/sgc/flows/documentFlow';
import type { SgcNotifier } from '../../../lib/sgc/notifications';
import { readManifest } from '../../../lib/sgc/pdf/controlledPdf';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';
import { sha256HexOf } from '../../../lib/sgc/signature/record';

/**
 * Sprint 3 contra un SQL Server REAL (efímero en CI): FIRMA ELECTRÓNICA
 * PROPIA del SGC (reautenticación con la contraseña de SynerLink contra el
 * hash bcrypt de dbo.[user], motivo, consentimiento, sello de tiempo, hash del
 * contenido, evidencia en la carpeta propia, cadena de registros inmodificable),
 * lista de chequeo de Calidad en la Aprobación, borrador editado en la app con
 * control de versiones, PDF CONTROLADO con manifiesto verificable, reporte de
 * auditoría y maestro de firmas. Orión no existe en esta prueba: el SGC firma
 * igual (independencia).
 *
 * Usa una empresa PROPIA (id 60) sembrada con los mismos SQL del pase (S1, S2
 * y S3, cambiando solo el id).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 3 · firma electrónica propia, PDF controlado y Calidad con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 60;
  const PW = 'Clave-S3-ci#2026';
  const E = {
    elab: 'elab.s3@onelatampharma.com',
    rev: 'rev.s3@onelatampharma.com',
    rev2: 'rev2.s3@onelatampharma.com',
    apr: 'apr.s3@onelatampharma.com',
    cal: 'calidad.s3@onelatampharma.com',
    lector: 'lector.s3@onelatampharma.com',
    intruso: 'intruso.s3@onelatampharma.com',
    rafaga: 'rafaga.s3@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.3.3.3', userAgent: 'vitest-s3' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const notifier: SgcNotifier = async () => undefined;

  // OneDrive simulado: guarda lo que se sube (evidencias, PDF controlados, borradores).
  const store = new Map<string, Uint8Array>();
  const uploads: { id: string; segments: string[]; fileName: string }[] = [];
  const upload: SgcUploader = async (segments, fileName, content) => {
    const id = `s3-${uploads.length + 1}`;
    store.set(id, new Uint8Array(content));
    uploads.push({ id, segments, fileName });
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text.slice(0, 80), { x: 50, y: 750, size: 11, font });
    return pdf.save();
  };
  let failHtmlToPdf = false;
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (itemId) => {
      const b = store.get(itemId);
      if (!b) throw new Error(`item ${itemId} no existe`);
      return b;
    },
    htmlToPdf: async (html) => {
      if (failHtmlToPdf) {
        failHtmlToPdf = false;
        throw new Error('Chrome no disponible (simulado)');
      }
      return pdfOf(`Contenido HTML ${html.length}`);
    },
    docxToHtml: async () => '<h1>Procedimiento convertido</h1><p>Contenido del Word convertido para la prueba.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: { orderBy: { sign_order: 'asc' } } } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba de integración`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };

  let procGC = 0;
  let typePR = 0;
  let reqA = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S3 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S3', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S3 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.elab, ['gestion']],
      [E.rev, ['gestion']],
      [E.rev2, ['gestion']],
      [E.apr, ['gestion']],
      [E.cal, ['calidad']],
      [E.lector, ['lectura']],
      [E.intruso, ['gestion']],
      [E.rafaga, ['gestion']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s1-maestros-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s2-flujo-documental-olp.sql'));
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba S3' }, actor('ci@x.co'));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-042] las 5 tablas del S3 viven en `sgc` con sus triggers de solo inserción (y el maestro solo se revoca)', async () => {
    const rows = await prisma.$queryRaw<{ tabla: string; esquema: string }[]>`
      SELECT t.name AS tabla, s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name IN ('signature','signature_consent','signature_master','draft_revision','quality_check')`;
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.esquema))).toEqual(new Set(['sgc']));
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name LIKE 'signature%' OR name IN ('draft_revision_solo_insercion','quality_check_solo_insercion') ORDER BY name`;
    expect(trg.map((t) => t.name)).toEqual(['draft_revision_solo_insercion', 'quality_check_solo_insercion', 'signature_consent_solo_insercion', 'signature_master_sin_borrado', 'signature_master_solo_revocacion', 'signature_solo_insercion']);
    const cols = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sys.columns WHERE (object_id = OBJECT_ID('sgc.task_assignee') AND name = 'id_signature') OR (object_id = OBJECT_ID('sgc.flow_form_field') AND name = 'quality_check') OR (object_id = OBJECT_ID('sgc.document_version') AND name = 'manifest_json') OR (object_id = OBJECT_ID('sgc.request') AND name = 'controlled_pdf_status')`;
    expect(Number(cols[0].n)).toBe(4);
  });

  it('[SGC-REQ-044] el flujo DOC v2 con la lista de chequeo de Calidad se siembra con el SQL del pase (idempotente) y coincide con el código', async () => {
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s3-firma-calidad-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s3-firma-calidad-olp.sql'));
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'DOC');
    expect(version).toMatchObject({ version_number: 2, status: 'vigente' });
    expect(await prisma.sgcFlowVersion.findFirst({ where: { id_flow_process: process.id_flow_process, version_number: 1 } })).toMatchObject({ status: 'retirada' });
    const def = await loadDefinition(prisma, version.id_flow_version);
    expect(normalizeFlowDefinition(def)).toEqual(normalizeFlowDefinition(JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V2))));
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: 'version.publicada', id_flow_version: version.id_flow_version } })).toBe(1);
  });

  it('[SGC-REQ-047][SGC-REQ-048] el elaborador edita el borrador en la app: cada guardado es una revisión nueva, limpia y con su SHA-256', async () => {
    const access = await accessOf(E.elab);
    ({ idRequest: reqA } = await createRequest(prisma, notifier, access, { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento de firma electrónica S3', description: 'Documento nuevo para la prueba de la firma propia del SGC.', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } }, actor(E.elab)));
    await setSigners(prisma, notifier, reqA, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab));
    await setSigners(prisma, notifier, reqA, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab));
    const html = '<h1 onclick="x()">Procedimiento S3</h1><script>alert(1)</script><p style="x">Contenido suficiente del borrador editado.</p>';
    await expect(saveDraftRevision(prisma, reqA, { html }, await viewer(E.lector), actor(E.lector))).rejects.toMatchObject({ status: 404 });
    await expect(saveDraftRevision(prisma, reqA, { html }, await viewer(E.rev), actor(E.rev))).rejects.toMatchObject({ status: 403 });
    await expect(saveDraftRevision(prisma, reqA, { html: '<p>x</p>' }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/vacío/);
    const r1 = await saveDraftRevision(prisma, reqA, { html, note: 'Primera versión', origin: 'blanco' }, await viewer(E.elab), actor(E.elab));
    expect(r1).toMatchObject({ number: 1, unchanged: false });
    expect(await saveDraftRevision(prisma, reqA, { html }, await viewer(E.elab), actor(E.elab))).toMatchObject({ number: 1, unchanged: true });
    const stored = await getDraftRevision(prisma, reqA, 'ultima', await viewer(E.rev));
    expect(stored.html).toBe('<h1>Procedimiento S3</h1><p>Contenido suficiente del borrador editado.</p>');
    expect(stored.sha256).toBe(sha256HexOf(stored.html));
    await expect(getDraftRevision(prisma, reqA, 999999, await viewer(E.elab))).rejects.toMatchObject({ status: 404 });
    const word = await importWordToHtml(prisma, deps, reqA, { fileName: 'Base.docx', bytes: docx('base').bytes }, await viewer(E.elab), actor(E.elab));
    expect(word.html).toContain('Procedimiento convertido');
    await expect(importWordToHtml(prisma, deps, reqA, { fileName: 'Base.pdf', bytes: new Uint8Array([1]) }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/\.docx/);
    await expect(importWordToHtml(prisma, deps, reqA, { fileName: 'Base.docx', bytes: new Uint8Array() }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/vacío/);
    await expect(getVigenteBaseHtml(prisma, deps, reqA, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 409 });
    const r2 = await saveDraftRevision(prisma, reqA, { html: word.html, origin: 'word', originRef: 'Base.docx' }, await viewer(E.elab), actor(E.elab));
    expect(r2).toMatchObject({ number: 2 });
    const list = await listDraftRevisions(prisma, reqA, await viewer(E.elab));
    expect(list).toMatchObject({ canEdit: true, document: null, vigente: null });
    expect(list.revisions.map((r) => [r.number, r.origin])).toEqual([[2, 'word'], [1, 'blanco']]);
    expect((await listDraftRevisions(prisma, reqA, await viewer(E.rev))).canEdit).toBe(false);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[draft_revision] SET note = N'x'`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[draft_revision]`)).rejects.toThrow(/solo inserción/);
    const detail = await getRequestDetail(prisma, reqA, await viewer(E.elab));
    expect(detail.currentDraft).toMatchObject({ kind: 'borrador_editor', ref: `revision:${r2.id}`, format: 'html' });
    expect(detail.draftRevisions).toHaveLength(2);
  });

  it('[SGC-REQ-038][SGC-REQ-039][SGC-REQ-043] sin reautenticación correcta, motivo y consentimiento NO se firma; 5 fallos bloquean', async () => {
    const elab = await taskOf(reqA, 'elaboracion');
    await expect(decideTask(prisma, notifier, elab.id_task, { decision: 'aprobar' }, actor(E.elab))).rejects.toThrow(/firma electrónica/);
    await expect(signTask(prisma, deps, elab.id_task, firma('elaboro', { password: 'errada' }), actor(E.elab))).rejects.toMatchObject({ status: 403 });
    await expect(signTask(prisma, deps, elab.id_task, firma('elaboro', { reason: 'no' }), actor(E.elab))).rejects.toThrow(/motivo/);
    await expect(signTask(prisma, deps, elab.id_task, firma('elaboro', { consentAccepted: false }), actor(E.elab))).rejects.toThrow(/aceptar/);
    await expect(signTask(prisma, deps, elab.id_task, firma('aprobo'), actor(E.elab))).rejects.toThrow(/Elaboró/);
    await expect(signTask(prisma, deps, elab.id_task, firma('elaboro', { password: '' }), actor(E.elab))).rejects.toMatchObject({ status: 401 });
    await expect(signTask(prisma, deps, elab.id_task, firma('elaboro', { draftSha256: 'f'.repeat(64) }), actor(E.elab))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.sgcSignature.count({ where: { id_request: reqA } })).toBe(0);
    const fail = await prisma.sgcAuditLog.findFirstOrThrow({ where: { action: 'firma.reautenticacion_fallida', actor_email: E.elab }, orderBy: { id_audit_log: 'desc' } });
    expect(fail).toMatchObject({ entity: 'task', entity_id: String(elab.id_task), ip: '10.3.3.3' });
    expect(JSON.stringify({ ...fail, id_audit_log: String(fail.id_audit_log) })).not.toContain('errada');
    // Bloqueo: otra persona agota los intentos (la contraseña correcta tampoco pasa después).
    for (let i = 0; i < 5; i++) await expect(signTask(prisma, deps, elab.id_task, firma('elaboro', { password: `mala-${i}` }), actor(E.intruso))).rejects.toMatchObject({ status: 403 });
    await expect(signTask(prisma, deps, elab.id_task, firma('elaboro'), actor(E.intruso))).rejects.toMatchObject({ status: 429 });
    expect((await taskOf(reqA, 'elaboracion')).status).toBe('abierta');
  });

  it('[SGC-REQ-088] una ráfaga EN PARALELO de contraseñas erradas no se salta el bloqueo: 5 fallos y el resto bloqueado', async () => {
    const elab = await taskOf(reqA, 'elaboracion');
    const results = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => signTask(prisma, deps, elab.id_task, firma('elaboro', { password: `rafaga-${i}` }), actor(E.rafaga))));
    const statuses = results.map((r) => (r.status === 'rejected' ? (r.reason as { status?: number }).status : 200)).sort();
    expect(statuses.filter((x) => x === 403)).toHaveLength(5);
    expect(statuses.filter((x) => x === 429)).toHaveLength(4);
    expect(await prisma.sgcAuditLog.count({ where: { action: 'firma.reautenticacion_fallida', actor_email: E.rafaga } })).toBe(5);
  });

  it('[SGC-REQ-038][SGC-REQ-040][SGC-REQ-041][SGC-REQ-049] el elaborador firma «Elaboró»: sello de tiempo del servidor, hash del contenido, evidencia propia y SIN Orión', async () => {
    const prevOrion = process.env.ORION_API_BASE_URL;
    process.env.ORION_API_BASE_URL = 'http://127.0.0.1:9/orion-apagado';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const elab = await taskOf(reqA, 'elaboracion');
    const before = new Date();
    const detail = await getTaskDetail(prisma, elab.id_task, await viewer(E.elab));
    const res = await signTask(prisma, deps, elab.id_task, firma('elaboro', { comment: 'Listo para revisión', draftRef: detail.currentDraft!.ref, draftSha256: detail.currentDraft!.sha256 }), actor(E.elab));
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'revision', controlledPdf: { status: null } });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    process.env.ORION_API_BASE_URL = prevOrion;

    const sig = await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: reqA } });
    expect(sig).toMatchObject({ signer_email: E.elab, meaning: 'elaboro', reason: 'Firma elaboro de la prueba de integración', content_kind: 'borrador_editor', content_sha256: detail.currentDraft!.sha256, auth_method: 'contrasena_synerlink', consent_version: 'sgc-co-ley527-d2364-v1', ip: '10.3.3.3', prev_record_hash: null });
    expect(sig.signed_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    const ev = uploads.find((u) => u.id === sig.evidence_item_id)!;
    expect(ev.segments).toEqual(['SGC', 'S3', '_firmas', `SOL-${reqA}`]);
    const evidence = new TextDecoder().decode(store.get(ev.id));
    expect(sha256HexOf(store.get(ev.id)!)).toBe(sig.evidence_sha256);
    expect(evidence).toContain(sig.signature_uid);
    expect(evidence).not.toContain(PW);
    expect((await taskOf(reqA, 'elaboracion')).assignees[0]).toMatchObject({ signature_status: 'firmada', id_signature: sig.id_signature });
    expect(await prisma.sgcSignatureConsent.count({ where: { id_company: CO, user_email: E.elab } })).toBe(1);
    expect(await prisma.sgcAuditLog.count({ where: { action: 'firma.registrada', entity_id: String(sig.id_signature) } })).toBe(1);
    const hist = await prisma.sgcInteraction.findFirstOrThrow({ where: { id_request: reqA, kind: 'decision' }, orderBy: { id_interaction: 'desc' } });
    expect(hist.body).toContain('Firma electrónica: Elaboró (firmado electrónicamente)');
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[signature] SET reason = N'otro motivo'`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[signature]`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[signature_consent]`)).rejects.toThrow(/solo inserción/);
    // Ya no se puede cambiar el borrador: la elaboración cerró.
    await expect(saveDraftRevision(prisma, reqA, { html: '<p>Cambio tardío del contenido firmado.</p>' }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 409 });
  });

  it('[SGC-REQ-040][SGC-REQ-042] el revisor firma «Revisó» sobre el MISMO contenido; la cadena de firmas queda enlazada', async () => {
    const rev = await taskOf(reqA, 'revision');
    await signTask(prisma, deps, rev.id_task, firma('reviso'), actor(E.rev));
    const sigs = await prisma.sgcSignature.findMany({ where: { id_request: reqA }, orderBy: { id_signature: 'asc' } });
    expect(sigs.map((s) => s.meaning)).toEqual(['elaboro', 'reviso']);
    expect(sigs[1].content_sha256).toBe(sigs[0].content_sha256);
    expect(sigs[1].prev_record_hash).toBe(sigs[0].record_hash);
    expect(await verifyCompanySignatureChain(prisma, CO)).toMatchObject({ ok: true, checked: 2 });
  });

  it('[SGC-REQ-044][SGC-REQ-045] aprobación: aprueba el área y Calidad verifica la estructura con la lista de chequeo; al cerrar se genera el PDF controlado', async () => {
    const apr = await taskOf(reqA, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    const calDetail = await getTaskDetail(prisma, apr.id_task, await viewer(E.cal));
    expect(calDetail.tasks.find((t) => t.id === apr.id_task)!.myAction).toMatchObject({ signatureMeaning: 'aprobo', checklist: [expect.objectContaining({ key: 'chk_codificacion', required: true }), expect.anything(), expect.objectContaining({ key: 'chk_anexos', required: false })] });
    expect(calDetail.formFields.map((f) => f.key)).not.toContain('chk_codificacion');
    const sigsBefore = await prisma.sgcSignature.count({ where: { id_request: reqA } });
    await expect(signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.cal))).rejects.toThrow(/responda/);
    await expect(signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: { ...checklistOk, chk_formato: { answer: 'no_cumple', observation: 'Falta el encabezado' } } }), actor(E.cal))).rejects.toThrow(/NO CUMPLEN/);
    expect(await prisma.sgcSignature.count({ where: { id_request: reqA } })).toBe(sigsBefore);
    expect(await prisma.sgcQualityCheck.count({ where: { id_request: reqA } })).toBe(0);

    const res = await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'divulgacion', controlledPdf: { status: 'generado', idDocumentVersion: expect.any(Number) } });
    const chk = await prisma.sgcQualityCheck.findFirstOrThrow({ where: { id_request: reqA } });
    expect(chk).toMatchObject({ result: 'conforme', checked_by: E.cal });
    expect(chk.id_signature).toBe((await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: reqA, signer_email: E.cal } })).id_signature);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[quality_check] SET result = N'conforme'`)).rejects.toThrow(/solo inserción/);

    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    expect(r).toMatchObject({ status: 'en_espera', current_task_key: 'divulgacion', controlled_pdf_status: 'generado' });
    const version = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: r.id_document_version! }, include: { document: true } });
    expect(version.document).toMatchObject({ id_company: CO, status: 'borrador', title: 'Procedimiento de firma electrónica S3', confidentiality: expect.stringMatching(/departamento|confidencial/) });
    expect(version.document.code).toMatch(/-GC-PR-\d{3}$/);
    expect(version).toMatchObject({ version_number: 1, status: 'borrador', id_request: reqA, source_file_name: `${version.document.code} V1.html` });
    expect(r.id_document).toBe(version.id_document);
    const pdfBytes = store.get(version.pdf_item_id)!;
    expect(sha256HexOf(pdfBytes)).toBe(version.pdf_sha256);
    expect(uploads.find((u) => u.id === version.pdf_item_id)!.segments).toEqual(['SGC', 'S3', 'PR', version.document.code, 'v1']);
    const manifest = (await readManifest(pdfBytes))!;
    expect(manifest.signatures.map((s) => s.meaning)).toEqual(['elaboro', 'reviso', 'aprobo', 'aprobo']);
    expect(manifest).toMatchObject({ code: version.document.code, versionNumber: 1, idRequest: reqA, signedContent: { sha256: version.signed_content_sha256 } });
    expect(JSON.parse(version.manifest_json!)).toEqual(manifest);
    expect(await generateControlledVersion(prisma, deps, reqA, actor(E.cal))).toMatchObject({ idDocumentVersion: version.id_document_version, created: false });
    const detail = await getRequestDetail(prisma, reqA, await viewer(E.cal));
    expect(detail.signatures).toHaveLength(4);
    expect(detail.qualityChecks[0]).toMatchObject({ result: 'conforme' });
    expect(detail.controlledPdf).toMatchObject({ status: 'generado', idDocument: version.id_document });
    expect(detail.signatures[0].evidencePath).toContain('_firmas');
    expect((await getRequestDetail(prisma, reqA, await viewer(E.rev))).signatures[0].evidencePath).toBeNull();
  });

  it('[SGC-REQ-046] el PDF controlado verifica; alterar un byte del archivo invalida la verificación', async () => {
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: r.id_document_version! } });
    const who = await viewer(E.cal);
    const subject = await getAccessSubject(prisma, E.cal);
    const ok = await verifyDocumentVersion(prisma, deps, who.access, subject, v.id_document, v.id_document_version, actor(E.cal));
    expect(ok).toMatchObject({ ok: true, pdfMatches: true, manifestMatches: true, hasManifest: true });
    expect(ok.signatures.every((s) => s.ok)).toBe(true);
    const original = store.get(v.pdf_item_id)!;
    const tampered = new Uint8Array(original);
    tampered[200] ^= 0x01;
    store.set(v.pdf_item_id, tampered);
    const bad = await verifyDocumentVersion(prisma, deps, who.access, subject, v.id_document, v.id_document_version, actor(E.cal));
    expect(bad).toMatchObject({ ok: false, pdfMatches: false });
    store.set(v.pdf_item_id, original);
    expect(await prisma.sgcAuditLog.count({ where: { action: 'documento.pdf_verificado', entity_id: String(v.id_document_version) } })).toBe(2);
    // Quien no es de Calidad no ve una versión que aún no es vigente.
    const rv = await viewer(E.rev);
    await expect(verifyDocumentVersion(prisma, deps, rv.access, await getAccessSubject(prisma, E.rev), v.id_document, v.id_document_version, actor(E.rev))).rejects.toMatchObject({ status: 404 });
  });

  it('[SGC-REQ-051] reporte de auditoría del documento: eventos, firmas íntegras y cadena; solo Calidad', async () => {
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: reqA } });
    const report = await getDocumentAuditReport(prisma, (await viewer(E.cal)).access, r.id_document!, actor(E.cal));
    const actions = new Set(report.events.map((e) => e.action));
    for (const a of ['solicitud.creada', 'solicitud.borrador_guardado', 'firma.registrada', 'calidad.chequeo', 'documento.pdf_controlado', 'tarea.decision']) expect(actions.has(a)).toBe(true);
    expect(report.signatures).toHaveLength(4);
    expect(report.signatures.every((s) => s.intact)).toBe(true);
    expect(report.signatureChain.ok).toBe(true);
    expect(report.requests.map((x) => x.id)).toEqual([reqA]);
    const csv = auditReportToCsv(report);
    expect(csv.split('\r\n')[0]).toContain('"fecha_utc";"quien";"accion"');
    expect(csv).toContain('firma.registrada');
    await expect(getDocumentAuditReport(prisma, (await viewer(E.rev)).access, r.id_document!, actor(E.rev))).rejects.toMatchObject({ status: 403 });
    await expect(getDocumentAuditReport(prisma, (await viewer(E.cal)).access, 999999, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(getDocumentAuditReport(prisma, [], r.id_document!, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    expect(await prisma.sgcAuditLog.count({ where: { action: 'documento.reporte_auditoria', entity_id: String(r.id_document) } })).toBe(1);
  });

  it('[SGC-REQ-050] maestro de firmas: Calidad registra el trazo de la inducción (versionado); no se borra, se revoca', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const who = actor(E.cal);
    expect(getMasterImageError(5)).toMatch(/Dibuje/);
    expect(getMasterImageError('data:image/jpeg;base64,AA==')).toMatch(/PNG/);
    expect(getMasterImageError(`data:image/png;base64,${Buffer.from('no es png').toString('base64')}`)).toMatch(/PNG/);
    expect(getMasterImageError(`data:image/png;base64,${Buffer.alloc(310 * 1024).toString('base64')}`)).toMatch(/300 KB/);
    await expect(registerSignatureMaster(prisma, CO, { email: 'x', imagePng: png, reason: 'Inducción' }, who)).rejects.toThrow(/correo/);
    await expect(registerSignatureMaster(prisma, CO, { email: E.apr, imagePng: 'x', reason: 'Inducción' }, who)).rejects.toThrow(/PNG/);
    await expect(registerSignatureMaster(prisma, CO, { email: E.apr, imagePng: png, reason: 'x' }, who)).rejects.toThrow(/motivo/);
    await expect(registerSignatureMaster(prisma, CO, { email: 'nadie@x.co', imagePng: png, reason: 'Inducción' }, who)).rejects.toThrow(/permisos del SGC/);
    const m1 = await registerSignatureMaster(prisma, CO, { email: E.apr, imagePng: png, reason: 'Inducción 2026-10-01' }, who);
    const m2 = await registerSignatureMaster(prisma, CO, { email: E.apr, imagePng: png, reason: 'Nueva firma por cambio de trazo' }, who);
    expect(m2.versionNumber).toBe(m1.versionNumber + 1);
    const list = await listSignatureMasters(prisma, CO);
    expect(list.filter((x) => x.email === E.apr).map((x) => [x.versionNumber, Boolean(x.revokedAt), Boolean(x.imagePng)])).toEqual([[2, false, true], [1, true, false]]);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[signature_master]`)).rejects.toThrow(/no se borra/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[signature_master] SET image_png = N'x' WHERE id_signature_master = ${m2.id}`)).rejects.toThrow(/solo admite revocar/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[signature_master] SET revoke_reason = N'x' WHERE id_signature_master = ${m1.id}`)).rejects.toThrow(/solo admite revocar/);
    await expect(revokeSignatureMaster(prisma, CO, m2.id, { reason: 'x' }, who)).rejects.toThrow(/motivo/);
    await expect(revokeSignatureMaster(prisma, 3, m2.id, { reason: 'Otra empresa' }, who)).rejects.toMatchObject({ status: 404 });
    await expect(revokeSignatureMaster(prisma, CO, m1.id, { reason: 'Ya revocada' }, who)).rejects.toMatchObject({ status: 409 });
    const m3 = await registerSignatureMaster(prisma, CO, { email: E.rev2, imagePng: png, reason: 'Inducción de revisor 2' }, who);
    await revokeSignatureMaster(prisma, CO, m3.id, { reason: 'Se retira de la empresa' }, who);
    expect((await listSignatureMasters(prisma, CO)).find((x) => x.id === m3.id)).toMatchObject({ revokeReason: 'Se retira de la empresa', imagePng: null });
  });

  it('[SGC-REQ-044][SGC-REQ-045][SGC-REQ-047] nueva versión desde un Word: Calidad devuelve con la lista de chequeo (no conforme), se corrige y el PDF sale como V2 del documento', async () => {
    const source = docx('word vigente');
    const doc = await createInitialDocument(
      prisma,
      upload,
      { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title: 'Control de registros S3', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-01-15', pdf: { bytes: await pdfOf('vigente V1'), fileName: 'v1.pdf' }, source },
      actor(E.cal)
    );
    const access = await accessOf(E.elab);
    const { idRequest } = await createRequest(prisma, notifier, access, { idCompany: CO, requestType: 'nueva_version', subject: 'Actualizar control de registros S3', description: 'Cambio de formato por auditoría interna (S3).', idDocument: doc.idDocument, formValues: { urgencia: 'Alta' } }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev, E.rev2], mode: 'paralelo' }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr] }, actor(E.elab));
    const base = await getVigenteBaseHtml(prisma, deps, idRequest, await viewer(E.elab), actor(E.elab));
    expect(base).toMatchObject({ originRef: `${doc.code} V1`, html: expect.stringContaining('convertido') });
    expect((await listDraftRevisions(prisma, idRequest, await viewer(E.elab))).vigente).toEqual({ versionNumber: 1, hasWord: true });
    const att = await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx('borrador V2') }, await viewer(E.elab), actor(E.elab));
    // Si el archivo del borrador se altera en OneDrive, no se firma.
    const item = (await prisma.sgcAttachment.findUniqueOrThrow({ where: { id_attachment: att.id } })).item_id;
    const good = store.get(item)!;
    store.set(item, new Uint8Array([...good, 1]));
    await expect(signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab))).rejects.toThrow(/huella/);
    store.set(item, good);

    const round = async () => {
      await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
      const rev = await taskOf(idRequest, 'revision');
      await signTask(prisma, deps, rev.id_task, firma('reviso'), actor(E.rev2));
      await signTask(prisma, deps, rev.id_task, firma('reviso'), actor(E.rev));
      await signTask(prisma, deps, (await taskOf(idRequest, 'aprobacion')).id_task, firma('aprobo'), actor(E.apr));
    };
    await round();
    const apr = await taskOf(idRequest, 'aprobacion');
    const back = await decideTask(prisma, notifier, apr.id_task, { decision: 'devolver', comment: 'El encabezado no sigue la plantilla institucional.', checklist: { ...checklistOk, chk_formato: { answer: 'no_cumple', observation: 'Encabezado fuera de la plantilla' } } }, actor(E.cal));
    expect(back).toMatchObject({ next: 'elaboracion' });
    expect(await prisma.sgcQualityCheck.findFirstOrThrow({ where: { id_request: idRequest } })).toMatchObject({ result: 'no_conforme', id_signature: null });
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx('borrador V2 corregido') }, await viewer(E.elab), actor(E.elab));
    await round();
    failHtmlToPdf = true;
    const res = await signTask(prisma, deps, (await taskOf(idRequest, 'aprobacion')).id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res.controlledPdf).toMatchObject({ status: 'error', error: expect.stringContaining('Chrome') });
    expect(await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } })).toMatchObject({ controlled_pdf_status: 'error', controlled_pdf_error: expect.stringContaining('Chrome') });
    const retry = await generateControlledVersion(prisma, deps, idRequest, actor(E.cal));
    expect(retry).toMatchObject({ idDocument: doc.idDocument, created: true });
    const v2 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: retry.idDocumentVersion } });
    expect(v2).toMatchObject({ version_number: 2, status: 'borrador', source_file_name: `${doc.code} V2.docx` });
    expect((await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc.idDocument } })).current_version_id).not.toBe(v2.id_document_version);
    const manifest = (await readManifest(store.get(v2.pdf_item_id)!))!;
    // Solo las firmas de la RONDA final (la primera quedó sobre el borrador anterior).
    expect(manifest.signatures.map((s) => s.meaning)).toEqual(['elaboro', 'reviso', 'reviso', 'aprobo', 'aprobo']);
    const aprSig = await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: idRequest, signer_email: E.apr }, orderBy: { id_signature: 'desc' } });
    expect(aprSig.id_signature_master).not.toBeNull();
    expect(await verifyCompanySignatureChain(prisma, CO)).toMatchObject({ ok: true });
    // La versión cargada en el S1 (sin manifiesto) solo verifica su huella.
    const v1 = await verifyDocumentVersion(prisma, deps, (await viewer(E.cal)).access, await getAccessSubject(prisma, E.cal), doc.idDocument, doc.idVersion, actor(E.cal));
    expect(v1).toMatchObject({ ok: true, hasManifest: false, pdfMatches: true });
  });

  it('[SGC-REQ-045] un borrador PDF pasa tal cual al PDF controlado; sin firmas de aprobación no se genera', async () => {
    const access = await accessOf(E.elab);
    const { idRequest } = await createRequest(prisma, notifier, access, { idCompany: CO, requestType: 'nuevo', subject: 'Instructivo en PDF S3', description: 'Documento nuevo cargado como PDF para la prueba S3.', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev] }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr] }, actor(E.elab));
    await expect(generateControlledVersion(prisma, deps, idRequest, actor(E.cal))).rejects.toThrow(/firmas de aprobación/);
    expect(await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } })).toMatchObject({ controlled_pdf_status: 'error' });
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', fileName: 'Instructivo.pdf', contentType: 'application/pdf', bytes: await pdfOf('Instructivo PDF') }, await viewer(E.elab), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(idRequest, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    const res = await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res.controlledPdf).toMatchObject({ status: 'generado' });
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: res.controlledPdf.idDocumentVersion! } });
    expect(v.source_item_id).toBeNull();
    expect((await PDFDocument.load(store.get(v.pdf_item_id)!)).getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it('[SGC-REQ-093] la base no admite dos firmas de la empresa colgando del mismo registro anterior (ni dos génesis)', async () => {
    const cols = 'id_company, id_request, id_task, id_task_assignee, signer_email, signer_name, meaning, reason, signed_at, content_kind, content_ref, content_name, content_sha256, auth_method, consent_version, id_signature_master, master_sha256, ip, user_agent, evidence_item_id, evidence_path, evidence_sha256';
    const copy = (where: string) =>
      prisma.$executeRawUnsafe(`INSERT INTO sgc.signature (signature_uid, ${cols}, prev_record_hash, record_hash, created_at)
        SELECT TOP 1 LOWER(CONVERT(CHAR(36), NEWID())), ${cols}, prev_record_hash, LOWER(CONVERT(CHAR(64), HASHBYTES('SHA2_256', CAST(NEWID() AS NVARCHAR(36))), 2)), created_at
        FROM sgc.signature WHERE id_company = ${CO} AND ${where} ORDER BY id_signature DESC`);
    await expect(copy('prev_record_hash IS NOT NULL')).rejects.toThrow(/signature_cadena_prev_uq|duplicate/i);
    await expect(copy('prev_record_hash IS NULL')).rejects.toThrow(/signature_cadena_genesis_uq|duplicate/i);
    expect((await verifyCompanySignatureChain(prisma, CO)).ok).toBe(true);
  });
});
