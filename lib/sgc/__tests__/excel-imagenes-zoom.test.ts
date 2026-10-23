import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { xlsxToSheet } from '../pdf/viewable';
import { wrapDraftForPdf } from '../pdf/render';
import { sanitizeDraftHtml } from '../draft/html';
import { sgcViewerPageWidth } from '../../../components/sgc/SgcSecureViewer';

/**
 * 2026-10-22 (Calidad OLP): «las firmas del Excel no salen» — las imágenes
 * incrustadas (firmas escaneadas, logos, sellos) se dibujan sobre su celda —
 * y «la previsualización no deja hacer zoom» — cada paso de zoom cambia el
 * tamaño de la página, también en hojas horizontales más anchas que el visor.
 */

// PNG de 1 × 1.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function withImages(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formato');
  for (let c = 1; c <= 4; c++) ws.getColumn(c).width = 20;
  ws.getCell('A1').value = 'Elaboró:';
  ws.getCell('D8').value = 'fin';
  ws.mergeCells('B2:C4');
  const id = wb.addImage({ buffer: PNG as never, extension: 'png' });
  ws.addImage(id, { tl: { col: 1, row: 1 }, ext: { width: 120, height: 40 } } as never); // B2 (maestra de la combinada)
  ws.addImage(id, 'C3:D5'); // ancla en C3, cubierta por B2:C4 → va en B2 desplazada
  ws.addImage(id, { tl: { col: 10, row: 20 }, ext: { width: 50, height: 20 } } as never); // fuera de lo que se imprime
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('SGC · imágenes del Excel y zoom del visor (2026-10-22)', () => {
  it('[SGC-REQ-164] las imágenes incrustadas salen sobre su celda, con su tamaño; las de fuera del rango no', async () => {
    const { html, css } = await xlsxToSheet(await withImages());
    const imgs = html.match(/<img class="sgc-img sgc-img-\d+" src="data:image\/png;base64,[^"]+">/g) ?? [];
    expect(imgs).toHaveLength(2);
    expect(html).toMatch(/<td rowspan="3" colspan="2" class="sgc-rel"><img/);
    expect(css).toContain('table.sgc-hoja .sgc-rel{position:relative}');
    expect(css).toMatch(/table\.sgc-hoja \.sgc-img-\d+\{left:0pt;top:0pt;width:90pt;height:30pt\}/);
    // La segunda: desplazada una columna (C) y una fila (3) desde la maestra B2.
    expect(css).toMatch(/table\.sgc-hoja \.sgc-img-\d+\{left:108\.8pt;top:15pt;width:217\.6pt;height:45pt\}/);
    // El sanitizador conserva la imagen incrustada y sus clases «sgc-…»; la hoja de estilos pasa el filtro.
    const clean = sanitizeDraftHtml(html);
    expect(clean.match(/<img class="sgc-img sgc-img-\d+" src="data:image\/png/g)).toHaveLength(2);
    expect(sanitizeDraftHtml('<img class="otra" src="data:image/png;base64,AAAA">')).toBe('<img src="data:image/png;base64,AAAA">');
    const page = wrapDraftForPdf({ title: 'F', code: 'C', contentHtml: clean, sheet: true, extraCss: css });
    expect(page).toContain('table.sgc-hoja .sgc-img{position:absolute;max-width:none !important;z-index:1}');
  });

  it('[SGC-REQ-017] el zoom del visor cambia el tamaño en cada paso, aunque la página no quepa en el visor', () => {
    // Hoja horizontal (842 pt) en un visor de 750 px: a la escala base cabe en el visor.
    const base = sgcViewerPageWidth(841.89, 750, 1.3);
    expect(base).toBe(718);
    expect(sgcViewerPageWidth(841.89, 750, 1.1)).toBeLessThan(base);
    expect(sgcViewerPageWidth(841.89, 750, 1.5)).toBeGreaterThan(base);
    // Página vertical en un visor ancho: a la escala base no pasa de su tamaño natural.
    expect(sgcViewerPageWidth(595.28, 2000, 1.3)).toBeCloseTo(773.9, 0);
    // Nunca menos de 120 px.
    expect(sgcViewerPageWidth(595.28, 0, 0.1)).toBe(120);
  });
});
