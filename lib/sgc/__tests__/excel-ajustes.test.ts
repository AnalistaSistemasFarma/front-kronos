import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  columnIndex,
  columnLetter,
  describeSheetSettings,
  isDefaultSheetSettings,
  normalizePrintArea,
  normalizeSheetSettings,
  normalizeTitleRows,
  SGC_DEFAULT_SHEET_SETTINGS,
} from '../sheetSettings';
import { inspectXlsx, xlsxToSheet } from '../pdf/viewable';
import { sheetZoomCss, wrapDraftForPdf } from '../pdf/render';
import { buildSheetPreviewLines, stampSheetPreview } from '../watermark';
import { inspectBulkExcel, previewBulkExcel } from '../db/bulkUpload';

/**
 * 2026-10-21 (reunión con Calidad OLP, visto bueno de Nicolás Rivera): en la
 * carga inicial, un Excel se puede previsualizar y ajustar antes de
 * publicarlo. Solo la presentación (orientación, tamaño, área de impresión,
 * filas de título, hojas y columnas que salen): el texto nunca cambia.
 */

async function workbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Registro');
  ws.pageSetup.orientation = 'landscape';
  ws.pageSetup.printTitlesRow = '1:1';
  for (let c = 1; c <= 4; c++) ws.getColumn(c).width = 15;
  ws.getColumn(4).hidden = true;
  ['Fecha', 'Producto', 'Auxiliar', 'Oculta'].forEach((v, i) => (ws.getRow(1).getCell(i + 1).value = v));
  for (let r = 2; r <= 20; r++) ws.getRow(r).getCell(1).value = `2026-10-${String(r).padStart(2, '0')}`;
  wb.addWorksheet('Ayuda').getCell('A1').value = 'Instrucciones de diligenciamiento';
  const hidden = wb.addWorksheet('Oculta');
  hidden.state = 'hidden';
  hidden.getCell('A1').value = 'no sale';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('SGC · ajustes de presentación del Excel (2026-10-21)', () => {
  it('[SGC-REQ-165] columnas por letra y validación de área de impresión y filas de título', () => {
    expect([columnIndex('A'), columnIndex('Z'), columnIndex('AB'), columnIndex('XFD')]).toEqual([1, 26, 28, 16384]);
    expect([columnLetter(1), columnLetter(26), columnLetter(28), columnLetter(16384)]).toEqual(['A', 'Z', 'AB', 'XFD']);
    expect(normalizePrintArea(' h40 : $a$1 ', 'R')).toBe('A1:H40');
    expect(normalizePrintArea('', 'R')).toBeNull();
    expect(() => normalizePrintArea('A1-H40', 'R')).toThrow(/A1:H40/);
    expect(() => normalizePrintArea('ZZZZ1:A2', 'R')).toThrow(/inválida/);
    expect(() => normalizePrintArea('XFE1:A2', 'R')).toThrow(/columna no existe/);
    expect(normalizeTitleRows('3:1', 'R')).toBe('1:3');
    expect(normalizeTitleRows('2', 'R')).toBe('2:2');
    expect(normalizeTitleRows(null, 'R')).toBeNull();
    expect(() => normalizeTitleRows('1:40', 'R')).toThrow(/máximo 30/);
    expect(() => normalizeTitleRows('A:B', 'R')).toThrow(/1:3/);
  });

  it('[SGC-REQ-165] normaliza los ajustes del navegador y rechaza lo que no es presentación', () => {
    expect(normalizeSheetSettings(undefined)).toEqual(SGC_DEFAULT_SHEET_SETTINGS);
    expect(normalizeSheetSettings('')).toEqual(SGC_DEFAULT_SHEET_SETTINGS);
    const s = normalizeSheetSettings(JSON.stringify({ orientation: 'horizontal', fit: 'escala', scalePct: 80, sheets: [{ name: ' Registro ', printArea: 'a1:c20', titleRows: '1', hiddenColumns: ['c', 'C', 'b'] }, { name: 'Ayuda', include: false }] }));
    expect(s).toEqual({
      orientation: 'horizontal',
      fit: 'escala',
      scalePct: 80,
      sheets: [
        { name: 'Registro', include: true, printArea: 'A1:C20', titleRows: '1:1', hiddenColumns: ['B', 'C'] },
        { name: 'Ayuda', include: false, printArea: null, titleRows: null, hiddenColumns: [] },
      ],
    });
    expect(normalizeSheetSettings({ fit: 'ancho', scalePct: 80 }).scalePct).toBeNull();
    expect(() => normalizeSheetSettings('{malo')).toThrow(/no son válidos/);
    expect(() => normalizeSheetSettings('x'.repeat(20_001))).toThrow(/largos/);
    expect(() => normalizeSheetSettings([])).toThrow(/no son válidos/);
    expect(() => normalizeSheetSettings({ orientation: 'diagonal' })).toThrow(/Orientación/);
    expect(() => normalizeSheetSettings({ fit: 'otro' })).toThrow(/tamaño/);
    expect(() => normalizeSheetSettings({ fit: 'escala', scalePct: 10 })).toThrow(/25 % a 150 %/);
    expect(() => normalizeSheetSettings({ fit: 'escala', scalePct: 80.5 })).toThrow(/25 % a 150 %/);
    expect(() => normalizeSheetSettings({ sheets: [{ name: '' }] })).toThrow(/nombre/);
    expect(() => normalizeSheetSettings({ sheets: [{ name: 'A' }, { name: 'A' }] })).toThrow(/repetida/);
    expect(() => normalizeSheetSettings({ sheets: [{ name: 'A', hiddenColumns: ['1'] }] })).toThrow(/letras/);
    // No hay forma de cambiar el texto: cualquier otro campo se ignora.
    expect(normalizeSheetSettings({ sheets: [{ name: 'A', cells: { A1: 'otro texto' } }] }).sheets[0]).toEqual({ name: 'A', include: true, printArea: null, titleRows: null, hiddenColumns: [] });
  });

  it('[SGC-REQ-165] describe los ajustes en prosa (descripción de la versión y auditoría)', () => {
    expect(isDefaultSheetSettings(normalizeSheetSettings({ sheets: [{ name: 'A' }] }))).toBe(true);
    expect(describeSheetSettings(SGC_DEFAULT_SHEET_SETTINGS)).toBe('ajuste automático');
    const s = normalizeSheetSettings({ orientation: 'vertical', fit: 'real', sheets: [{ name: 'Registro', printArea: 'A1:C20', titleRows: '1:2', hiddenColumns: ['C'] }, { name: 'Ayuda', include: false }] });
    expect(isDefaultSheetSettings(s)).toBe(false);
    expect(describeSheetSettings(s)).toBe('hoja vertical; tamaño real; «Registro»: área A1:C20, títulos 1:2, sin columnas C; sin la hoja «Ayuda»');
  });

  it('[SGC-REQ-165] la inspección da la grilla de cada hoja visible (rango, columnas con su letra, primeras filas)', async () => {
    const sheets = await inspectXlsx(await workbook());
    expect(sheets.map((x) => x.name)).toEqual(['Registro', 'Ayuda']);
    const r = sheets[0];
    expect(r).toMatchObject({ range: 'A1:D20', excelPrintArea: null, excelTitleRows: '1:1', excelOrientation: 'horizontal', rows: 20 });
    expect(r.columns.map((c) => [c.letter, c.hiddenInExcel, c.sample])).toEqual([
      ['A', false, 'Fecha'],
      ['B', false, 'Producto'],
      ['C', false, 'Auxiliar'],
      ['D', true, 'Oculta'],
    ]);
    expect(r.preview).toHaveLength(12);
    expect(r.preview[0]).toEqual(['Fecha', 'Producto', 'Auxiliar', 'Oculta']);
    expect(sheets[1]).toMatchObject({ range: 'A1:A1', excelOrientation: 'vertical' });
  });

  it('[SGC-REQ-165] la conversión respeta la hoja que no sale, el área, las filas de título y las columnas quitadas', async () => {
    const auto = await xlsxToSheet(await workbook());
    expect(auto.html).toContain('Instrucciones de diligenciamiento');
    expect(auto.html).toContain('Auxiliar');
    expect(auto.html).not.toContain('>Oculta<');
    expect(auto.layout).toMatchObject({ orientation: 'auto', fit: 'ancho', scalePct: null });
    const s = normalizeSheetSettings({ orientation: 'vertical', fit: 'escala', scalePct: 90, sheets: [{ name: 'Registro', printArea: 'A1:C5', titleRows: '1:2', hiddenColumns: ['C'] }, { name: 'Ayuda', include: false }] });
    const adj = await xlsxToSheet(await workbook(), s);
    expect(adj.html).not.toContain('Instrucciones de diligenciamiento');
    expect(adj.html).not.toContain('Auxiliar');
    expect(adj.html).toContain('2026-10-05');
    expect(adj.html).not.toContain('2026-10-06');
    expect(adj.html).toMatch(/<thead><tr>.*Fecha.*<\/tr><tr>.*2026-10-02.*<\/tr><\/thead>/);
    expect(adj.layout).toMatchObject({ orientation: 'vertical', fit: 'escala', scalePct: 90 });
    expect(adj.layout.tables).toHaveLength(1);
  });

  it('[SGC-REQ-165] la página: orientación forzada, tamaño real o escala fija', async () => {
    const t = [{ cls: 'sgc-t-0', widthPt: 1000 }];
    expect(sheetZoomCss({ landscape: true, tables: t, fit: 'real' }, 500)).toBe('');
    expect(sheetZoomCss({ landscape: true, tables: t, fit: 'escala', scalePct: 60 }, 500)).toBe('table.sgc-t-0{zoom:0.6}');
    expect(sheetZoomCss({ landscape: true, tables: t, fit: 'escala', scalePct: 500 }, 500)).toBe('');
    expect(sheetZoomCss({ landscape: true, tables: t, fit: 'ancho' }, 500)).toBe('table.sgc-t-0{zoom:0.5}');
    const page = (layout: Parameters<typeof sheetZoomCss>[0], institutional = false) => wrapDraftForPdf({ title: 'F', code: 'C', contentHtml: '<p>x</p>', sheet: true, sheetLayout: layout, institutional });
    expect(page({ landscape: true, tables: [], orientation: 'vertical' })).toContain('@page { size: A4; margin: 1.5cm 1.2cm; }');
    expect(page({ landscape: false, tables: [], orientation: 'horizontal' })).toContain('size: A4 landscape');
    expect(page({ landscape: true, tables: [], orientation: 'auto' })).toContain('size: A4 landscape');
    // Con encabezado institucional sigue vertical (encabezado y firmas calculados para vertical).
    expect(page({ landscape: false, tables: [], orientation: 'horizontal' }, true)).not.toContain('landscape');
  });

  it('[SGC-REQ-165] la vista previa lleva la marca «VISTA PREVIA» y quién la generó', async () => {
    const lines = buildSheetPreviewLines({ fileName: 'OLP-GC-07-FO01.xlsx', viewerEmail: 'calidad@onelatampharma.com', at: new Date('2026-10-21T20:00:00Z') });
    expect(lines.diagonal).toBe('VISTA PREVIA');
    expect(lines.footer).toContain('NO ES UNA COPIA CONTROLADA');
    expect(lines.footer).toContain('calidad@onelatampharma.com');
    expect(lines.footer).toContain('2026-10-21 15:00');
    const base = await PDFDocument.create();
    base.addPage([841.89, 595.28]).drawText('x', { x: 10, y: 10, size: 10, font: await base.embedFont(StandardFonts.Helvetica) });
    const out = await PDFDocument.load(await stampSheetPreview(await base.save(), { fileName: 'a.xlsx', viewerEmail: 'c@x.com', at: new Date() }), { updateMetadata: false });
    expect(out.getProducer()).toContain('vista previa');
    expect(out.getPageCount()).toBe(1);
  });

  it('[SGC-REQ-165] inspeccionar y previsualizar exigen la carga inicial abierta y un Excel válido, y no guardan nada', async () => {
    const calls: string[] = [];
    const db = (open: boolean) =>
      ({
        sgcCompanyConfig: { findUnique: async () => ({ is_active: true, initial_load_open: open }) },
        sgcDocument: {
          findMany: async () => [{ id_document: 7, code: 'OLP-GC-07-FO01', title: 'Registro', status: 'pendiente_archivo' }],
          update: async () => calls.push('update'),
          updateMany: async () => calls.push('updateMany'),
        },
      }) as never;
    const bytes = await workbook();
    const file = { fileName: 'OLP-GC-07-FO01 Registro.xlsx', bytes };
    await expect(inspectBulkExcel(db(false), 3, file)).rejects.toThrow(/cerrada/);
    await expect(inspectBulkExcel(db(true), 3, { ...file, fileName: 'OLP-GC-07-FO01.pdf' })).rejects.toMatchObject({ status: 415 });
    await expect(inspectBulkExcel(db(true), 3, { ...file, bytes: new TextEncoder().encode('no es un excel') })).rejects.toMatchObject({ status: 415 });
    expect((await inspectBulkExcel(db(true), 3, file)).sheets).toHaveLength(2);
    const htmls: string[] = [];
    const base = await PDFDocument.create();
    base.addPage([595.28, 841.89]);
    const baseBytes = await base.save();
    const convert = { docxToHtml: async () => '', htmlToPdf: async (html: string) => (htmls.push(html), baseBytes) };
    const actor = { email: 'Calidad@OneLatamPharma.com', ip: '10.0.0.1', userAgent: 'vitest' };
    const pdf = await previewBulkExcel(db(true), 3, file, JSON.stringify({ orientation: 'horizontal', sheets: [{ name: 'Ayuda', include: false }] }), actor, convert);
    expect((await PDFDocument.load(pdf, { updateMetadata: false })).getProducer()).toContain('vista previa');
    expect(htmls[0]).toContain('size: A4 landscape');
    expect(htmls[0]).not.toContain('Instrucciones de diligenciamiento');
    await expect(previewBulkExcel(db(true), 3, file, JSON.stringify({ sheets: [{ name: 'Inventada' }] }), actor, convert)).rejects.toThrow(/Inventada/);
    await expect(previewBulkExcel(db(true), 3, file, '{malo', actor, convert)).rejects.toThrow(/no son válidos/);
    await expect(previewBulkExcel(db(true), 3, file, JSON.stringify({ sheets: [{ name: 'Registro', include: false }, { name: 'Ayuda', include: false }] }), actor, convert)).rejects.toThrow(/al menos una hoja/);
    const failing = { docxToHtml: async () => '', htmlToPdf: async () => Promise.reject(new Error('chrome caído')) };
    await expect(previewBulkExcel(db(true), 3, file, null, actor, failing)).rejects.toMatchObject({ status: 422 });
    expect(calls).toEqual([]);
  });
});
