import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { closeInitialLoad, listBulkUploads, previewBulkUpload, startBulkUpload, uploadBulkFile } from '../../../lib/sgc/db/bulkUpload';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { getCompanySettings, saveCompanySettings } from '../../../lib/sgc/db/companySettings';
import { annulDocument, createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { confirmMasterListImport } from '../../../lib/sgc/db/masterListImport';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { getMyPendings, runPendingDigest } from '../../../lib/sgc/db/pendings';
import { addDocumentRelation, decideRelationProposals, getRelationGraph, listDocumentRelations, listRelationProposals, proposeDocumentRelations } from '../../../lib/sgc/db/relations';
import { createRequest } from '../../../lib/sgc/db/requests';
import { runDailySgcJob, runReviewAlerts } from '../../../lib/sgc/db/reviewAlerts';
import type { SgcEmailMessage, SgcMailer } from '../../../lib/sgc/email';
import type { SgcMasterListRawRow } from '../../../lib/sgc/masterListImport';
import type { SgcNotifier } from '../../../lib/sgc/notifications';

/**
 * Sprint 9 contra un SQL Server REAL (efímero en CI): carga masiva de los PDF
 * del listado maestro (emparejamiento por código, aviso de nombre, historial
 * de solo inserción), «Relacionar documentos» (propuestas por código y por el
 * listado, confirmación y descarte), cierre de la carga inicial (409 después),
 * «Mis pendientes» y política de correo por empresa con su resumen diario.
 * Empresa propia (id 91). Datos de EJEMPLO.
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 9 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 91;
  const E = {
    sol: 'sol.s9@onelatampharma.com',
    elab: 'elab.s9@onelatampharma.com',
    cal: 'calidad.s9@onelatampharma.com',
    cal2: 'calidad2.s9@onelatampharma.com',
    lec: 'lector.s9@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.9.9.9', userAgent: 'vitest-s9' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string, extra: [string, string][] = []) => {
    let sql = fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
    for (const [a, b] of extra) sql = sql.replace(a, b);
    return sql;
  };
  const sent: { emails: string[] }[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const mails: SgcEmailMessage[] = [];
  const mailer: SgcMailer = async (messages) => {
    mails.push(...messages);
    return messages.map((m) => (m.to === E.cal2 ? { to: m.to, ok: false as const, error: 'buzón lleno' } : { to: m.to, ok: true as const }));
  };
  const store = new Map<string, Uint8Array>();
  let uploads = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s9-${++uploads}`;
    store.set(id, new Uint8Array(content));
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const row = (n: number, values: SgcMasterListRawRow['values']): SgcMasterListRawRow => ({ rowNumber: n, values });
  const listado = [
    row(2, { code: 'OLP-GC-02', title: 'Control de documentos y registros', documentTypeCode: 'PR', processCode: 'GC', versionNumber: '3', effectiveDate: '2023-11-07' }),
    row(3, { code: 'OLP-GC-02-FO01', title: 'Formato de solicitud de documentos', documentTypeCode: 'FO', processCode: 'GC', versionNumber: '1', effectiveDate: '2024-02-01', parentCode: 'OLP-GC-02' }),
    row(4, { code: 'OLP-GC-02-IN01', title: 'Instructivo de codificación', documentTypeCode: 'IN', processCode: 'GC', versionNumber: '2', effectiveDate: '2024-03-01' }),
    row(5, { code: 'OLP-DT-04', title: 'Manual de dirección técnica', documentTypeCode: 'MA', processCode: 'DT', versionNumber: '1', effectiveDate: '2024-01-15' }),
    row(6, { code: 'OLP-DT-05', title: 'Manual que se anula', documentTypeCode: 'MA', processCode: 'DT', versionNumber: '1', effectiveDate: '2024-01-15' }),
  ];
  const idOf = async (code: string) => (await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: CO, code } })).id_document;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S9 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S9', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S9 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync('Clave-S9-ci#2026', 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.elab, ['gestion', 'calidad']],
      [E.cal, ['calidad']],
      [E.cal2, ['calidad']],
      [E.lec, ['lectura']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql', '2026-10-01-sgc-s5-vencimientos-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s8-guia-codificacion-olp.sql', [['DECLARE @AplicarPatronPrincipal BIT = 0;', 'DECLARE @AplicarPatronPrincipal BIT = 1;']]));
    const cat = await getCatalogs(prisma, CO);
    const procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    const typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typePR, userEmail: E.elab, reason: 'Elaborador de la prueba del S9' }, actor(E.cal));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    for (const email of [E.cal, E.cal2]) await grantAuthorizationTypeUser(prisma, CO, calType.id, { email, reason: 'Calidad de la prueba del S9' }, actor('ci@x.co'));
    await confirmMasterListImport(prisma, CO, { fileName: 'listado-s9.xlsx', rows: listado }, actor(E.cal));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-121] la migración del S9 agrega tablas de solo inserción y columnas; el correo queda en «nunca» por defecto y las relaciones existentes, confirmadas', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('bulk_upload','bulk_upload_item')`;
    expect(tables).toHaveLength(2);
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('bulk_upload_solo_insercion','bulk_upload_item_solo_insercion')`;
    expect(trg).toHaveLength(2);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261008110000_sgc_s9_archivos_relaciones_correo/migration.sql'), 'utf8'));
    expect((await getCompanySettings(prisma, CO)).emailMode).toBe('nunca');
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[company_config] SET email_mode = N'siempre' WHERE id_company = ${CO}`)).rejects.toThrow(/company_config_email_mode_ck/);
  });

  it('[SGC-REQ-117] VISTA PREVIA de la carga masiva: empareja por código y avisa si el nombre no coincide (no guarda nada)', async () => {
    const files = await previewBulkUpload(prisma, CO, { fileNames: ['OLP-GC-02 Control de documentos y registros.pdf', 'OLP-GC-02-FO01 Compras internacionales.pdf', 'SIN-CODIGO.pdf', 'OLP-GC-02 copia.pdf', ' ', 7] });
    expect(files.map((f) => [f.code, f.status, f.warning !== null])).toEqual([
      ['OLP-GC-02', 'cargable', false],
      ['OLP-GC-02-FO01', 'cargable', true],
      [null, 'error', false],
      ['OLP-GC-02', 'error', false],
    ]);
    await expect(previewBulkUpload(prisma, CO, { fileNames: [] })).rejects.toThrow(/Seleccione/);
    await expect(previewBulkUpload(prisma, CO, { fileNames: Array.from({ length: 501 }, (_, i) => `${i}.pdf`) })).rejects.toThrow(/500/);
    expect(await prisma.sgcBulkUpload.count({ where: { id_company: CO } })).toBe(0);
  });

  it('[SGC-REQ-117] CARGA MASIVA: cada PDF deja su documento VIGENTE con la versión y la vigencia del listado; los errores quedan en el historial sin cortar la tanda', async () => {
    await expect(startBulkUpload(prisma, CO, { filesTotal: 0 }, actor(E.cal))).rejects.toThrow(/1 a 500/);
    await expect(startBulkUpload(prisma, 999_999, { filesTotal: 1 }, actor(E.cal))).rejects.toMatchObject({ status: 403 });
    const { idBulkUpload } = await startBulkUpload(prisma, CO, { filesTotal: 6 }, actor(E.cal));
    const ok = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-02 Control de documentos y registros.pdf', bytes: await pdfOf('OLP-GC-02 V3') }, actor(E.cal));
    expect(ok).toMatchObject({ status: 'cargado', code: 'OLP-GC-02', warning: null, error: null });
    const warn = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-02-FO01 Compras internacionales.pdf', bytes: await pdfOf('FO01') }, actor(E.cal));
    expect(warn.status).toBe('cargado');
    expect(warn.warning).toContain('no coincide');
    const again = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-02.pdf', bytes: await pdfOf('otra vez') }, actor(E.cal));
    expect(again).toMatchObject({ status: 'error', error: expect.stringContaining('ya tiene su archivo') });
    const notPdf = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-02-IN01 Instructivo.pdf', bytes: new TextEncoder().encode('no es pdf') }, actor(E.cal));
    expect(notPdf).toMatchObject({ status: 'error', code: 'OLP-GC-02-IN01', error: 'El archivo controlado debe ser un PDF.' });
    // Un documento «pendiente de archivo» sin fila del listado (creado por fuera) no tiene versión ni vigencia.
    const cat = await getCatalogs(prisma, CO);
    const orphan = await prisma.sgcDocument.create({ data: { id_company: CO, code: 'OLP-DT-99', title: 'Huérfano', id_document_type: cat.documentTypes.find((t) => t.code === 'MA')!.id, id_process_map: cat.processes.find((p) => p.code === 'DT')!.id, status: 'pendiente_archivo', created_by: 'ci' } });
    const noList = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: '', bytes: await pdfOf('x') }, actor(E.cal));
    expect(noList).toMatchObject({ fileName: 'archivo.pdf', status: 'error' });
    const noVersion = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-DT-99.pdf', bytes: await pdfOf('x') }, actor(E.cal));
    expect(noVersion.error).toContain('no tiene versión');
    await expect(uploadBulkFile(prisma, upload, CO, 999_999, { fileName: 'a.pdf', bytes: new Uint8Array() }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'a.pdf', bytes: new Uint8Array() }, actor(E.cal2))).rejects.toMatchObject({ status: 403 });
    // Resultado en la base: vigentes con versión del listado; el historial con todo.
    const doc = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: CO, code: 'OLP-GC-02' } });
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: doc.current_version_id! } });
    expect([doc.status, v.version_number, v.status, v.effective_date?.toISOString().slice(0, 10), v.review_due_date?.toISOString().slice(0, 10)]).toEqual(['vigente', 3, 'vigente', '2023-11-07', '2026-11-07']);
    const hist = await listBulkUploads(prisma, CO);
    expect(hist[0]).toMatchObject({ filesTotal: 6, loaded: 2, errors: 4, warnings: 1, createdBy: E.cal });
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[bulk_upload_item] SET warning = NULL WHERE id_bulk_upload = ${idBulkUpload}`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[bulk_upload] WHERE id_bulk_upload = ${idBulkUpload}`)).rejects.toThrow(/solo inserción/);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'documento.carga', entity_id: String(doc.id_document) } })).toBe(1);
    await annulDocument(prisma, await getSgcAccessForUser(prisma, E.cal), orphan.id_document, 'Documento huérfano de la prueba', actor(E.cal));
  });

  it('[SGC-REQ-118] «Relacionar documentos» propone por el listado y por el código, Calidad confirma o descarta, y el mapa solo muestra las confirmadas', async () => {
    const cal = await accessOf(E.cal);
    await expect(proposeDocumentRelations(prisma, await accessOf(E.sol), actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(listRelationProposals(prisma, await accessOf(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(decideRelationProposals(prisma, await accessOf(E.sol), { ids: [1], action: 'confirmar' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    const gc02 = await idOf('OLP-GC-02');
    const fo01 = await idOf('OLP-GC-02-FO01');
    const in01 = await idOf('OLP-GC-02-IN01');
    expect(await proposeDocumentRelations(prisma, cal, actor(E.cal))).toEqual({ created: 2 });
    const list = await listRelationProposals(prisma, cal);
    expect(list.map((p) => [p.source.id, p.type, p.target.id, p.origin])).toEqual([
      [fo01, 'formato', gc02, 'listado'],
      [gc02, 'procedimiento_padre', in01, 'codigo'],
    ]);
    // No se repiten.
    expect(await proposeDocumentRelations(prisma, cal, actor(E.cal))).toEqual({ created: 0 });
    // Mientras estén propuestas, no aparecen en el mapa ni en la ficha.
    const subject = await getAccessSubject(prisma, E.cal);
    const graph0 = await getRelationGraph(prisma, cal, subject, { statuses: ['vigente', 'pendiente_archivo'] });
    expect(graph0.edges).toEqual([]);
    expect(await listDocumentRelations(prisma, await getSgcAccessForUser(prisma, E.cal), subject, gc02)).toEqual([]);
    await expect(decideRelationProposals(prisma, cal, { ids: [], action: 'confirmar' }, actor(E.cal))).rejects.toThrow(/Seleccione/);
    await expect(decideRelationProposals(prisma, cal, { ids: [list[0].id], action: 'otra' }, actor(E.cal))).rejects.toThrow(/Acción inválida/);
    await expect(decideRelationProposals(prisma, cal, { ids: [list[1].id], action: 'descartar', reason: 'corto' }, actor(E.cal))).rejects.toThrow(/mínimo 10/);
    await expect(decideRelationProposals(prisma, cal, { ids: [999_999], action: 'confirmar' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    expect(await decideRelationProposals(prisma, cal, { ids: [list[0].id], action: 'confirmar', reason: 'Revisado con el listado' }, actor(E.cal))).toEqual({ confirmed: 1 });
    expect(await decideRelationProposals(prisma, cal, { ids: [list[1].id], action: 'descartar', reason: 'El instructivo es de otro proceso' }, actor(E.cal))).toEqual({ discarded: 1 });
    const confirmed = await prisma.sgcDocumentRelation.findUniqueOrThrow({ where: { id_document_relation: list[0].id } });
    expect(confirmed).toMatchObject({ status: 'confirmada', confirmed_by: E.cal, origin: 'listado', is_active: true });
    const graph = await getRelationGraph(prisma, cal, subject, { statuses: ['vigente', 'pendiente_archivo'] });
    expect(graph.edges.map((e) => [e.source, e.type, e.target])).toEqual([[fo01, 'formato', gc02]]);
    expect(await listRelationProposals(prisma, cal)).toEqual([]);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: { in: ['relacion.propuesta', 'relacion.confirmada', 'relacion.retirada'] } } })).toBe(3);
    // Una relación manual de Calidad queda confirmada de una vez.
    const manual = await addDocumentRelation(prisma, await getSgcAccessForUser(prisma, E.cal), { idSource: in01, targetCode: 'OLP-DT-04', type: 'referencia', reason: 'Referencia manual de la prueba' }, actor(E.cal));
    expect(manual).toMatchObject({ origin: 'manual', status: 'confirmada', confirmed_by: E.cal });
  });

  it('[SGC-REQ-120] «Mis pendientes» suma lo que le toca a la persona en la empresa', async () => {
    await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento nuevo del S9', description: 'Solicitud de la prueba de pendientes del Sprint 9.', idProcess: (await getCatalogs(prisma, CO)).processes.find((p) => p.code === 'GC')!.id, idDocumentType: (await getCatalogs(prisma, CO)).documentTypes.find((t) => t.code === 'PR')!.id, formValues: { urgencia: 'Normal' } }, actor(E.sol));
    const mine = await getMyPendings(prisma, E.elab, await accessOf(E.elab));
    expect(mine.counts.tareas).toBeGreaterThanOrEqual(1);
    expect(mine.counts.total).toBe(mine.counts.tareas + mine.counts.lecturas + mine.counts.autorizaciones + mine.counts.capacitaciones + mine.counts.copias);
    expect(mine.items[0]).toMatchObject({ group: 'tareas', subject: 'Procedimiento nuevo del S9' });
    const lector = await getMyPendings(prisma, E.lec, await accessOf(E.lec), async () => ({ copias: 1 }));
    expect(lector.counts).toMatchObject({ total: 1, copias: 1 });
  });

  it('[SGC-REQ-121] con la política «nunca» los avisos de vencimiento solo van a la campana; con «resumen_diario» sale un correo al día a quien tiene pendientes', async () => {
    // OLP-GC-02 vence el 2026-11-07: a 30 días sale el aviso anticipado, pero sin correo aunque la
    // configuración de avisos de la empresa tenga el correo encendido (la política «nunca» manda).
    await prisma.sgcReviewAlertConfig.updateMany({ where: { id_company: CO, scope: 'empresa' }, data: { email_enabled: true } });
    mails.length = 0;
    const s = await runReviewAlerts(prisma, { notifier, mailer, appUrl: 'https://synerlink.test/' }, { now: new Date('2026-10-08T12:00:00Z'), idCompany: CO });
    expect(s.sent).toBeGreaterThanOrEqual(1);
    expect(s.emails).toBe(0);
    expect(mails).toEqual([]);
    const alert = await prisma.sgcReviewAlert.findFirstOrThrow({ where: { id_company: CO, status: 'enviado' } });
    expect(JSON.parse(alert.channels_json).every((c: { correo: string }) => c.correo === 'apagado')).toBe(true);
    // Calidad cambia la política (con motivo; queda en la auditoría).
    await expect(saveCompanySettings(prisma, CO, { emailMode: 'siempre', reason: 'Política de correo de la prueba' }, actor(E.cal))).rejects.toThrow(/Política de correo inválida/);
    await saveCompanySettings(prisma, CO, { emailMode: 'resumen_diario', reason: 'Resumen diario de la prueba del S9' }, actor(E.cal));
    expect((await getCompanySettings(prisma, CO)).emailMode).toBe('resumen_diario');
    const now = new Date('2026-10-09T11:00:00Z');
    const job = await runDailySgcJob(prisma, { notifier, mailer, appUrl: 'https://synerlink.test/' }, { now, idCompany: CO, source: 'manual', actorEmail: E.cal });
    expect(job.digests).toBeGreaterThanOrEqual(1);
    expect(mails.some((m) => m.to === E.elab && m.title.includes('Sus pendientes del SGC'))).toBe(true);
    // El mismo día no se repite; el error de un buzón queda en la auditoría.
    expect(await runPendingDigest(prisma, { mailer, appUrl: 'https://synerlink.test/' }, { now, idCompany: CO })).toEqual({ companies: 0, emails: 0, errors: 0 });
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, action: 'correo.resumen_diario' } });
    expect(audit.entity_id).toBe(`${CO}:2026-10-09`);
    // Un mailer que falla del todo no rompe la corrida.
    const broken: SgcMailer = async () => {
      throw new Error('servicio caído');
    };
    expect(await runPendingDigest(prisma, { mailer: broken, appUrl: 'https://synerlink.test/' }, { now: new Date('2026-10-10T11:00:00Z'), idCompany: CO })).toMatchObject({ companies: 1, emails: 0 });
    await saveCompanySettings(prisma, CO, { emailMode: 'nunca', reason: 'Se vuelve al correo apagado' }, actor(E.cal));
  });

  it('[SGC-REQ-119] la carga inicial no se cierra con documentos pendientes; cerrada, la carga uno a uno, el listado y los PDF responden 409', async () => {
    await expect(closeInitialLoad(prisma, CO, { reason: 'corto' }, actor(E.cal))).rejects.toThrow(/mínimo 10/);
    await expect(closeInitialLoad(prisma, 999_999, { reason: 'Empresa que no existe' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(closeInitialLoad(prisma, CO, { reason: 'Carga del listado terminada' }, actor(E.cal))).rejects.toThrow(/pendientes de archivo/);
    // Se cargan o anulan los que faltan.
    const { idBulkUpload } = await startBulkUpload(prisma, CO, { filesTotal: 2 }, actor(E.cal));
    await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-02-IN01 Instructivo de codificación.pdf', bytes: await pdfOf('IN01') }, actor(E.cal));
    await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-DT-04 Manual de dirección técnica.pdf', bytes: await pdfOf('DT04') }, actor(E.cal));
    await annulDocument(prisma, await getSgcAccessForUser(prisma, E.cal), await idOf('OLP-DT-05'), 'No se va a cargar en el SGC', actor(E.cal));
    expect(await closeInitialLoad(prisma, CO, { reason: 'Carga del listado terminada y verificada' }, actor(E.cal), new Date('2026-10-09T15:00:00Z'))).toEqual({ open: false, closedAt: '2026-10-09T15:00:00.000Z' });
    expect((await getCompanySettings(prisma, CO)).initialLoad).toMatchObject({ open: false, closedBy: E.cal, reason: 'Carga del listado terminada y verificada' });
    await expect(closeInitialLoad(prisma, CO, { reason: 'Otra vez el mismo cierre' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const cat = await getCatalogs(prisma, CO);
    await expect(createInitialDocument(prisma, upload, { idCompany: CO, idProcess: cat.processes.find((p) => p.code === 'DT')!.id, idDocumentType: cat.documentTypes.find((t) => t.code === 'MA')!.id, title: 'Tardío', code: 'OLP-DT-40', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-01', pdf: { bytes: await pdfOf('t'), fileName: 't.pdf' } }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(startBulkUpload(prisma, CO, { filesTotal: 1 }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-DT-04.pdf', bytes: await pdfOf('x') }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(confirmMasterListImport(prisma, CO, { rows: [row(2, { code: 'OLP-GC-40', title: 'Tardío', documentTypeCode: 'PR', processCode: 'GC', versionNumber: '1', effectiveDate: '2024-01-01' })] }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'carga_inicial.cerrada' } })).toBe(1);
  });
});
