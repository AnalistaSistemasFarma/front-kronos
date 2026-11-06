import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { columnWidthPt, parsePrintArea, parsePrintTitles, xlsxToSheet } from '../pdf/viewable';
import { sheetZoomCss, wrapDraftForPdf } from '../pdf/render';
import { sanitizeDraftHtml } from '../draft/html';

/**
 * 2026-10-21 (reunión con Calidad OLP): los formatos en Excel salían en el
 * visor cortados y mal paginados (A4 vertical sin escala), sin bordes (la
 * regla «!important» se descartaba) y sin relleno ni negrita (la regla general
 * de las celdas les ganaba). Ahora la hoja se imprime con su área de
 * impresión, sus anchos, su orientación y escalada al ancho de la página.
 */

const thin = { style: 'thin' } as const;
const box = { top: thin, left: thin, bottom: thin, right: thin };

async function wideFormat(opts: { printArea?: string; titles?: string; landscape?: boolean } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formato');
  if (opts.landscape) ws.pageSetup.orientation = 'landscape';
  if (opts.printArea) ws.pageSetup.printArea = opts.printArea;
  if (opts.titles) ws.pageSetup.printTitlesRow = opts.titles;
  for (let c = 1; c <= 12; c++) ws.getColumn(c).width = 20;
  ws.getColumn(4).hidden = true;
  ws.mergeCells('A1:L1');
  ws.getCell('A1').value = 'REGISTRO';
  ws.getCell('A1').font = { bold: true, size: 14 };
  for (let c = 1; c <= 12; c++) ws.getRow(2).getCell(c).value = `Columna ${c}`;
  ws.getRow(3).height = 24;
  for (let r = 1; r <= 6; r++) for (let c = 1; c <= 12; c++) ws.getRow(r).getCell(c).border = box;
  ws.getRow(5).hidden = true;
  ws.getCell('Z300').numFmt = '0.00'; // formato suelto muy lejos: no debe estirar la hoja
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('SGC · Excel en el visor: legible, completo y a escala (2026-10-21)', () => {
  it('[SGC-REQ-164] piezas puras: ancho de columna en puntos, área de impresión y filas de título', () => {
    expect(columnWidthPt(8.43)).toBe(48);
    expect(columnWidthPt(20)).toBe(108.8);
    expect(parsePrintArea("'Hoja 1'!$B$2:$H$40")).toEqual({ top: 2, left: 2, bottom: 40, right: 8 });
    expect(parsePrintArea('A1:C3,E1:F2')).toEqual({ top: 1, left: 1, bottom: 3, right: 3 });
    expect(parsePrintArea('nada')).toBeNull();
    expect(parsePrintTitles('$1:$3')).toEqual({ first: 1, last: 3 });
    expect(parsePrintTitles(undefined)).toBeNull();
  });

  it('[SGC-REQ-164] recorta lo vacío, salta filas y columnas ocultas y cuenta la combinada solo con las visibles', async () => {
    const { html, layout } = await xlsxToSheet(await wideFormat());
    // 12 columnas de 20 caracteres menos la oculta = 11 × 108,8 pt.
    expect(layout.tables).toEqual([{ cls: 'sgc-t-0', widthPt: 1197 }]);
    expect(layout.landscape).toBe(true);
    expect(html).toContain('<td colspan="11" class="sgc-b sgc-bt sgc-bl sgc-bb sgc-br sgc-fs-14">REGISTRO</td>');
    expect(html).not.toContain('Columna 4');
    expect(html).toContain('Columna 12');
    expect((html.match(/<tr/g) ?? []).length).toBe(1 + 5); // regla + filas 1-6 sin la 5 oculta
    expect(html).toContain('<tr class="sgc-vacia sgc-h-24">');
  });

  it('[SGC-REQ-164] respeta el área de impresión y repite las filas de título en cada página', async () => {
    const { html, layout } = await xlsxToSheet(await wideFormat({ printArea: 'A1:C6', titles: '1:2' }));
    expect(layout.tables[0].widthPt).toBe(326);
    expect(layout.landscape).toBe(false);
    expect(html).toContain('<thead><tr><td colspan="3"');
    expect(html).not.toContain('Columna 5');
    const clean = sanitizeDraftHtml(html);
    expect(clean).toContain('<thead>');
    expect(clean).toContain('<tr class="sgc-regla">');
  });

  it('[SGC-REQ-164] la página: horizontal si la hoja es ancha, escala al ancho útil y nunca horizontal con encabezado institucional', async () => {
    const sheet = await xlsxToSheet(await wideFormat({ landscape: true }));
    const visor = wrapDraftForPdf({ title: 'F', code: 'C', contentHtml: sheet.html, sheet: true, extraCss: sheet.css, sheetLayout: sheet.layout });
    expect(visor).toContain('@page { size: A4 landscape; margin: 1.5cm 1.2cm; }');
    expect(visor).toMatch(/table\.sgc-t-0\{zoom:0\.64\d\}/);
    expect(visor).toContain('table.sgc-hoja.sgc-tw-1197{width:1197pt}');
    const inst = wrapDraftForPdf({ title: 'F', code: 'C', contentHtml: sheet.html, sheet: true, extraCss: sheet.css, sheetLayout: sheet.layout, institutional: true });
    expect(inst).not.toContain('landscape');
    expect(inst).toMatch(/table\.sgc-t-0\{zoom:0\.40\d\}/);
    // El texto normal no cambia.
    expect(wrapDraftForPdf({ title: 'T', code: 'C', contentHtml: '<p>x</p>' })).toContain('@page { size: A4; margin: 2.2cm 2cm; }');
  });

  it('[SGC-REQ-164] la escala solo achica, tiene piso y solo acepta clases «sgc-t-N»', () => {
    expect(sheetZoomCss({ landscape: false, tables: [{ cls: 'sgc-t-0', widthPt: 300 }] }, 527)).toBe('');
    expect(sheetZoomCss({ landscape: false, tables: [{ cls: 'sgc-t-1', widthPt: 10_000 }] }, 527)).toBe('table.sgc-t-1{zoom:0.25}');
    expect(sheetZoomCss({ landscape: false, tables: [{ cls: 'x}body{display:none', widthPt: 900 }] }, 527)).toBe('');
    expect(sheetZoomCss(undefined, 527)).toBe('');
  });
});
