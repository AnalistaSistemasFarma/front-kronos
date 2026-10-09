import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs, saveCatalogEntry } from '../../../lib/sgc/db/catalogs';
import { loadParentDocument, resolveNewDocumentCode } from '../../../lib/sgc/db/coding';
import { getCompanySettings, isHeaderMandatory } from '../../../lib/sgc/db/companySettings';
import { createInitialDocument, getAccessSubject, listMasterDocuments, type SgcUploader } from '../../../lib/sgc/db/documents';
import { buildLayoutPreview, getDocumentLayout, saveDocumentLayout } from '../../../lib/sgc/db/layout';
import { confirmMasterListImport, getMasterListImportRows, listMasterListImports, previewMasterListImport } from '../../../lib/sgc/db/masterListImport';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { createRequest, getRequestDetail, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import { signTask, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import type { SgcMasterListRawRow } from '../../../lib/sgc/masterListImport';
import type { SgcNotifier } from '../../../lib/sgc/notifications';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * Sprint 8 contra un SQL Server REAL (efímero en CI): encabezado institucional
 * obligatorio (borrador solo en Word o en el editor), carga inicial abierta,
 * guía de codificación de OLP con herencia del número del procedimiento e
 * importación del listado maestro desde Excel (vista previa, carga, historial
 * de solo inserción). Empresa propia (id 81) sembrada con los SQL del pase.
 * Datos de EJEMPLO: Calidad aún no entrega el listado real.
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 8 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 81;
  const PW = 'Clave-S8-ci#2026';
  const E = {
    sol: 'sol.s8@onelatampharma.com',
    elab: 'elab.s8@onelatampharma.com',
    rev: 'rev.s8@onelatampharma.com',
    apr: 'apr.s8@onelatampharma.com',
    cal: 'calidad.s8@onelatampharma.com',
    lec: 'lector.s8@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.8.8.8', userAgent: 'vitest-s8' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string, extra: [string, string][] = []) => {
    let sql = fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
    for (const [a, b] of extra) sql = sql.replace(a, b);
    return sql;
  };
  const notifier: SgcNotifier = async () => undefined;
  const store = new Map<string, Uint8Array>();
  let uploads = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s8-${++uploads}`;
    store.set(id, new Uint8Array(content));
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const htmls: string[] = [];
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (itemId) => store.get(itemId)!,
    htmlToPdf: async (html) => {
      htmls.push(html);
      return pdfOf('Contenido convertido');
    },
    docxToHtml: async () => '<h1>Formato</h1><p>Código {{CODIGO}} versión {{VERSION}}.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Formato.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba del S8`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  const row = (n: number, values: SgcMasterListRawRow['values']): SgcMasterListRawRow => ({ rowNumber: n, values });

  let procGC = 0;
  let procDT = 0;
  let typePR = 0;
  let typeFO = 0;
  let typeMA = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S8 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    // La empresa se crea con los valores por defecto de la migración: encabezado obligatorio y carga inicial abierta.
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S8', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S8 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.elab, ['gestion', 'calidad']],
      [E.rev, ['gestion']],
      [E.apr, ['gestion']],
      [E.cal, ['calidad']],
      [E.lec, ['lectura']],
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
    procDT = cat.processes.find((p) => p.code === 'DT')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    typeFO = cat.documentTypes.find((t) => t.code === 'FO')!.id;
    typeMA = cat.documentTypes.find((t) => t.code === 'MA')!.id;
    for (const idDocumentType of [typePR, typeFO]) {
      await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType, userEmail: E.elab, reason: 'Elaborador de Calidad de la prueba del S8' }, actor(E.cal));
    }
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba del S8' }, actor('ci@x.co'));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-111][SGC-REQ-112] la migración del S8 agrega columnas, tablas de solo inserción y el estado «pendiente de archivo»; por defecto el encabezado es obligatorio y la carga inicial está abierta', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('master_list_import','master_list_import_row')`;
    expect(tables).toHaveLength(2);
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE object_id IN (OBJECT_ID('sgc.company_config'), OBJECT_ID('sgc.coding_guide'), OBJECT_ID('sgc.request')) AND name IN ('header_mandatory','initial_load_open','initial_load_closed_by','initial_load_closed_at','initial_load_close_reason','child_pattern','child_type_codes','child_sequence_digits','id_parent_document')`;
    expect(cols).toHaveLength(9);
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('master_list_import_solo_insercion','master_list_import_row_solo_insercion')`;
    expect(trg).toHaveLength(2);
    const ck = await prisma.$queryRaw<{ d: string }[]>`SELECT definition AS d FROM sys.check_constraints WHERE name = 'document_status_ck'`;
    expect(ck[0].d).toContain('pendiente_archivo');
    // La migración se puede volver a correr.
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261008100000_sgc_s8_encabezado_listado_maestro/migration.sql'), 'utf8'));
    const s = await getCompanySettings(prisma, CO);
    expect(s).toMatchObject({ headerMandatory: true, initialLoad: { open: true, closedBy: null, closedAt: null, reason: null } });
    expect(await isHeaderMandatory(prisma, CO)).toBe(true);
    expect(await isHeaderMandatory(prisma, 999_999)).toBe(true);
    // Cerrar la carga inicial exige quién, cuándo y motivo (CHECK).
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[company_config] SET initial_load_open = 0 WHERE id_company = ${CO}`)).rejects.toThrow(/company_config_carga_inicial_ck/);
  });

  it('[SGC-REQ-113] guía de OLP: el SQL opcional configura la herencia (idempotente) y Calidad la ajusta desde Configuración con motivo y auditoría', async () => {
    const extra: [string, string][] = [['DECLARE @AplicarPatronPrincipal BIT = 0;', 'DECLARE @AplicarPatronPrincipal BIT = 1;']];
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s8-guia-codificacion-olp.sql', extra));
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s8-guia-codificacion-olp.sql', extra));
    let cat = await getCatalogs(prisma, CO);
    expect(cat.codingGuide).toMatchObject({ pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}', childTypeCodes: ['FO', 'IN'], childSequenceDigits: 2 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'guia_codificacion.editada', detail: { contains: 'Sprint 8' } } })).toBe(1);
    await expect(saveCatalogEntry(prisma, CO, 'coding-guide', { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{TIPO}{CONSECUTIVO}', childTypeCodes: 'FO', reason: 'Herencia sin padre (inválida)' }, actor(E.cal))).rejects.toThrow(/CODIGO_PADRE/);
    await saveCatalogEntry(prisma, CO, 'coding-guide', { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}', childTypeCodes: 'fo, in', childSequenceDigits: 2, reason: 'Guía de OLP confirmada en la prueba del S8' }, actor(E.cal));
    cat = await getCatalogs(prisma, CO);
    expect(cat.codingGuide?.childTypeCodes).toEqual(['FO', 'IN']);
    const row = await prisma.sgcCodingGuide.findUniqueOrThrow({ where: { id_company: CO } });
    expect(row.child_type_codes).toBe('FO,IN');
  });

  it('[SGC-REQ-114][SGC-REQ-115] VISTA PREVIA del listado maestro: valida contra los maestros de la empresa y no guarda nada', async () => {
    const rows = [
      row(2, { code: 'OLP-GC-02', title: 'Control de documentos', documentTypeCode: 'PR', processCode: 'GC', versionNumber: '4', effectiveDate: '2024-05-10' }),
      row(3, { code: 'OLP-GC-02-FO01', title: 'Formato de solicitud de documentos', documentTypeCode: 'FO', processCode: 'GC', versionNumber: '2', effectiveDate: '10/05/2024', parentCode: 'OLP-GC-02' }),
      row(4, { code: 'OLP-XX-01', title: 'Proceso inexistente', documentTypeCode: 'PR', processCode: 'XX', versionNumber: '1', effectiveDate: '2024-01-01' }),
      row(5, { code: 'OLP-DT-07', title: 'Manual de dirección técnica', documentTypeCode: 'MA', processCode: 'DT', versionNumber: '1', effectiveDate: '2023-02-01' }),
    ];
    const before = await prisma.sgcDocument.count({ where: { id_company: CO } });
    const p = await previewMasterListImport(prisma, CO, { fileName: 'listado.xlsx', rows });
    expect(p.summary).toEqual({ total: 4, ok: 3, errors: 1, warnings: 0 });
    expect(p.items[2].errors[0]).toContain('El proceso «XX» no existe');
    expect(p.rowsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await prisma.sgcDocument.count({ where: { id_company: CO } })).toBe(before);
    await expect(previewMasterListImport(prisma, CO, { rows: [] })).rejects.toThrow(/no tiene filas/);
    await expect(previewMasterListImport(prisma, 999_999, { rows })).rejects.toMatchObject({ status: 403 });
  });

  it('[SGC-REQ-114][SGC-REQ-115][SGC-REQ-116] CARGA: crea los documentos «pendientes de archivo» con su código, consecutivo y vigencia; las filas con error se guardan sin cargarse; el historial es de solo inserción', async () => {
    const rows = [
      row(2, { code: 'OLP-GC-02', title: 'Control de documentos', documentTypeCode: 'PR', processCode: 'GC', versionNumber: '4', effectiveDate: '2024-05-10' }),
      row(3, { code: 'OLP-GC-02-FO01', title: 'Formato de solicitud de documentos', documentTypeCode: 'FO', processCode: 'GC', versionNumber: '2', effectiveDate: '10/05/2024', parentCode: 'OLP-GC-02', confidentiality: 'confidencial' }),
      row(4, { code: 'OLP-XX-01', title: 'Proceso inexistente', documentTypeCode: 'PR', processCode: 'XX', versionNumber: '1', effectiveDate: '2024-01-01' }),
      row(5, { code: 'OLP-DT-07', title: 'Manual de dirección técnica', documentTypeCode: 'MA', processCode: 'DT', versionNumber: '1', effectiveDate: '2023-02-01' }),
    ];
    const preview = await previewMasterListImport(prisma, CO, { rows });
    await expect(confirmMasterListImport(prisma, CO, { fileName: 'listado.xlsx', rows, expectedSha256: 'f'.repeat(64) }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const res = await confirmMasterListImport(prisma, CO, { fileName: 'listado-maestro-OLP.xlsx', rows, expectedSha256: preview.rowsSha256 }, actor(E.cal));
    expect(res.summary).toEqual({ total: 4, ok: 3, errors: 1, warnings: 0 });
    expect(res.created.map((c) => c.code)).toEqual(['OLP-GC-02', 'OLP-GC-02-FO01', 'OLP-DT-07']);
    const docs = await prisma.sgcDocument.findMany({ where: { id_company: CO, code: { in: ['OLP-GC-02', 'OLP-GC-02-FO01', 'OLP-DT-07'] } }, orderBy: { code: 'asc' } });
    expect(docs.map((d) => [d.code, d.status, d.sequence_number, d.current_version_id])).toEqual([
      ['OLP-DT-07', 'pendiente_archivo', 7, null],
      ['OLP-GC-02', 'pendiente_archivo', 2, null],
      ['OLP-GC-02-FO01', 'pendiente_archivo', null, null],
    ]);
    expect(docs[1].next_review_date?.toISOString().slice(0, 10)).toBe('2027-05-10');
    expect(docs[2].confidentiality).toBe('confidencial');
    // Historial: encabezado y todas las filas (la de error sin documento).
    const list = await listMasterListImports(prisma, CO);
    expect(list[0]).toMatchObject({ fileName: 'listado-maestro-OLP.xlsx', total: 4, loaded: 3, errors: 1, importedBy: E.cal, rowsSha256: preview.rowsSha256 });
    const imported = await getMasterListImportRows(prisma, CO, list[0].id);
    expect(imported.map((r) => [r.rowNumber, r.status, r.idDocument !== null])).toEqual([
      [2, 'cargada', true],
      [3, 'cargada', true],
      [4, 'error', false],
      [5, 'cargada', true],
    ]);
    expect(imported[1]).toMatchObject({ versionNumber: 2, effectiveDate: '2024-05-10', parentCode: 'OLP-GC-02' });
    expect(imported[2].errors).toContain('XX');
    await expect(getMasterListImportRows(prisma, CO, 999_999)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'documento.importado' } })).toBe(3);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'listado_maestro.importado' } })).toBe(1);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[master_list_import] SET file_name = N'x' WHERE id_company = ${CO}`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[master_list_import_row] WHERE id_master_list_import = ${list[0].id}`)).rejects.toThrow(/solo inserción/);
    // Calidad los ve en el listado maestro filtrando «pendientes de archivo»; quien solo consulta no.
    const cal = await accessOf(E.cal);
    const pend = await listMasterDocuments(prisma, cal, await getAccessSubject(prisma, E.cal), { status: 'pendiente_archivo' });
    expect(pend.map((d) => d.code).sort()).toEqual(['OLP-DT-07', 'OLP-GC-02', 'OLP-GC-02-FO01']);
    expect((await listMasterDocuments(prisma, await accessOf(E.lec), await getAccessSubject(prisma, E.lec), { status: 'pendiente_archivo' })).filter((d) => d.status === 'pendiente_archivo')).toEqual([]);
    // Volver a importar el mismo listado: todo es duplicado → no se carga nada.
    await expect(confirmMasterListImport(prisma, CO, { rows }, actor(E.cal))).rejects.toThrow(/Ninguna fila/);
    await expect(confirmMasterListImport(prisma, CO, { rows: 'x' }, actor(E.cal))).rejects.toThrow(/no tiene filas/);
  });

  it('[SGC-REQ-113] el siguiente documento de un proceso toma el consecutivo desde el mayor código cargado; un formato hereda el número de su procedimiento', async () => {
    expect(await resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'E', processCode: 'GC', documentTypeCode: 'PR' })).toEqual({ code: 'OLP-GC-03', sequence: 3, inherited: false });
    expect(await resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'M', processCode: 'DT', documentTypeCode: 'MA' })).toEqual({ code: 'OLP-DT-08', sequence: 8, inherited: false });
    const parent = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: CO, code: 'OLP-GC-02' } });
    expect(await resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'E', processCode: 'GC', documentTypeCode: 'FO', idParentDocument: parent.id_document })).toEqual({ code: 'OLP-GC-02-FO02', sequence: null, inherited: true });
    expect(await resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'E', processCode: 'GC', documentTypeCode: 'IN', idParentDocument: parent.id_document })).toMatchObject({ code: 'OLP-GC-02-IN01' });
    await expect(resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'E', processCode: 'GC', documentTypeCode: 'FO' })).rejects.toThrow(/indique el documento padre/);
    await expect(resolveNewDocumentCode(prisma, { idCompany: 999_999, processTypeCode: 'E', processCode: 'GC', documentTypeCode: 'PR' })).rejects.toThrow(/no tiene guía/);
    await expect(loadParentDocument(prisma, CO, 999_999)).rejects.toThrow(/documento padre debe ser/);
    await expect(loadParentDocument(prisma, CO, 1.5)).rejects.toThrow(/documento padre debe ser/);
    // Un padre cuyo código no termina en número no puede heredar con {NUMERO_PADRE}.
    await saveCatalogEntry(prisma, CO, 'coding-guide', { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{PREFIJO}-{NUMERO_PADRE}-{TIPO}{CONSECUTIVO}', childTypeCodes: 'FO,IN', childSequenceDigits: 2, reason: 'Patrón con número del padre (prueba)' }, actor(E.cal));
    const odd = await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procDT, idDocumentType: typeMA, title: 'Manual sin número', code: 'MANUAL-DT', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-01', pdf: { bytes: await pdfOf('manual'), fileName: 'm.pdf' } }, actor(E.cal));
    await expect(resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'M', processCode: 'DT', documentTypeCode: 'FO', idParentDocument: odd.idDocument })).rejects.toThrow(/no termina en un número/);
    expect(await resolveNewDocumentCode(prisma, { idCompany: CO, processTypeCode: 'E', processCode: 'GC', documentTypeCode: 'FO', idParentDocument: parent.id_document })).toMatchObject({ code: 'OLP-02-FO01' });
    await saveCatalogEntry(prisma, CO, 'coding-guide', { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}', childTypeCodes: 'FO,IN', childSequenceDigits: 2, reason: 'Se vuelve a la guía de OLP (prueba)' }, actor(E.cal));
    // La carga uno a uno genera el código del formato con su padre.
    await expect(createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: typeFO, title: 'Formato sin padre', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-01', pdf: { bytes: await pdfOf('fo'), fileName: 'f.pdf' } }, actor(E.cal))).rejects.toThrow(/documento padre/);
    const fo = await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: typeFO, title: 'Formato con padre', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-01', idParentDocument: parent.id_document, pdf: { bytes: await pdfOf('fo'), fileName: 'f.pdf' } }, actor(E.cal));
    expect(fo.code).toBe('OLP-GC-02-FO02');
    const manual = await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title: 'Procedimiento con código propio', code: 'OLP-GC-09', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-01', pdf: { bytes: await pdfOf('pr'), fileName: 'p.pdf' } }, actor(E.cal));
    expect((await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: manual.idDocument } })).sequence_number).toBe(9);
  });

  it('[SGC-REQ-111][SGC-REQ-113] una solicitud nueva de un formato exige el documento padre; el borrador PDF se rechaza y el encabezado no se puede apagar; al aprobar el código hereda el número del padre', async () => {
    const parent = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: CO, code: 'OLP-GC-09' } });
    const base = { idCompany: CO, requestType: 'nuevo', subject: 'Formato nuevo del procedimiento', description: 'Formato nuevo para la prueba del Sprint 8.', idProcess: procGC, idDocumentType: typeFO, formValues: { urgencia: 'Normal' } };
    await expect(createRequest(prisma, notifier, await accessOf(E.sol), base, actor(E.sol))).rejects.toThrow(/seleccione el documento padre/);
    await expect(createRequest(prisma, notifier, await accessOf(E.sol), { ...base, idParentDocument: 999_999 }, actor(E.sol))).rejects.toThrow(/documento padre debe ser/);
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.sol), { ...base, idParentDocument: parent.id_document }, actor(E.sol));
    const stored = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } });
    expect(stored.id_parent_document).toBe(parent.id_document);
    // Un procedimiento no hereda: el padre se ignora.
    const pr = await createRequest(prisma, notifier, await accessOf(E.sol), { ...base, idDocumentType: typePR, subject: 'Procedimiento nuevo sin padre', idParentDocument: parent.id_document }, actor(E.sol));
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: pr.idRequest } })).id_parent_document).toBeNull();

    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    // Borrador PDF: rechazado (encabezado obligatorio); Word: aceptado.
    await expect(uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', fileName: 'Formato.pdf', contentType: 'application/pdf', bytes: await pdfOf('pdf') }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 415 });
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx('Formato de la prueba del S8') }, await viewer(E.elab), actor(E.elab));
    // Un PDF como SOPORTE sí se admite.
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'soporte', fileName: 'soporte.pdf', contentType: 'application/pdf', bytes: await pdfOf('soporte') }, await viewer(E.elab), actor(E.elab));
    const detail = await getRequestDetail(prisma, idRequest, await viewer(E.elab));
    expect(detail.request.parentDocument).toEqual({ id: parent.id_document, code: 'OLP-GC-09', title: 'Procedimiento con código propio' });
    expect(detail.request.draftFormats).toEqual(['docx', 'doc']);
    // Encabezado: siempre encendido y no se puede apagar.
    const layout = await getDocumentLayout(prisma, idRequest, await viewer(E.elab));
    expect(layout).toMatchObject({ headerMandatory: true, institutionalHeader: true });
    expect(layout.suggested.length).toBeGreaterThan(0);
    await expect(saveDocumentLayout(prisma, idRequest, { institutionalHeader: false }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/obligatorio/);
    expect((await saveDocumentLayout(prisma, idRequest, { institutionalHeader: true, fields: [] }, await viewer(E.elab), actor(E.elab))).institutionalHeader).toBe(true);
    // Vista previa: encabezado institucional y código provisional heredado.
    htmls.length = 0;
    await buildLayoutPreview(prisma, deps, idRequest, await viewer(E.elab));
    expect(htmls[0]).toContain('@page :first { margin-top: 6.6cm; }');
    expect(htmls[0]).toContain('Código OLP-GC-09-FO01 (provisional)');
    // Firmas y aprobación de Calidad: el documento nace con el código heredado y el encabezado.
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(idRequest, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    const res = await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res.controlledPdf).toMatchObject({ status: 'generado' });
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest }, include: { document: true } });
    expect(req.document?.code).toBe('OLP-GC-09-FO01');
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: req.id_document_version! } });
    expect(JSON.parse(v.layout_json!).institutionalHeader).toBe(true);
  });

  it('[SGC-REQ-111] con el encabezado opcional (configuración revertida) vuelve el comportamiento anterior: se admite el PDF y se puede apagar', async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { header_mandatory: false } });
    try {
      const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento con encabezado opcional', description: 'Prueba del encabezado opcional del Sprint 8.', idProcess: procGC, idDocumentType: typePR, formValues: { urgencia: 'Normal' } }, actor(E.sol));
      await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', fileName: 'Proc.pdf', contentType: 'application/pdf', bytes: await pdfOf('pdf') }, await viewer(E.elab), actor(E.elab));
      const layout = await getDocumentLayout(prisma, idRequest, await viewer(E.elab));
      expect(layout).toMatchObject({ headerMandatory: false, institutionalHeader: false });
      expect((await getRequestDetail(prisma, idRequest, await viewer(E.elab))).request.draftFormats).toEqual(['docx', 'doc', 'pdf']);
      expect((await getCompanySettings(prisma, CO)).headerMandatory).toBe(false);
    } finally {
      await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { header_mandatory: true } });
    }
  });

  it('[SGC-REQ-112] con la carga inicial CERRADA no se vuelve a importar el listado maestro', async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { initial_load_open: false, initial_load_closed_by: E.cal, initial_load_closed_at: new Date(), initial_load_close_reason: 'Cierre de prueba del S8' } });
    try {
      const s = await getCompanySettings(prisma, CO);
      expect(s.initialLoad).toMatchObject({ open: false, closedBy: E.cal, reason: 'Cierre de prueba del S8' });
      await expect(confirmMasterListImport(prisma, CO, { rows: [row(2, { code: 'OLP-GC-30', title: 'Tardío', documentTypeCode: 'PR', processCode: 'GC', versionNumber: '1', effectiveDate: '2024-01-01' })] }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    } finally {
      await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { initial_load_open: true, initial_load_closed_by: null, initial_load_closed_at: null, initial_load_close_reason: null } });
    }
  });
});
