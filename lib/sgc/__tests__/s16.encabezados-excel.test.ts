import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { bulkKindOf, matchBulkFile } from '../bulkUpload';
import { draftFormatOf, getDraftForSubmitError } from '../draft/current';
import { sanitizeDraftHtml } from '../draft/html';
import { summarizeCurrentDraft } from '../draft/view';
import {
  SGC_DEFAULT_HEADER_TEMPLATE,
  describeHeaderTemplateChanges,
  draftFormatsFor,
  headerBottomText,
  normalizeDraftExtensions,
  normalizeHeaderTemplateCode,
  normalizeHeaderTemplateConfig,
  parseDraftExtensions,
  parseHeaderTemplateConfig,
  resolveHeaderTemplate,
} from '../headerTemplates';
import { drawInstitutionalHeaders, type SgcInstitutionalHeaderData } from '../pdf/institutional';
import { wrapDraftForPdf } from '../pdf/render';
import { cellClasses, parseMerges, xlsxToHtml, xlsxToSheet } from '../pdf/viewable';
import { justPlaced, nextOrderWithoutBox } from '../signature/fields';

/**
 * S16 (plan sgc-plan-sprints-requerimientos-2026-10-13): R31 encabezado por
 * tipo documental (D20: una plantilla por defecto y las demás por tipo), R32
 * formatos en Excel (D17: el visor muestra el Excel, nunca se convierte a
 * Word), R33 carga de lo ya aprobado en Word y Excel y R35 ubicar firmas con
 * un área más grande y menos clics (D22: el mismo cambio en SynerLink).
 */

const root = join(__dirname, '../../..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

async function pdfText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  return (tc.items as { str: string }[]).map((i) => i.str).join(' ');
}

const header = (over: Partial<SgcInstitutionalHeaderData> = {}): SgcInstitutionalHeaderData => ({
  company: 'ONE LATAM PHARMA',
  title: 'Formato de recepción de mercancía',
  code: 'OLP-GC-02-FO01',
  versionLabel: '2',
  process: 'GC · Gestión de calidad',
  documentType: 'Formato',
  elaboro: ['Ana'],
  reviso: ['Luis'],
  aprobo: ['Marta'],
  emissionText: 'Al quedar vigente',
  logo: null,
  ...over,
});

