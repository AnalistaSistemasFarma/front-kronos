import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { startBulkUpload, uploadBulkFile } from '../../../lib/sgc/db/bulkUpload';
import { getCatalogs, saveCatalogEntry } from '../../../lib/sgc/db/catalogs';
import type { SgcUploader } from '../../../lib/sgc/db/documents';
import { buildHeaderTemplatePreview, headerTemplateForType, listHeaderTemplates, saveHeaderTemplate, setDefaultHeaderTemplate } from '../../../lib/sgc/db/headerTemplates';
import { buildLayoutPreview } from '../../../lib/sgc/db/layout';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { confirmMasterListImport } from '../../../lib/sgc/db/masterListImport';
import { createRequest, getRequestDetail, uploadAttachment } from '../../../lib/sgc/db/requests';
import type { SgcMasterListRawRow } from '../../../lib/sgc/masterListImport';
import type { SgcNotifier } from '../../../lib/sgc/notifications';

/**
 * S16 contra un SQL Server REAL (efímero en CI): encabezado por tipo
 * documental (R31, D20), formatos en Excel (R32, D17) y carga de lo ya
 * aprobado en Word y Excel (R33). Empresa propia (id 117).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · S16 · encabezados por tipo y Excel con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 117;
  const E = { sol: 'sol.s16@onelatampharma.com', elab: 'elab.s16@onelatampharma.com', cal: 'calidad.s16@onelatampharma.com' };
  const actor = (email: string) => ({ email, ip: '10.16.16.16', userAgent: 'vitest-s16' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const notifier: SgcNotifier = async () => undefined;
  const store = new Map<string, Uint8Array>();
  const names = new Map<string, string>();
  let n = 0;
  const upload: SgcUploader = async (_s, fileName, content) => {
    const id = `s16-${++n}`;
    store.set(id, new Uint8Array(content));
    names.set(id, fileName);
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const htmls: string[] = [];
  const convert = {
    docxToHtml: async () => '<h1>Procedimiento convertido</h1><p>Contenido del Word.</p>',
    htmlToPdf: async (html: string) => {
      htmls.push(html);
      return pdfOf('Contenido convertido S16');
    },
  };
  const layoutDeps = { download: async (id: string) => store.get(id)!, ...convert };
  const pdfText = async (bytes: Uint8Array, page: number) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
    return ((await (await doc.getPage(page)).getTextContent()).items as { str: string }[]).map((i) => i.str).join(' ');
  };
  const xlsx = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Registro');
    ws.mergeCells('A1:B1');
    ws.getCell('A1').value = 'REGISTRO DE TEMPERATURA';
    ws.getCell('A1').font = { bold: true };
    ws.getCell('A2').value = 'Fecha';
    ws.getCell('B2').value = 'Temperatura';
    return new Uint8Array(await wb.xlsx.writeBuffer());
  };
  const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('word')]);
  let typeFO = 0;
  let typePR = 0;
  let procGC = 0;

  beforeAll(async () => {
    // Política vigente (RN 2026-10-05): la matriz asigna al elaborador aunque no sea de Calidad.
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'tarea_o_calidad');
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S16 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S16', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S16 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync('Clave-S16-ci#2026', 4);
    for (const [email, perms] of [[E.sol, ['gestion']], [E.elab, ['gestion']], [E.cal, ['gestion', 'calidad']]] as [string, string[]][]) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typeFO = cat.documentTypes.find((t) => t.code === 'FO')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    for (const idType of [typeFO, typePR]) await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: idType, userEmail: E.elab, reason: 'Elaborador de la prueba del S16' }, actor(E.cal));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-163][SGC-REQ-164] la migración agrega la tabla y las columnas; el SQL de OLP crea la plantilla por defecto y habilita Excel en «Formato» (idempotente)', async () => {
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE (object_id = OBJECT_ID('sgc.document_type') AND name IN ('id_header_template','draft_extensions')) OR (object_id = OBJECT_ID('sgc.document_version') AND name = 'source_sha256') OR (object_id = OBJECT_ID('sgc.bulk_upload_item') AND name = 'source_kind')`;
    expect(cols).toHaveLength(4);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261014110000_sgc_s16_encabezados_excel/migration.sql'), 'utf8'));
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s16-encabezados-excel-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s16-encabezados-excel-olp.sql'));
    const list = await listHeaderTemplates(prisma, CO);
    expect(list).toEqual([expect.objectContaining({ code: 'INSTITUCIONAL', isDefault: true, isActive: true, version: 1 })]);
    const cat = await getCatalogs(prisma, CO);
    expect(cat.documentTypes.find((t) => t.code === 'FO')!.draftExtensions).toEqual(['docx', 'xlsx']);
    expect(cat.documentTypes.find((t) => t.code === 'PR')!.draftExtensions).toEqual(['docx']);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: { in: ['encabezado.plantilla_creada', 'tipo_documental.encabezado_formatos'] } } })).toBe(2);
    // Una sola por defecto; no se borra.
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[header_template] WHERE id_company = ${CO}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-163] Calidad crea y edita plantillas con motivo (sube la versión), cambia la por defecto y la asigna a un tipo; el tipo la resuelve', async () => {
    const created = await saveHeaderTemplate(prisma, CO, { code: 'formato', name: 'Encabezado de formatos', config: { titleLabel: 'Nombre del formato', bottomRow: 'leyenda', legend: 'Formato controlado' }, reason: 'Plantilla de formatos de Calidad' }, actor(E.cal));
    expect(created.version).toBe(1);
    await expect(saveHeaderTemplate(prisma, CO, { code: 'FORMATO', name: 'Duplicada', reason: 'Otra igual' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(saveHeaderTemplate(prisma, CO, { id: created.id, name: 'Encabezado de formatos', config: { titleLabel: 'Nombre del formato', bottomRow: 'leyenda', legend: 'Formato controlado' }, reason: 'Sin cambios reales' }, actor(E.cal))).rejects.toThrow(/No hay cambios/);
    const edited = await saveHeaderTemplate(prisma, CO, { id: created.id, name: 'Encabezado de formatos', config: { titleLabel: 'Nombre del formato', bottomRow: 'leyenda', legend: 'Formato controlado por Calidad' }, reason: 'Ajuste de la leyenda' }, actor(E.cal));
    expect(edited.version).toBe(2);
    const log = await prisma.sgcConfigChangeLog.findFirstOrThrow({ where: { id_company: CO, action: 'encabezado.plantilla_editada' }, orderBy: { id_config_change: 'desc' } });
    expect(JSON.parse(log.after_json!).cambios).toEqual(['legend: «Formato controlado» → «Formato controlado por Calidad»']);
    const def = (await listHeaderTemplates(prisma, CO)).find((t) => t.isDefault)!;
    await expect(saveHeaderTemplate(prisma, CO, { id: def.id, name: def.name, config: def.config, isActive: false, reason: 'Desactivar la por defecto' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    // Asignación al tipo «Formato» (con motivo; queda en el control de cambios).
    const fo = (await getCatalogs(prisma, CO, true)).documentTypes.find((t) => t.code === 'FO')!;
    await saveCatalogEntry(prisma, CO, 'document-types', { id: fo.id, code: fo.code, name: fo.name, pluralName: fo.pluralName, requiresTraining: fo.requiresTraining, reviewMonths: fo.reviewMonths, alertMonths: fo.alertMonths, sortOrder: fo.sortOrder, isActive: true, idHeaderTemplate: created.id, draftExtensions: 'docx,xlsx', reason: 'Los formatos usan su encabezado' }, actor(E.cal));
    expect((await headerTemplateForType(prisma, CO, typeFO)).ref).toEqual({ id: created.id, code: 'FORMATO', version: 2 });
    expect((await headerTemplateForType(prisma, CO, typePR)).ref).toMatchObject({ code: 'INSTITUCIONAL' });
    await expect(saveCatalogEntry(prisma, CO, 'document-types', { id: fo.id, code: fo.code, name: fo.name, pluralName: fo.pluralName, reviewMonths: 36, alertMonths: 2, draftExtensions: 'pdf', reason: 'Formato no admitido' }, actor(E.cal))).rejects.toThrow(/no admitido/);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, entity: 'document_type', entity_id: String(fo.id), action: 'tipo_documental.encabezado_formatos' } })).toBe(2);
    // Errores: no existe, ya es la por defecto, inactiva.
    await expect(setDefaultHeaderTemplate(prisma, CO, 999_999, { reason: 'No existe' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(setDefaultHeaderTemplate(prisma, CO, def.id, { reason: 'Ya es la por defecto' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    const off = await saveHeaderTemplate(prisma, CO, { code: 'INACTIVA', name: 'Plantilla que se desactiva', config: {}, reason: 'Plantilla de prueba' }, actor(E.cal));
    await saveHeaderTemplate(prisma, CO, { id: off.id, name: 'Plantilla que se desactiva', config: {}, isActive: false, reason: 'Se desactiva' }, actor(E.cal));
    await expect(setDefaultHeaderTemplate(prisma, CO, off.id, { reason: 'Inactiva' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(saveHeaderTemplate(prisma, CO, { id: 999_999, name: 'No existe', reason: 'No existe' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(saveHeaderTemplate(prisma, CO, { code: 'X1', name: 'ab', reason: 'Nombre corto' }, actor(E.cal))).rejects.toThrow(/nombre/);
    await expect(buildHeaderTemplatePreview(prisma, CO, { idTemplate: 999_999 })).rejects.toMatchObject({ status: 404 });
    await expect(buildHeaderTemplatePreview(prisma, 999_999, {})).rejects.toMatchObject({ status: 404 });
    // Inactiva: el tipo que la tenga usa la por defecto.
    expect((await headerTemplateForType(prisma, CO, null)).ref).toMatchObject({ code: 'INSTITUCIONAL' });
    // Cambiar la por defecto: queda una sola.
    await setDefaultHeaderTemplate(prisma, CO, created.id, { reason: 'Prueba de la por defecto' }, actor(E.cal));
    expect((await listHeaderTemplates(prisma, CO)).filter((t) => t.isDefault).map((t) => t.code)).toEqual(['FORMATO']);
    await setDefaultHeaderTemplate(prisma, CO, def.id, { reason: 'Vuelve la institucional' }, actor(E.cal));
    // Vista previa con datos de ejemplo.
    const preview = await buildHeaderTemplatePreview(prisma, CO, { idTemplate: created.id });
    expect(await pdfText(preview, 1)).toContain('Formato controlado por Calidad');
    expect(await pdfText(await buildHeaderTemplatePreview(prisma, CO, { config: { titleLabel: 'Nombre del instructivo' } }), 1)).toContain('NOMBRE DEL INSTRUCTIVO');
  });

  it('[SGC-REQ-164] el borrador en Excel se acepta solo en un tipo que lo admite, se compone con el encabezado de su tipo sin pasar por Word y no admite revisión menor', async () => {
    const fo = (await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Registro de temperatura', description: 'Formato en Excel de la prueba del S16.', idProcess: procGC, idDocumentType: typeFO, requiresTraining: 'no', formValues: { urgencia: 'Normal' } }, actor(E.sol))).idRequest;
    const pr = (await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento en Excel no', description: 'Procedimiento de la prueba del S16.', idProcess: procGC, idDocumentType: typePR, requiresTraining: 'no', formValues: { urgencia: 'Normal' } }, actor(E.sol))).idRequest;
    const bytes = await xlsx();
    await expect(uploadAttachment(prisma, upload, pr, { purpose: 'borrador', fileName: 'Procedimiento.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes }, await viewer(E.elab), actor(E.elab))).rejects.toMatchObject({ status: 415 });
    await expect(uploadAttachment(prisma, upload, fo, { purpose: 'borrador', fileName: 'Registro.xlsx', contentType: 'x', bytes: new TextEncoder().encode('no es un excel') }, await viewer(E.elab), actor(E.elab))).rejects.toThrow(/no es un Excel/);
    await uploadAttachment(prisma, upload, fo, { purpose: 'borrador', fileName: 'Registro de temperatura.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes }, await viewer(E.elab), actor(E.elab));
    const detail = await getRequestDetail(prisma, fo, await viewer(E.elab));
    expect(detail.currentDraft).toMatchObject({ format: 'xlsx', name: 'Registro de temperatura.xlsx' });
    expect(detail.request.draftFormats).toEqual(['docx', 'doc', 'xlsx']);
    expect((await getRequestDetail(prisma, pr, await viewer(E.elab))).request.draftFormats).toEqual(['docx', 'doc']);
    htmls.length = 0;
    const preview = await buildLayoutPreview(prisma, layoutDeps, fo, await viewer(E.elab));
    expect(htmls).toHaveLength(1);
    expect(htmls[0]).toContain('REGISTRO DE TEMPERATURA');
    expect(htmls[0]).toContain('colspan="2"');
    expect(htmls[0]).toContain('table.sgc-hoja');
    const t = await pdfText(preview, 1);
    expect(t).toContain('NOMBRE DEL FORMATO');
    expect(t).toContain('Formato controlado por Calidad');
  });

  it('[SGC-REQ-165] la carga inicial acepta el original en Word y en Excel: los convierte a PDF para el visor y conserva el original con su huella', async () => {
    const row = (n: number, values: SgcMasterListRawRow['values']): SgcMasterListRawRow => ({ rowNumber: n, values });
    await confirmMasterListImport(prisma, CO, { fileName: 'listado-s16.xlsx', rows: [row(2, { code: 'OLP-GC-07', title: 'Procedimiento de limpieza', documentTypeCode: 'PR', processCode: 'GC', versionNumber: '2', effectiveDate: '2024-05-01' }), row(3, { code: 'OLP-GC-07-FO01', title: 'Registro de limpieza', documentTypeCode: 'FO', processCode: 'GC', versionNumber: '1', effectiveDate: '2024-05-01' })] }, actor(E.cal));
    const { idBulkUpload } = await startBulkUpload(prisma, CO, { filesTotal: 3 }, actor(E.cal));
    const noConvert = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-07 Procedimiento de limpieza.docx', bytes: docxBytes }, actor(E.cal));
    expect(noConvert).toMatchObject({ status: 'error', error: expect.stringContaining('conversión') });
    const word = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-07 Procedimiento de limpieza.docx', bytes: docxBytes }, actor(E.cal), new Date(), convert);
    expect(word).toMatchObject({ status: 'cargado', code: 'OLP-GC-07' });
    const excelBytes = await xlsx();
    const excel = await uploadBulkFile(prisma, upload, CO, idBulkUpload, { fileName: 'OLP-GC-07-FO01 Registro de limpieza.xlsx', bytes: excelBytes }, actor(E.cal), new Date(), convert);
    expect(excel).toMatchObject({ status: 'cargado', code: 'OLP-GC-07-FO01' });
    const v = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: excel.idVersion! } });
    expect(v.source_file_name).toBe('OLP-GC-07-FO01 V1.xlsx');
    expect(v.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get(v.source_item_id!)).toEqual(excelBytes);
    expect(v.pdf_sha256).not.toBe(v.source_sha256);
    expect(names.get(v.pdf_item_id)).toBe('OLP-GC-07-FO01 V1.pdf');
    const items = await prisma.sgcBulkUploadItem.findMany({ where: { id_bulk_upload: idBulkUpload }, orderBy: { id_bulk_upload_item: 'asc' } });
    expect(items.map((i) => [i.status, i.source_kind])).toEqual([
      ['error', 'docx'],
      ['cargado', 'docx'],
      ['cargado', 'xlsx'],
    ]);
    expect(await prisma.sgcDocument.count({ where: { id_company: CO, code: { in: ['OLP-GC-07', 'OLP-GC-07-FO01'] }, status: 'vigente' } })).toBe(2);
  });
});
