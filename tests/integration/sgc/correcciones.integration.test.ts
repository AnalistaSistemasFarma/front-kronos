import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { addCargoMember } from '../../../lib/sgc/db/cargoMembers';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { getCompanySettings, saveCompanySettings } from '../../../lib/sgc/db/companySettings';
import { addScopeEntry, getDisseminationView, openReadingFile, recordReadingDoubt, recordReadingEvent } from '../../../lib/sgc/db/dissemination';
import { createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getCurrentDraftHtml, listDraftRevisions, minorRevisionChain, saveDraftRevision } from '../../../lib/sgc/db/drafts';
import { buildLayoutPreview, changeHistoryRows, getDocumentLayout, latestLayout, layoutParticipants, saveDocumentLayout } from '../../../lib/sgc/db/layout';
import { cancelRequest, createRequest, excludeReader, getRequestDetail, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import { TINY_PNG_B64 } from '../../../lib/sgc/__tests__/fixtures/images';
import { signTask, verifyDocumentVersion, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import { readManifest } from '../../../lib/sgc/pdf/controlledPdf';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';
import { sha256HexOf } from '../../../lib/sgc/signature/record';

/**
 * Correcciones de Calidad OLP (reunión 2026-10-02) contra un SQL Server REAL
 * (efímero en CI): ubicación de firmas en el documento (solo inserción),
 * vista previa con encabezado institucional, PDF controlado con las firmas
 * estampadas y la fecha de emisión, revisión menor de Calidad, divulgación
 * solo a la empresa del documento, aviso de lectura por umbral, «No entendí»
 * y configuración general de la empresa. Empresa propia (id 71) sembrada con
 * los mismos SQL del pase (S1–S4 y el de las correcciones).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · correcciones de Calidad con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 71;
  const PW = 'Clave-Cal-ci#2026';
  const E = {
    elab: 'elab.cal@onelatampharma.com',
    rev: 'rev.cal@onelatampharma.com',
    apr: 'apr.cal@onelatampharma.com',
    cal: 'calidad.cal@onelatampharma.com',
    l1: 'lector1.cal@onelatampharma.com',
    gss: 'apoyo.cal@gsslatam.com',
    gss2: 'manual.cal@gsslatam.com',
  };
  const actor = (email: string) => ({ email, ip: '10.7.7.7', userAgent: 'vitest-correcciones' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const store = new Map<string, Uint8Array>();
  let uploads = 0;
  const upload: SgcUploader = async (_segments, _fileName, content) => {
    const id = `cal-${++uploads}`;
    store.set(id, new Uint8Array(content));
    return { id };
  };
  const pdfOf = async (text: string, pages = 1) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) pdf.addPage([595.28, 841.89]).drawText(`${text} · página ${i + 1}`, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const htmls: string[] = [];
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (itemId) => {
      const b = store.get(itemId);
      if (!b) throw new Error(`item ${itemId} no existe`);
      return b;
    },
    htmlToPdf: async (html) => {
      htmls.push(html);
      return pdfOf('Contenido convertido', 2);
    },
    docxToHtml: async () => '<h1>Procedimiento de correcciones</h1><p>Código {{CODIGO}} versión {{VERSION}}.</p><p>{{HISTORIAL_CAMBIOS}}</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const pdfFile = async (text: string) => ({ fileName: 'Procedimiento.pdf', contentType: 'application/pdf', bytes: await pdfOf(text) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: { orderBy: { sign_order: 'asc' } } } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba de correcciones`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };

  let procGC = 0;
  let typePR = 0;
  let idDoc = 0;

  async function newRequest(subject: string, file: { fileName: string; contentType: string; bytes: Uint8Array } = docx(subject)) {
    // Documento NUEVO en cada solicitud (un documento vigente solo admite una solicitud en curso).
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.elab), { idCompany: CO, requestType: 'nuevo', subject, description: `Cambio de prueba: ${subject}.`, idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...file }, await viewer(E.elab), actor(E.elab));
    return idRequest;
  }
  async function signUntilQuality(idRequest: number) {
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(idRequest, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    return apr.id_task;
  }
  async function approve(idRequest: number) {
    const aprTask = await signUntilQuality(idRequest);
    return signTask(prisma, deps, aprTask, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA CORRECCIONES CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S7', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (correcciones CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.elab, ['gestion']],
      [E.rev, ['gestion']],
      [E.apr, ['gestion']],
      [E.cal, ['calidad']],
      [E.l1, ['lectura']],
      [E.gss, ['lectura']],
      [E.gss2, ['lectura']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba de correcciones' }, actor('ci@x.co'));
    const doc = await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title: 'Control de documentos (correcciones)', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-01-15', pdf: { bytes: await pdfOf('vigente V1'), fileName: 'v1.pdf' } }, actor(E.cal));
    idDoc = doc.idDocument;
    // Cargo de la elaboradora (Personas por cargo de Calidad): sale junto a su nombre en el encabezado.
    const cargo = (await prisma.cargo.create({ data: { nombre_normalizado: `JEFE DE CALIDAD CORRECCIONES CI ${Date.now()}` } })).id_cargo;
    await addCargoMember(prisma, CO, { idCargo: cargo, email: E.elab, reason: 'Cargo de la prueba de correcciones' }, actor(E.cal));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-094][SGC-REQ-098] la migración agrega en `sgc` las tablas y columnas de las correcciones con sus triggers de solo inserción; el SQL de datos deja dominios y logo (idempotente) y el tipo «Plantilla» es un dato', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('document_layout','read_threshold_notice')`;
    expect(tables.map((t) => t.name).sort()).toEqual(['document_layout', 'read_threshold_notice']);
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT CONCAT(OBJECT_NAME(object_id), '.', name) AS c FROM sys.columns WHERE object_id IN (OBJECT_ID('sgc.company_config'), OBJECT_ID('sgc.document_version'), OBJECT_ID('sgc.draft_revision')) AND name IN ('logo_data_url','dissemination_domains','read_threshold_pct','layout_json','minor_reason','base_sha256')`;
    expect(cols).toHaveLength(6);
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('document_layout_solo_insercion','read_threshold_notice_solo_insercion')`;
    expect(trg).toHaveLength(2);
    // La migración es idempotente (se puede volver a correr) y el SQL de datos solo llena lo vacío.
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261003120000_sgc_correcciones_calidad/migration.sql'), 'utf8'));
    await prisma.$executeRawUnsafe(seed('2026-10-03-sgc-correcciones-calidad-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-03-sgc-correcciones-calidad-olp.sql'));
    const s = await getCompanySettings(prisma, CO);
    expect(s).toMatchObject({ hasLogo: true, disseminationDomains: ['onelatampharma.com'], readThresholdPct: 90 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'configuracion.empresa' } })).toBe(2);
    await prisma.$executeRawUnsafe(seed('2026-10-03-sgc-tipo-plantilla-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-03-sgc-tipo-plantilla-olp.sql'));
    expect(await prisma.sgcDocumentType.count({ where: { id_company: CO, code: 'PLT', name: 'Plantilla', is_active: true } })).toBe(1);
    // Revisión menor: la base exige motivo (10+) y huella juntos.
    const req = await newRequest('Restricción de la revisión menor');
    await expect(prisma.$executeRawUnsafe(`INSERT INTO [sgc].[draft_revision] (id_request, revision_number, origin, content_html, sha256, size_bytes, saved_by, saved_at, minor_reason, base_sha256) VALUES (${req}, 99, N'revision', N'<p>x</p>', N'${'0'.repeat(64)}', 8, N'x', SYSUTCDATETIME(), N'corto', N'${'1'.repeat(64)}')`)).rejects.toThrow(/draft_revision_menor_ck/);
  });

  it('[SGC-REQ-094][SGC-REQ-096] el elaborador ubica las firmas (solo él y durante la elaboración); cada guardado es una fila nueva que no se modifica; la vista previa sale con el encabezado institucional', async () => {
    const r1 = await newRequest('Firmas en el documento');
    const row = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r1 }, include: { signers: true } });
    const participants = await layoutParticipants(prisma, row);
    expect(participants.map((p) => [p.key, p.meaning])).toEqual([
      [`elaboracion:${E.elab}`, 'elaboro'],
      [`revision:${E.rev}`, 'reviso'],
      [`aprobacion:${E.apr}`, 'aprobo'],
      ['aprobacion:grupo:SGC-VERIF-CALIDAD', 'aprobo'],
    ]);
    const v0 = await getDocumentLayout(prisma, r1, await viewer(E.elab));
    expect(v0).toMatchObject({ canEdit: true, institutionalHeader: false, fields: [], suggested: [], saves: 0 });
    expect((await getDocumentLayout(prisma, r1, await viewer(E.rev))).canEdit).toBe(false);
    await expect(saveDocumentLayout(prisma, r1, { institutionalHeader: true }, await viewer(E.rev), actor(E.rev))).rejects.toMatchObject({ status: 403 });
    await expect(saveDocumentLayout(prisma, r1, { fields: [{ signerKey: 'revision:otro@x.co', page: 1, x: 1, y: 1, width: 10, height: 5 }] }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/ya no firma/);
    const s1 = await saveDocumentLayout(prisma, r1, { institutionalHeader: true, fields: [{ signerKey: `elaboracion:${E.elab}`, page: 1, x: 8, y: 14, width: 18, height: 4 }], reason: 'Ubicación de prueba' }, await viewer(E.elab), actor(E.elab));
    expect(s1.saved).toBe(true);
    expect((await saveDocumentLayout(prisma, r1, { institutionalHeader: true, fields: [{ signerKey: `elaboracion:${E.elab}`, page: 1, x: 8, y: 14, width: 18, height: 4 }] }, await viewer(E.elab), actor(E.elab))).saved).toBe(false);
    const v1 = await getDocumentLayout(prisma, r1, await viewer(E.elab));
    expect(v1.institutionalHeader).toBe(true);
    expect(v1.missing).toEqual(participants.slice(1).map((p) => p.key));
    expect(v1.suggested.map((f) => f.signerKey)).toEqual(participants.slice(1).map((p) => p.key));
    expect(await prisma.sgcDocumentLayout.count({ where: { id_request: r1 } })).toBe(1);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'documento.firmas_ubicadas' } })).toBeGreaterThanOrEqual(1);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[document_layout] SET change_reason = N'x' WHERE id_request = ${r1}`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[document_layout] WHERE id_request = ${r1}`)).rejects.toThrow(/solo inserción/);
    // Vista previa: el contenido compuesto (campos de sistema e historial) y el encabezado institucional.
    htmls.length = 0;
    const preview = await buildLayoutPreview(prisma, deps, r1, await viewer(E.rev));
    expect((await PDFDocument.load(preview)).getPageCount()).toBe(2);
    expect(htmls[0]).toContain('@page :first { margin-top: 6.6cm; }');
    expect(htmls[0]).toMatch(/Código \S+ \(provisional\) versión 1\./);
    expect(htmls[0]).toContain('<th>Motivo del cambio</th>');
    expect(htmls[0]).toContain('Al aprobar');
    // Segunda consulta: sale de la caché (no vuelve a convertir).
    await buildLayoutPreview(prisma, deps, r1, await viewer(E.elab));
    expect(htmls).toHaveLength(1);
    await expect(buildLayoutPreview(prisma, deps, r1, await viewer(E.l1))).rejects.toMatchObject({ status: 404 });
    // Guardar sin cajas conserva las ubicadas (solo cambia el encabezado) y el borrador nuevo deja la ubicación «por revisar».
    const s2 = await saveDocumentLayout(prisma, r1, { institutionalHeader: true, reason: '   ' }, await viewer(E.elab), actor(E.elab));
    expect(s2.saved).toBe(false);
    await uploadAttachment(prisma, upload, r1, { purpose: 'borrador', ...docx('Firmas en el documento · versión corregida') }, await viewer(E.elab), actor(E.elab));
    expect((await getDocumentLayout(prisma, r1, await viewer(E.elab))).stale).toBe(true);
    expect((await saveDocumentLayout(prisma, r1, {}, await viewer(E.elab), actor(E.elab))).saved).toBe(true);
    expect((await getDocumentLayout(prisma, r1, await viewer(E.elab))).stale).toBe(false);
  });

  it('[SGC-REQ-096] partir de la plantilla institucional deja el encabezado del sistema; la vista previa de un documento NUEVO muestra el código provisional y el cargo de quien elabora', async () => {
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.elab), { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento nuevo desde la plantilla', description: 'Documento nuevo para la prueba de la plantilla institucional.', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } }, actor(E.elab));
    const html = '<p><strong>Nombre del documento:</strong> {{NOMBRE_DOCUMENTO}}</p><h2>1. OBJETIVO</h2><p>Establecer el objetivo del procedimiento de prueba.</p><h2>10. HISTORIAL DE CAMBIOS</h2><p>{{HISTORIAL_CAMBIOS}}</p>';
    await saveDraftRevision(prisma, idRequest, { html, origin: 'plantilla', originRef: 'Plantilla institucional de procedimiento' }, await viewer(E.elab), actor(E.elab));
    const layout = await latestLayout(prisma, idRequest);
    expect(layout.institutionalHeader).toBe(true);
    // Volver a guardar desde la plantilla no repite la fila (ya tiene el encabezado).
    await saveDraftRevision(prisma, idRequest, { html: `${html}<p>Segunda revisión.</p>`, origin: 'plantilla' }, await viewer(E.elab), actor(E.elab));
    expect(await prisma.sgcDocumentLayout.count({ where: { id_request: idRequest } })).toBe(1);
    htmls.length = 0;
    await buildLayoutPreview(prisma, deps, idRequest, await viewer(E.elab));
    expect(htmls[0]).toContain('Procedimiento nuevo desde la plantilla');
    expect(htmls[0]).toContain('<td>1</td><td>1</td><td>Al aprobar</td><td>—</td>');
    const detail = await getRequestDetail(prisma, idRequest, await viewer(E.elab));
    expect(detail.request.document).toBeNull();
  });

  it('[SGC-REQ-094][SGC-REQ-097] al aprobar, el PDF controlado lleva el encabezado, las firmas en sus cajas (la no ubicada, en su recuadro «Firma») y el recuadro de la fecha de emisión; la composición queda fija', async () => {
    const r1 = (await prisma.sgcRequest.findFirstOrThrow({ where: { id_company: CO, subject: 'Firmas en el documento' } })).id_request;
    const res = await approve(r1);
    expect(res.controlledPdf).toMatchObject({ status: 'generado' });
    await expect(saveDocumentLayout(prisma, r1, { institutionalHeader: false }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 409 });
    const r = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r1 } });
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: r.id_document_version! } });
    const layout = JSON.parse(v.layout_json!) as { institutionalHeader: boolean; emission: { page: number } | null; placements: { uid: string; x: number }[] };
    expect(layout.institutionalHeader).toBe(true);
    expect(layout.emission?.page).toBe(2);
    const manifest = (await readManifest(store.get(v.pdf_item_id)!))!;
    expect(manifest.institutionalHeader).toBe(true);
    expect(manifest.placements).toHaveLength(4);
    const elabSig = await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: r1, meaning: 'elaboro' } });
    expect(manifest.placements!.find((p) => p.uid === elabSig.signature_uid.trim())).toMatchObject({ page: 1, x: 8, y: 14 });
    expect(layout.placements).toEqual(manifest.placements);
    const check = await verifyDocumentVersion(prisma, deps, await getSgcAccessForUser(prisma, E.cal), await getAccessSubject(prisma, E.cal), v.id_document, v.id_document_version, actor(E.cal));
    expect(check.ok).toBe(true);
    // Historial de cambios: la V1 (emisión inicial) y la que se aprobó, con su motivo.
    const rows = await changeHistoryRows(prisma, idDoc, { versionNumber: 3, date: 'Al aprobar', reason: 'Otra' });
    expect(rows[0]).toMatchObject({ versionNumber: 1, date: '2026-01-15', previousVersion: null, reason: 'Carga inicial del documento vigente.' });
    expect(rows.at(-1)).toMatchObject({ versionNumber: 3, previousVersion: 1, reason: 'Otra' });
    expect((await changeHistoryRows(prisma, null, { versionNumber: 1, date: 'Al aprobar', reason: '' }))[0].reason).toBe('Emisión inicial');
  });

  it('[SGC-REQ-094] un borrador PDF no admite el encabezado institucional (ya trae su formato); sus firmas se ubican sobre el PDF', async () => {
    const r = await newRequest('Borrador en PDF', await pdfFile('borrador pdf'));
    await expect(saveDocumentLayout(prisma, r, { institutionalHeader: true }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/PDF ya trae su propio formato/);
    expect((await saveDocumentLayout(prisma, r, { fields: [{ signerKey: `revision:${E.rev}`, page: 1, x: 60, y: 80, width: 20, height: 5 }] }, await viewer(E.elab), actor(E.elab))).saved).toBe(true);
    expect((await latestLayout(prisma, r)).fields).toHaveLength(1);
  });

  it('[SGC-REQ-102] Calidad hace una REVISIÓN MENOR durante la aprobación (motivo, huella nueva, aviso); las firmas previas siguen valiendo sobre lo corregido y el manifiesto la declara', async () => {
    const r2 = await newRequest('Revisión menor de Calidad');
    await signUntilQuality(r2);
    const base = (await getRequestDetail(prisma, r2, await viewer(E.cal))).currentDraft!;
    await expect(getCurrentDraftHtml(prisma, deps, r2, await viewer(E.apr))).rejects.toMatchObject({ status: 403 });
    const current = await getCurrentDraftHtml(prisma, deps, r2, await viewer(E.cal));
    expect(current.baseSha256).toBe(base.sha256);
    expect((await listDraftRevisions(prisma, r2, await viewer(E.cal))).canMinorRevise).toBe(true);
    expect((await listDraftRevisions(prisma, r2, await viewer(E.apr))).canMinorRevise).toBe(false);
    const html = `${current.html}<p>Se corrige una coma del alcance para la revisión menor.</p>`;
    await expect(saveDraftRevision(prisma, r2, { html, minor: true, minorReason: 'corto' }, await viewer(E.cal), actor(E.cal), notifier)).rejects.toThrow(/mínimo 10/);
    await expect(saveDraftRevision(prisma, r2, { html, minor: true, minorReason: 'Corrige una coma.' }, await viewer(E.elab), actor(E.elab), notifier)).rejects.toMatchObject({ status: 403 });
    sent.length = 0;
    const saved = await saveDraftRevision(prisma, r2, { html, minor: true, minorReason: 'Corrige una coma del alcance.' }, await viewer(E.cal), actor(E.cal), notifier);
    expect(saved).toMatchObject({ minor: true });
    expect(sent.some((n) => n.payload.title.includes('Revisión menor') && n.emails.includes(E.elab) && n.emails.includes(E.apr))).toBe(true);
    const revRow = await prisma.sgcDraftRevision.findFirstOrThrow({ where: { id_request: r2, minor_reason: { not: null } } });
    expect(revRow.base_sha256?.trim()).toBe(base.sha256);
    await expect(saveDraftRevision(prisma, r2, { html, minor: true, minorReason: 'Corrige una coma del alcance.' }, await viewer(E.cal), actor(E.cal), notifier)).rejects.toThrow(/No hay cambios/);
    const chain = await minorRevisionChain(prisma, r2, sha256HexOf(revRow.content_html));
    expect(chain).toEqual([expect.objectContaining({ baseSha256: base.sha256, reason: 'Corrige una coma del alcance.', by: E.cal })]);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'borrador.revision_menor_calidad' } })).toBe(1);
    // Calidad aprueba sobre el contenido FINAL; el PDF controlado declara la revisión menor y verifica.
    const apr = await taskOf(r2, 'aprobacion');
    const res = await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res.controlledPdf).toMatchObject({ status: 'generado' });
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: (await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r2 } })).id_document_version! } });
    const manifest = (await readManifest(store.get(v.pdf_item_id)!))!;
    expect(manifest.minorRevisions).toEqual([expect.objectContaining({ baseSha256: base.sha256, reason: 'Corrige una coma del alcance.' })]);
    expect(manifest.signedContent.sha256).toBe(sha256HexOf(revRow.content_html));
    expect(manifest.placements).toBeUndefined();
    const check = await verifyDocumentVersion(prisma, deps, await getSgcAccessForUser(prisma, E.cal), await getAccessSubject(prisma, E.cal), v.id_document, v.id_document_version, actor(E.cal));
    expect(check.ok).toBe(true);
  });

  it('[SGC-REQ-104][SGC-REQ-098] Calidad configura dominios, umbral y logo con motivo; «toda la empresa» deja por fuera los correos de otra empresa', async () => {
    await expect(saveCompanySettings(prisma, CO, { readThresholdPct: 50, reason: 'corto' }, actor(E.cal))).rejects.toThrow(/mínimo 10/);
    await expect(saveCompanySettings(prisma, CO, { readThresholdPct: 0, reason: 'Umbral de la prueba' }, actor(E.cal))).rejects.toThrow(/entre 1 y 100/);
    await expect(saveCompanySettings(prisma, CO, { disseminationDomains: 'no valido', reason: 'Dominios de la prueba' }, actor(E.cal))).rejects.toThrow(/dominios/);
    await expect(saveCompanySettings(prisma, CO, { logoDataUrl: 'data:image/png;base64,AAAA', reason: 'Logo de la prueba' }, actor(E.cal))).rejects.toThrow(/PNG o JPEG/);
    await expect(saveCompanySettings(prisma, CO, { reason: 'Sin cambios en la prueba' }, actor(E.cal))).rejects.toThrow(/No hay cambios/);
    await expect(saveCompanySettings(prisma, 9999, { readThresholdPct: 50, reason: 'Empresa inexistente' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    const s = await saveCompanySettings(prisma, CO, { readThresholdPct: 50, disseminationDomains: ['OneLatamPharma.com'], reason: 'Umbral y dominios de la prueba' }, actor(E.cal));
    expect(s).toMatchObject({ readThresholdPct: 50, disseminationDomains: ['onelatampharma.com'], hasLogo: true });
    const removed = await saveCompanySettings(prisma, CO, { removeLogo: true, reason: 'Quitar el logo en la prueba' }, actor(E.cal));
    expect(removed.hasLogo).toBe(false);
    const last = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, action: 'configuracion.empresa' }, orderBy: { id_audit_log: 'desc' } });
    expect(last.after_json).toContain('"logo":null');
    await prisma.$executeRawUnsafe(seed('2026-10-03-sgc-correcciones-calidad-olp.sql'));
    expect((await getCompanySettings(prisma, CO)).hasLogo).toBe(true);
    // Vista de la divulgación antes de empezar: el alcance «toda la empresa» excluye los correos de GSS.
    const r3 = await newRequest('Alcance por empresa');
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), r3, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(E.elab));
    const row = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r3 }, include: { tasks: { include: { taskDef: true } } } });
    const view = await getDisseminationView(prisma, row, { email: E.elab, isQuality: false }, (e) => e);
    expect(view.outsideCompany.sort()).toEqual([E.gss, E.gss2].sort());
    expect(view.companyDomains).toEqual(['onelatampharma.com']);
    expect(view.threshold).toEqual({ pct: 50, notifiedAt: null });
  });

  it('[SGC-REQ-099][SGC-REQ-100][SGC-REQ-098] la lectura avisa UNA vez al llegar al umbral; una persona de otra empresa elegida a mano sí lee; «No entendí» va al historial y avisa', async () => {
    const r4 = await newRequest('Umbral y no entendí');
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), r4, { entry: { kind: 'persona', email: E.l1 }, reason: 'Lector de la empresa' }, actor(E.elab));
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), r4, { entry: { kind: 'persona', email: E.gss2 }, reason: 'Apoyo de GSS elegido a mano' }, actor(E.elab));
    await addScopeEntry(prisma, notifier, await accessOf(E.elab), r4, { entry: { kind: 'persona', email: E.gss }, reason: 'Otro apoyo de GSS elegido a mano' }, actor(E.elab));
    await approve(r4);
    const t = await taskOf(r4, 'divulgacion');
    expect(t.assignees.map((a) => a.user_email).sort()).toEqual([E.gss, E.gss2, E.l1].sort());
    const a1 = t.assignees.find((a) => a.user_email === E.l1)!;
    await openReadingFile(prisma, a1.id_task_assignee, await viewer(E.l1), actor(E.l1));
    await recordReadingEvent(prisma, a1.id_task_assignee, { event: 'final', pages: 4 }, { email: E.l1 }, actor(E.l1));
    sent.length = 0;
    await signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a1.id_task_assignee }), actor(E.l1));
    // 1 de 3 (33 %): aún no llega al umbral.
    expect(await prisma.sgcReadThresholdNotice.count({ where: { id_task: t.id_task } })).toBe(0);
    // Excluir a una persona cambia el porcentaje: 1 de 2 (50 %) llega al umbral y avisa.
    await excludeReader(prisma, notifier, await accessOf(E.cal), r4, (await prisma.sgcReadRecord.findFirstOrThrow({ where: { id_task: t.id_task, user_email: E.gss } })).id_read_record, { reason: 'No participa en este proceso' }, actor(E.cal));
    const notices = await prisma.sgcReadThresholdNotice.findMany({ where: { id_task: t.id_task } });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ threshold_pct: 50, read_count: 1, counted: 2 });
    expect(Number(notices[0].percent_at)).toBe(50);
    const avisos = sent.filter((n) => n.payload.title.includes('Avance de lectura'));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].emails).toEqual(expect.arrayContaining([E.elab, E.cal]));
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[read_threshold_notice] SET read_count = 9 WHERE id_task = ${t.id_task}`)).rejects.toThrow(/solo inserción/);
    // «No entendí» de la persona de GSS elegida a mano.
    const a2 = t.assignees.find((a) => a.user_email === E.gss2)!;
    await expect(recordReadingDoubt(prisma, notifier, a2.id_task_assignee, { body: 'corto' }, await viewer(E.gss2), actor(E.gss2))).rejects.toThrow(/mínimo 10/);
    await expect(recordReadingDoubt(prisma, notifier, a2.id_task_assignee, { body: 'No entendí el paso tres.' }, await viewer(E.l1), actor(E.l1))).rejects.toMatchObject({ status: 404 });
    sent.length = 0;
    const doubt = await recordReadingDoubt(prisma, notifier, a2.id_task_assignee, { body: 'No entendí el paso tres del procedimiento.' }, await viewer(E.gss2), actor(E.gss2));
    expect(doubt.ok).toBe(true);
    expect(sent.some((n) => n.payload.title.includes('no entendió') && n.emails.includes(E.elab) && n.emails.includes(E.cal))).toBe(true);
    const inter = await prisma.sgcInteraction.findFirstOrThrow({ where: { id_request: r4, kind: 'duda' } });
    expect(inter.body).toContain('No entendí el paso tres del procedimiento.');
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'divulgacion.no_entendi' } })).toBe(1);
    const detail = await getRequestDetail(prisma, r4, await viewer(E.cal));
    expect(detail.dissemination!.doubts).toEqual([expect.objectContaining({ email: E.gss2 })]);
    expect(detail.dissemination!.threshold.notifiedAt).not.toBeNull();
    // Excluir no repite el aviso del umbral (ya salió) y una lectura excluida ya no registra dudas.
    await excludeReader(prisma, notifier, await accessOf(E.cal), r4, (await prisma.sgcReadRecord.findFirstOrThrow({ where: { id_task: t.id_task, user_email: E.gss2 } })).id_read_record, { reason: 'Ya no participa en el proceso' }, actor(E.cal));
    expect(await prisma.sgcReadThresholdNotice.count({ where: { id_task: t.id_task } })).toBe(1);
    await expect(recordReadingDoubt(prisma, notifier, a2.id_task_assignee, { body: 'Otra duda sobre el documento.' }, await viewer(E.gss2), actor(E.gss2))).rejects.toMatchObject({ status: 409 });
    // Con la divulgación cerrada, quien ya leyó tampoco registra dudas por aquí.
    await expect(recordReadingDoubt(prisma, notifier, a1.id_task_assignee, { body: 'Una duda tardía sobre el documento.' }, await viewer(E.l1), actor(E.l1))).rejects.toThrow(/ya cerró/);
  });

  it('[SGC-REQ-094][SGC-REQ-096][SGC-REQ-102][SGC-REQ-103] bordes: vista previa de una nueva versión con borrador PDF, historial agregado sin la marca, borrador alterado, revisión menor sobre un PDF y logo válido', async () => {
    // Nueva versión del vigente con borrador PDF: la vista previa es el mismo PDF (sin encabezado) y valida páginas.
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.elab), { idCompany: CO, requestType: 'nueva_version', subject: 'Nueva versión con borrador PDF', description: 'Cambio de prueba con borrador PDF.', idDocument: idDoc, formValues: { urgencia: 'Normal' } }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'paralelo' }, actor(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...(await pdfFile('nueva versión en pdf')) }, await viewer(E.elab), actor(E.elab));
    const prev = await buildLayoutPreview(prisma, deps, idRequest, await viewer(E.elab));
    expect((await PDFDocument.load(prev)).getPageCount()).toBe(1);
    await expect(saveDocumentLayout(prisma, idRequest, { pageCount: 1, fields: [{ signerKey: `revision:${E.rev}`, page: 2, x: 1, y: 1, width: 10, height: 5 }] }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/fuera del documento/);
    expect((await saveDocumentLayout(prisma, idRequest, { pageCount: 1, fields: [{ signerKey: `revision:${E.rev}`, page: 1, x: 1, y: 1, width: 10, height: 5 }] }, await viewer(E.elab), actor(E.elab))).saved).toBe(true);
    // Borrador alterado en el almacenamiento: no se compone ni se firma.
    const att = await prisma.sgcAttachment.findFirstOrThrow({ where: { id_request: idRequest, purpose: 'borrador' } });
    const original = store.get(att.item_id)!;
    store.set(att.item_id, new Uint8Array([...original, 1]));
    await expect(buildLayoutPreview(prisma, deps, idRequest, await viewer(E.rev))).rejects.toThrow(/huella/);
    store.set(att.item_id, original);
    // Revisión menor: un borrador PDF no se corrige en el editor (se devuelve).
    await signUntilQuality(idRequest);
    await expect(getCurrentDraftHtml(prisma, deps, idRequest, await viewer(E.cal))).rejects.toThrow(/es un PDF/);
    await cancelRequest(prisma, notifier, await accessOf(E.cal), idRequest, { reason: 'Fin de la prueba de bordes' }, actor(E.cal));
    // Historial sin la marca: con encabezado institucional se agrega al final.
    const r = await newRequest('Historial agregado');
    await saveDraftRevision(prisma, r, { html: '<h1>Sin marca de historial</h1><p>Contenido del procedimiento de prueba sin la marca.</p>', origin: 'plantilla' }, await viewer(E.elab), actor(E.elab));
    htmls.length = 0;
    await buildLayoutPreview(prisma, deps, r, await viewer(E.elab));
    expect(htmls[0]).toContain('<h2>HISTORIAL DE CAMBIOS</h2><table>');
    // Revisión menor sobre una revisión del EDITOR (no un Word).
    await signUntilQuality(r);
    const cur = await getCurrentDraftHtml(prisma, deps, r, await viewer(E.cal));
    expect(cur.html).toContain('Sin marca de historial');
    // Logo válido cargado por Calidad.
    const s = await saveCompanySettings(prisma, CO, { logoDataUrl: `data:image/png;base64,${TINY_PNG_B64}`, reason: 'Logo de 8 px de la prueba' }, actor(E.cal));
    expect(s.logoDataUrl).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
  });
});
