import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { fitPdfIntoInstitutionalPages, microsoftCanApply, pdfIsA4, pdfPageCount, prepareXlsxForMicrosoft, xlsxPrintsLandscape } from '../pdf/officePdf';
import { normalizeSheetSettings } from '../sheetSettings';
import { attachmentToViewablePdf } from '../pdf/viewable';

/**
 * 2026-10-22 (Calidad OLP: «los formatos en Excel aún no salen bien»): el
 * Excel lo convierte MICROSOFT (Graph, motor de Excel Online). Antes se toca
 * solo la configuración de página de una copia («ajustar a 1 página de
 * ancho», o la orientación y el tamaño elegidos); con encabezado
 * institucional, cada página de Microsoft va a escala bajo el encabezado.
 */

async function book(opts: { landscape?: boolean; fit?: boolean; scale?: number } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formato');
  if (opts.landscape) ws.pageSetup.orientation = 'landscape';
  if (opts.fit) ws.pageSetup.fitToPage = true;
  if (opts.scale) ws.pageSetup.scale = opts.scale;
  ws.getCell('A1').value = 'REGISTRO';
  wb.addWorksheet('Oculta', { state: 'hidden' }).getCell('A1').value = 'x';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function sheetXml(bytes: Uint8Array, n = 1): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file(`xl/worksheets/sheet${n}.xml`)!.async('string');
}

async function pdf(pages: [number, number][], blank = false): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (const p of pages) {
    const page = d.addPage(p);
    if (!blank) page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  }
  return d.save();
}