async function workbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Registro');
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 12;
  ws.mergeCells('A1:C1');
  const title = ws.getCell('A1');
  title.value = 'REGISTRO DE RECEPCIÓN';
  title.font = { bold: true, color: { argb: 'FF1F4E79' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
  ws.getCell('A2').value = 'Producto';
  ws.getCell('B2').value = 'Lote';
  ws.getCell('C2').value = 'Cantidad';
  for (const c of ['A2', 'B2', 'C2']) ws.getCell(c).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  ws.getCell('A3').value = '<script>x</script> & lote';
  ws.getRow(5).getCell(1).border = { bottom: { style: 'thin' } }; // fila en blanco para diligenciar
  const hidden = wb.addWorksheet('Oculta');
  hidden.state = 'hidden';
  hidden.getCell('A1').value = 'no se muestra';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('SGC · S16 · plantillas de encabezado por tipo (R31, D20)', () => {
  it('[SGC-REQ-163] la plantilla normaliza rótulos (mayúsculas), valida la fila inferior y la leyenda, y por defecto es el encabezado institucional', () => {
    expect(normalizeHeaderTemplateConfig({})).toEqual(SGC_DEFAULT_HEADER_TEMPLATE);
    const c = normalizeHeaderTemplateConfig({ titleLabel: ' nombre del formato ', bottomRow: 'leyenda', legend: '  Prohibida su reproducción  ' });
    expect(c).toMatchObject({ titleLabel: 'NOMBRE DEL FORMATO', bottomRow: 'leyenda', legend: 'Prohibida su reproducción', codeLabel: 'CÓDIGO' });
    expect(() => normalizeHeaderTemplateConfig({ bottomRow: 'otra' })).toThrow(/no permitida/);
    expect(() => normalizeHeaderTemplateConfig({ bottomRow: 'leyenda' })).toThrow(/leyenda/);
    expect(() => normalizeHeaderTemplateConfig({ titleLabel: 'x'.repeat(41) })).toThrow(/máximo 40/);
    expect(() => normalizeHeaderTemplateConfig({ legend: 'x'.repeat(161) })).toThrow(/máximo 160/);
    expect(parseHeaderTemplateConfig('no-json')).toEqual(SGC_DEFAULT_HEADER_TEMPLATE);
    expect(normalizeHeaderTemplateCode(' formato ')).toBe('FORMATO');
    expect(() => normalizeHeaderTemplateCode('1x')).toThrow(/Código/);
    expect(headerBottomText(SGC_DEFAULT_HEADER_TEMPLATE, { process: 'GC', documentType: 'Formato' })).toBe('PROCESO: GC    ·    TIPO DOCUMENTAL: Formato');
    expect(headerBottomText({ bottomRow: 'proceso', legend: 'Uso interno' }, { process: 'GC', documentType: 'Formato' })).toBe('PROCESO: GC    ·    Uso interno');
    expect(headerBottomText({ bottomRow: 'tipo', legend: null }, { process: 'GC', documentType: 'Formato' })).toBe('TIPO DOCUMENTAL: Formato');
    expect(headerBottomText({ bottomRow: 'leyenda', legend: 'Copia controlada' }, { process: 'GC', documentType: 'Formato' })).toBe('Copia controlada');
    expect(describeHeaderTemplateChanges(null, c)).toEqual(['Plantilla creada.']);
    expect(describeHeaderTemplateChanges(SGC_DEFAULT_HEADER_TEMPLATE, c)).toEqual(expect.arrayContaining(['titleLabel: «NOMBRE DEL DOCUMENTO» → «NOMBRE DEL FORMATO»']));
    expect(describeHeaderTemplateChanges(c, c)).toEqual(['Sin cambios en la plantilla.']);
  });

  it('[SGC-REQ-163] un tipo usa su plantilla activa; si no, la por defecto; si no hay, el encabezado institucional', () => {
    const list = [
      { id: 1, isActive: true, isDefault: true },
      { id: 2, isActive: true, isDefault: false },
      { id: 3, isActive: false, isDefault: false },
    ];
    expect(resolveHeaderTemplate(list, 2)?.id).toBe(2);
    expect(resolveHeaderTemplate(list, 3)?.id).toBe(1);
    expect(resolveHeaderTemplate(list, null)?.id).toBe(1);
    expect(resolveHeaderTemplate([], null)).toBeNull();
  });

  it('[SGC-REQ-163] el encabezado se dibuja con los rótulos y la fila inferior de la plantilla (misma geometría)', async () => {
    const pdf = await PDFDocument.create();
    const pages = [pdf.addPage([595.28, 841.89]), pdf.addPage([595.28, 841.89])];
    const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
    const tpl = normalizeHeaderTemplateConfig({ titleLabel: 'Nombre del formato', codeLabel: 'Cód.', bottomRow: 'leyenda', legend: 'Formato controlado por Calidad' });
    const drawn = await drawInstitutionalHeaders(pdf, pages, header({ template: tpl }), fonts);
    expect(drawn.emission).not.toBeNull();
    const bytes = await pdf.save();
    const first = await pdfText(bytes, 1);
    expect(first).toContain('NOMBRE DEL FORMATO');
    expect(first).toContain('CÓD.: OLP-GC-02-FO01');
    expect(first).toContain('Formato controlado por Calidad');
    expect(first).not.toContain('TIPO DOCUMENTAL:');
    expect(await pdfText(bytes, 2)).toContain('CÓD.: OLP-GC-02-FO01 · VERSIÓN: 2');
    // Sin plantilla: el de siempre.
    const plain = await PDFDocument.create();
    const pp = [plain.addPage([595.28, 841.89])];
    await drawInstitutionalHeaders(plain, pp, header(), { regular: await plain.embedFont(StandardFonts.Helvetica), bold: await plain.embedFont(StandardFonts.HelveticaBold) });
    const t = await pdfText(await plain.save(), 1);
    expect(t).toContain('NOMBRE DEL DOCUMENTO');
    expect(t).toContain('PROCESO: GC · Gestión de calidad');
  });
});

describe('SGC · S16 · formatos en Excel (R32, D17)', () => {
  it('[SGC-REQ-164] formatos del borrador por tipo: por defecto solo Word; «Formato» con Excel; el PDF solo sin encabezado obligatorio', () => {
    expect(parseDraftExtensions(null)).toEqual(['docx']);
    expect(parseDraftExtensions('docx,xlsx')).toEqual(['docx', 'xlsx']);
    expect(parseDraftExtensions(' .XLSX ')).toEqual(['xlsx']);
    expect(normalizeDraftExtensions(['docx'])).toBeNull();
    expect(normalizeDraftExtensions('xlsx, docx')).toBe('docx,xlsx');
    expect(normalizeDraftExtensions([])).toBeNull();
    expect(() => normalizeDraftExtensions(['pdf'])).toThrow(/no admitido/);
    expect(draftFormatsFor(null, true)).toEqual(['docx', 'doc']);
    expect(draftFormatsFor('docx,xlsx', true)).toEqual(['docx', 'doc', 'xlsx']);
    expect(draftFormatsFor('xlsx', false)).toEqual(['xlsx', 'pdf']);
    expect(draftFormatOf('Registro.XLSX')).toBe('xlsx');
    expect(getDraftForSubmitError(null)).toMatch(/Excel/);
    expect(summarizeCurrentDraft({ kind: 'borrador_adjunto', ref: 'adjunto:1', name: 'R.xlsx', sha256: 'a'.repeat(64), format: 'xlsx', at: '2026-10-14T10:00:00.000Z' }, [], [])!.origin).toBe('Archivo Excel cargado');
  });

  it('[SGC-REQ-164] el Excel se muestra como tablas FIELES (combinadas, anchos, negrita, relleno, bordes, filas en blanco) sin pasar por Word; las hojas ocultas no salen', async () => {
    const { html, css } = await xlsxToSheet(await workbook());
    expect(html).toContain('<h2 class="sgc-hoja-nombre">Registro</h2>');
    expect(html).not.toContain('Oculta');
    expect(html).toMatch(/<td colspan="3" class="sgc-b sgc-fc-1f4e79 sgc-al-c sgc-va-m sgc-bg-ddebf7 sgc-w-30">REGISTRO DE RECEPCIÓN<\/td>/);
    expect(html).toContain('class="sgc-bt sgc-bl sgc-bb sgc-br"');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; lote');
    expect(html).toContain('<tr class="sgc-vacia">');
    expect(css).toContain('.sgc-bg-ddebf7{background:#ddebf7}');
    expect(css).toContain('.sgc-fc-1f4e79{color:#1f4e79}');
    expect(css).toContain('.sgc-w-30{width:30ch;min-width:18ch}');
    expect(await xlsxToHtml(await workbook())).toBe(html);
    // El sanitizador conserva solo las clases «sgc-…» (y colspan/rowspan); nada más.
    const clean = sanitizeDraftHtml(html);
    expect(clean).toContain('colspan="3" class="sgc-b sgc-fc-1f4e79 sgc-al-c sgc-va-m sgc-bg-ddebf7 sgc-w-30"');
    expect(sanitizeDraftHtml('<td class="evil" onclick="x()">a</td>')).toBe('<td>a</td>');
    expect(sanitizeDraftHtml('<td class="sgc-b otra">a</td>')).toBe('<td>a</td>');
    expect(sanitizeDraftHtml('<p class="sgc-b">a</p>')).toBe('<p>a</p>');
    // La hoja de estilos solo admite reglas «.sgc-…» sin url(, < ni @.
    const page = wrapDraftForPdf({ title: 'F', code: 'C', contentHtml: clean, sheet: true, extraCss: `${css}\n.sgc-x{background:url(http://mal)}\n.sgc-y{color:red}</style><script>` });
    expect(page).toContain('.sgc-bg-ddebf7{background:#ddebf7}');
    expect(page).not.toContain('.sgc-y{color:red}');
    expect(page).not.toContain('url(http://mal)');
    expect(page).not.toContain('<script>');
  });

  it('[SGC-REQ-164] combinaciones y clases de celda (piezas puras)', () => {
    const m = parseMerges(['A1:C2', 'B4:B5', 'malo']);
    expect(m.spans.get('1,1')).toEqual({ rowspan: 2, colspan: 3 });
    expect(m.spans.get('4,2')).toEqual({ rowspan: 2, colspan: 1 });
    expect([...m.covered].sort()).toEqual(['1,2', '1,3', '2,1', '2,2', '2,3', '5,2'].sort());
    const rules = new Map<string, string>();
    expect(cellClasses({ font: { italic: true, underline: 'single', color: { argb: 'FF000000' } }, alignment: { horizontal: 'right', vertical: 'bottom' }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } }, rules)).toEqual(['sgc-i', 'sgc-u', 'sgc-al-r', 'sgc-va-b']);
    expect(cellClasses({ font: { color: { argb: 'zz' } }, fill: { type: 'gradient' } }, rules)).toEqual([]);
    expect(rules.size).toBe(0);
  });
});

describe('SGC · S16 · carga de lo ya aprobado en Word y Excel (R33)', () => {
  const docs = [{ idDocument: 1, code: 'OLP-GC-02-FO01', title: 'Formato de recepción', status: 'pendiente_archivo' }];
  it('[SGC-REQ-165] la carga masiva acepta PDF, Word y Excel (empareja por el código) y rechaza otros formatos', () => {
    expect(bulkKindOf('a.PDF')).toBe('pdf');
    expect(bulkKindOf('a.docx')).toBe('docx');
    expect(bulkKindOf('a.xlsx')).toBe('xlsx');
    expect(bulkKindOf('a.xls')).toBeNull();
    expect(matchBulkFile('OLP-GC-02-FO01 Formato de recepción.xlsx', docs)).toMatchObject({ status: 'cargable', idDocument: 1 });
    expect(matchBulkFile('OLP-GC-02-FO01.docx', docs)).toMatchObject({ status: 'cargable' });
    expect(matchBulkFile('OLP-GC-02-FO01.xls', docs)).toMatchObject({ status: 'error', error: expect.stringContaining('Excel (.xlsx)') });
  });
});

describe('SGC · S16 · ubicar firmas: área más grande y menos clics (R35, D22)', () => {
  it('[SGC-REQ-166] al ubicar la caja de una persona se pasa a la siguiente sin caja (en orden, dando la vuelta)', () => {
    const f = (o: number) => ({ signerOrder: o });
    expect(nextOrderWithoutBox([1, 2, 3], [f(1)], 1)).toBe(2);
    expect(nextOrderWithoutBox([1, 2, 3], [f(1), f(2)], 2)).toBe(3);
    expect(nextOrderWithoutBox([1, 2, 3], [f(3), f(2)], 3)).toBe(1);
    expect(nextOrderWithoutBox([1, 2, 3], [f(1), f(2), f(3)], 2)).toBe(2);
    expect(justPlaced([], [f(1)], 1)).toBe(true);
    expect(justPlaced([f(1)], [f(1)], 1)).toBe(false);
    expect(justPlaced([], [f(2)], 1)).toBe(false);
  });

  it('[SGC-REQ-166] D22: la página del lienzo crece a 1.000 px en el SGC Y en SynerLink (misma copia; la prueba de paridad sigue igual)', () => {
    for (const p of ['components/sgc/signature/SgcSignaturePlacementCanvas.tsx', 'components/orion/SignaturePlacementCanvas.tsx']) {
      expect(src(p)).toMatch(/const PAGE_BASE_WIDTH = 1000;/);
    }
    expect(src('components/sgc/signature/SgcDocumentLayoutModal.tsx')).toContain('nextOrderWithoutBox');
  });
});