describe('SGC · conversión de Excel con Microsoft (2026-10-22)', () => {
  it('[SGC-REQ-164] sin ajustes: la copia queda «ajustar a 1 página de ancho», salvo que el Excel ya tenga «Ajustar a» o una escala propia', async () => {
    const xml = await sheetXml(await prepareXlsxForMicrosoft(await book(), null));
    expect(xml).toMatch(/<pageSetUpPr fitToPage="1"\/>/);
    expect(xml).toMatch(/<pageSetup[^>]*fitToWidth="1"[^>]*fitToHeight="0"/);
    expect(xml).not.toMatch(/<pageSetup[^>]*\sscale=/);
    // Lo demás del libro no cambia (mismas partes del ZIP).
    const before = Object.keys((await JSZip.loadAsync(await book())).files).sort();
    expect(Object.keys((await JSZip.loadAsync(await prepareXlsxForMicrosoft(await book(), null))).files).sort()).toEqual(before);
    // Ya trae «Ajustar a» o una escala propia: se respeta tal cual (mismos bytes).
    const fit = await book({ fit: true });
    expect(await sheetXml(await prepareXlsxForMicrosoft(fit, null))).toBe(await sheetXml(fit));
    const scaled = await book({ scale: 70 });
    expect(await sheetXml(await prepareXlsxForMicrosoft(scaled, null))).toMatch(/scale="70"/);
  });

  it('[SGC-REQ-164] con ajustes: orientación, tamaño real o escala en la configuración de página; el resto de ajustes va por SynerLink', async () => {
    const h = await sheetXml(await prepareXlsxForMicrosoft(await book(), normalizeSheetSettings({ orientation: 'horizontal' })));
    expect(h).toMatch(/orientation="landscape"/);
    expect(h).toMatch(/fitToPage="1"/);
    const v = await sheetXml(await prepareXlsxForMicrosoft(await book({ landscape: true }), normalizeSheetSettings({ orientation: 'vertical', fit: 'escala', scalePct: 80 })));
    expect(v).toMatch(/orientation="portrait"/);
    expect(v).toMatch(/scale="80"/);
    expect(v).toMatch(/fitToPage="0"/);
    expect(v).not.toMatch(/fitToWidth=/);
    const real = await sheetXml(await prepareXlsxForMicrosoft(await book({ fit: true }), normalizeSheetSettings({ fit: 'real' })));
    expect(real).toMatch(/scale="100"/);
    expect(real).toMatch(/fitToPage="0"/);
    expect(microsoftCanApply(null)).toBe(true);
    expect(microsoftCanApply(normalizeSheetSettings({ orientation: 'horizontal', fit: 'escala', scalePct: 60, sheets: [{ name: 'Formato' }] }))).toBe(true);
    expect(microsoftCanApply(normalizeSheetSettings({ sheets: [{ name: 'Formato', printArea: 'A1:B2' }] }))).toBe(false);
    expect(microsoftCanApply(normalizeSheetSettings({ sheets: [{ name: 'Formato', hiddenColumns: ['B'] }] }))).toBe(false);
    expect(microsoftCanApply(normalizeSheetSettings({ sheets: [{ name: 'Formato', titleRows: '1:2' }] }))).toBe(false);
    expect(microsoftCanApply(normalizeSheetSettings({ sheets: [{ name: 'Formato', include: false }, { name: 'Otra' }] }))).toBe(false);
  });

  it('[SGC-REQ-164] con encabezado institucional: hoja A4, espacio arriba para el encabezado y sin el encabezado o pie propios del Excel', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Formato');
    ws.getCell('A1').value = 'REGISTRO';
    ws.headerFooter.oddHeader = '&LCódigo propio del Excel';
    const xml = await sheetXml(await prepareXlsxForMicrosoft(new Uint8Array(await wb.xlsx.writeBuffer()), null, { institutional: true }));
    expect(xml).toMatch(/<pageMargins left="0.787" right="0.787" top="2.598" bottom="0.866" header="0" footer="0"\/>/);
    expect(xml).toMatch(/<pageSetup[^>]*paperSize="9"/);
    expect(xml).toMatch(/fitToPage="1"/);
    expect(xml).not.toContain('headerFooter');
    expect(xml).not.toContain('Código propio del Excel');
    // ¿Microsoft respetó la hoja A4? Entonces se usa tal cual; si no, cada página a escala.
    expect(await pdfIsA4(await pdf([[841.92, 595.32], [841.92, 595.32]]), true)).toBe(true);
    expect(await pdfIsA4(await pdf([[792, 612]]), true)).toBe(false);
    expect(await pdfIsA4(await pdf([[595.32, 841.92]]), true)).toBe(false);
  });

  it('[SGC-REQ-164] la orientación del documento es la que el Excel tiene para imprimir (primera hoja visible)', async () => {
    expect(await xlsxPrintsLandscape(await book({ landscape: true }))).toBe(true);
    expect(await xlsxPrintsLandscape(await book())).toBe(false);
    expect(await xlsxPrintsLandscape(new TextEncoder().encode('no es un excel'))).toBe(false);
  });

  it('[SGC-REQ-164] con encabezado institucional, cada página de Microsoft va a escala bajo el encabezado, en A4', async () => {
    const out = await PDFDocument.load(await fitPdfIntoInstitutionalPages(await pdf([[792, 612], [792, 612]]), true));
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getSize()).toEqual({ width: 841.89, height: 595.28 });
    const portrait = await PDFDocument.load(await fitPdfIntoInstitutionalPages(await pdf([[612, 792]]), false));
    expect(portrait.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(await pdfPageCount(await pdf([[10, 10], [10, 10], [10, 10]]))).toBe(3);
    // Una página en blanco (sin contenido) no rompe: queda en blanco.
    expect((await PDFDocument.load(await fitPdfIntoInstitutionalPages(await pdf([[612, 792]], true), false))).getPageCount()).toBe(1);
  });

  it('[SGC-REQ-017] «Ver documento» de un Excel adjunto usa Microsoft y, si falla, la conversión de SynerLink', async () => {
    const bytes = await book();
    const ms = await pdf([[612, 792]]);
    const calls: string[] = [];
    const deps = { docxToHtml: async () => '', htmlToPdf: async () => (calls.push('synerlink'), ms) };
    expect(await attachmentToViewablePdf(bytes, 'F.xlsx', { ...deps, officeToPdf: async () => (calls.push('microsoft'), ms) })).toBe(ms);
    expect(calls).toEqual(['microsoft']);
    await attachmentToViewablePdf(bytes, 'F.xlsx', { ...deps, officeToPdf: async () => Promise.reject(new Error('Graph caído')) });
    expect(calls).toEqual(['microsoft', 'synerlink']);
  });
});
