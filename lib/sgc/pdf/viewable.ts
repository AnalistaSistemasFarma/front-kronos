import ExcelJS from 'exceljs';
import { isPdf } from '../storage';
import { isXlsx as isZip } from '../training/xlsx';
import { wrapDraftForPdf, type SgcDocxToHtml, type SgcHtmlToPdf } from './render';

/**
 * 2026-10-05 (RN de auditoría: «Ver documento» nunca descarga): convierte un
 * adjunto de la solicitud en un PDF para el VISOR SEGURO de la app.
 *   - PDF → tal cual.
 *   - Word (.docx) → HTML (mammoth) → PDF (Chrome headless), como el borrador.
 *   - Excel (.xlsx) → tablas HTML con su presentación (exceljs, valores guardados) → PDF.
 * Cualquier otro formato devuelve null (la ruta responde 415).
 */

const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_COLS = 60;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[]; error?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (typeof v.text === 'string') return v.text;
    if (v.error !== undefined) return String(v.error);
    return '';
  }
  return String(value);
}

/**
 * S16 (R32, D17: «el visor debe mostrar Excel… convertirlos a Word los daña»):
 * cada hoja del libro como una TABLA HTML fiel a su presentación — celdas
 * combinadas, anchos de columna, alto de las filas vacías (los formatos traen
 * filas en blanco para diligenciar), negrita, cursiva, subrayado, alineación,
 * relleno, color de letra y bordes — expresada con clases «sgc-…» que la hoja
 * de estilos generada aquí define (solo valores validados: colores hex y
 * números). No evalúa macros ni fórmulas (toma el valor guardado). Sin
 * dependencias nuevas: exceljs ya estaba (resultados de Forms y listado
 * maestro). Nunca pasa por Word.
 */
type XCell = { value: unknown; isMerged?: boolean; master?: { address: string }; address: string; font?: { bold?: boolean; italic?: boolean; underline?: unknown; color?: { argb?: string } }; alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean }; fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } }; border?: Record<string, { style?: string } | undefined> };

const HEX = /^[0-9a-f]{6}$/;
function hexOf(argb: unknown): string | null {
  if (typeof argb !== 'string') return null;
  const h = argb.trim().toLowerCase().slice(-6);
  return HEX.test(h) ? h : null;
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** «B3» → { row: 3, col: 2 } */
function addressOf(a: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(a.trim());
  return m ? { row: Number(m[2]), col: colNumber(m[1]) } : null;
}

/** Combinaciones «A1:C2» → celda maestra con su extensión y las celdas cubiertas. */
export function parseMerges(merges: readonly string[]): { spans: Map<string, { rowspan: number; colspan: number }>; covered: Set<string> } {
  const spans = new Map<string, { rowspan: number; colspan: number }>();
  const covered = new Set<string>();
  for (const m of merges) {
    const [a, b] = m.split(':');
    const p = a ? addressOf(a) : null;
    const q = b ? addressOf(b) : null;
    if (!p || !q) continue;
    const top = Math.min(p.row, q.row);
    const left = Math.min(p.col, q.col);
    const bottom = Math.max(p.row, q.row);
    const right = Math.max(p.col, q.col);
    spans.set(`${top},${left}`, { rowspan: Math.min(99, bottom - top + 1), colspan: Math.min(99, right - left + 1) });
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) if (r !== top || c !== left) covered.add(`${r},${c}`);
  }
  return { spans, covered };
}

/** Clases «sgc-…» de una celda y las reglas CSS que necesita. */
export function cellClasses(cell: Pick<XCell, 'font' | 'alignment' | 'fill' | 'border'>, rules: Map<string, string>): string[] {
  const out: string[] = [];
  if (cell.font?.bold) out.push('sgc-b');
  if (cell.font?.italic) out.push('sgc-i');
  if (cell.font?.underline) out.push('sgc-u');
  const fc = hexOf(cell.font?.color?.argb);
  if (fc && fc !== '000000') {
    out.push(`sgc-fc-${fc}`);
    rules.set(`sgc-fc-${fc}`, `color:#${fc}`);
  }
  const h = cell.alignment?.horizontal;
  if (h === 'center' || h === 'centerContinuous') out.push('sgc-al-c');
  else if (h === 'right') out.push('sgc-al-r');
  const v = cell.alignment?.vertical;
  if (v === 'middle') out.push('sgc-va-m');
  else if (v === 'bottom') out.push('sgc-va-b');
  if (cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid') {
    const bg = hexOf(cell.fill.fgColor?.argb);
    if (bg && bg !== 'ffffff') {
      out.push(`sgc-bg-${bg}`);
      rules.set(`sgc-bg-${bg}`, `background:#${bg}`);
    }
  }
  const b = cell.border ?? {};
  if (['top', 'left', 'bottom', 'right'].some((k) => b[k]?.style)) {
    for (const [k, cls] of [['top', 'sgc-bt'], ['left', 'sgc-bl'], ['bottom', 'sgc-bb'], ['right', 'sgc-br']] as const) if (b[k]?.style) out.push(cls);
  }
  return out;
}

const BASE_SHEET_CSS = [
  'table.sgc-hoja{border-collapse:collapse;table-layout:fixed}',
  'table.sgc-hoja td,table.sgc-hoja th{border:0;font-weight:normal;background:transparent;vertical-align:top;white-space:pre-wrap}',
  '.sgc-b{font-weight:bold}',
  '.sgc-i{font-style:italic}',
  '.sgc-u{text-decoration:underline}',
  '.sgc-al-c{text-align:center}',
  '.sgc-al-r{text-align:right}',
  '.sgc-va-m{vertical-align:middle}',
  '.sgc-va-b{vertical-align:bottom}',
  '.sgc-bt{border-top:0.6pt solid #333 !important}',
  '.sgc-bl{border-left:0.6pt solid #333 !important}',
  '.sgc-bb{border-bottom:0.6pt solid #333 !important}',
  '.sgc-br{border-right:0.6pt solid #333 !important}',
  'tr.sgc-vacia td{height:12pt}',
  'tr.sgc-regla td{height:0;padding:0 !important;border:0 !important;line-height:0;font-size:0}',
].join('\n');

/**
 * 2026-10-21 (reunión con Calidad OLP: «el Excel sale cortado y mal
 * paginado»): cómo imprimir cada hoja. Cada tabla lleva la clase
 * «sgc-t-N» y su ancho natural en puntos; wrapDraftForPdf la escala para
 * que quepa en el ancho de la página y elige la orientación.
 */
export interface SgcSheetLayout {
  /** La hoja viene en horizontal o es demasiado ancha para A4 vertical. */
  landscape: boolean;
  tables: { cls: string; widthPt: number }[];
}

export interface SgcSheetHtml {
  html: string;
  css: string;
  layout: SgcSheetLayout;
}

/** Ancho de una columna de Excel (en caracteres) a puntos, como lo hace Excel (7 px por carácter + 5 px de margen). */
export function columnWidthPt(chars: number): number {
  return Math.round(Math.trunc(chars * 7 + 5) * 0.75 * 10) / 10;
}

/** Primer rango «A1:H40» del área de impresión de la hoja («'Hoja'!$A$1:$H$40», con varios rangos toma el primero). */
export function parsePrintArea(area: unknown): { top: number; left: number; bottom: number; right: number } | null {
  if (typeof area !== 'string') return null;
  const m = /\$?([A-Za-z]{1,3})\$?(\d{1,7}):\$?([A-Za-z]{1,3})\$?(\d{1,7})/.exec(area);
  if (!m) return null;
  const a = addressOf(`${m[1]}${m[2]}`)!;
  const b = addressOf(`${m[3]}${m[4]}`)!;
  return { top: Math.min(a.row, b.row), left: Math.min(a.col, b.col), bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col) };
}

/** Filas de título que se repiten en cada página («1:3» o «$1:$3»). */
export function parsePrintTitles(rows: unknown): { first: number; last: number } | null {
  if (typeof rows !== 'string') return null;
  const m = /\$?(\d{1,7}):\$?(\d{1,7})/.exec(rows);
  if (!m) return null;
  const first = Math.min(Number(m[1]), Number(m[2]));
  const last = Math.max(Number(m[1]), Number(m[2]));
  return last - first < 30 ? { first, last } : null;
}

/** A4 vertical sin márgenes laterales de la hoja (1,2 cm a cada lado): por encima de esto conviene horizontal. */
const PORTRAIT_SHEET_WIDTH_PT = 527;

type XSheet = ExcelJS.Worksheet & {
  state?: string;
  pageSetup?: { orientation?: string; printArea?: string; printTitlesRow?: string };
  properties?: { defaultColWidth?: number };
};

/** Celda con algo que mostrar: texto, borde o relleno (las que solo tienen formato vacío no cuentan). */
function cellHasContent(cell: XCell): boolean {
  if (cellText(cell.value).trim()) return true;
  const b = cell.border ?? {};
  if (['top', 'left', 'bottom', 'right'].some((k) => b[k]?.style)) return true;
  return cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' && Boolean(hexOf(cell.fill.fgColor?.argb)) && hexOf(cell.fill.fgColor?.argb) !== 'ffffff';
}

/**
 * Todas las hojas de un .xlsx como tablas HTML con su presentación (solo
 * lectura: no evalúa macros ni fórmulas). 2026-10-21: respeta el área de
 * impresión (o recorta las filas y columnas vacías del final), los anchos
 * reales de columna (en una fila «regla» invisible, para que las celdas
 * combinadas de la primera fila no los pierdan), el alto de las filas, el
 * tamaño de letra, las filas y columnas ocultas, y repite en cada página las
 * filas de título que el Excel tenga configuradas.
 */
export async function xlsxToSheet(bytes: Uint8Array): Promise<SgcSheetHtml> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const parts: string[] = [];
  const rules = new Map<string, string>();
  const tables: SgcSheetLayout['tables'] = [];
  let landscape = false;
  let shown = 0;
  for (const sheet of wb.worksheets as XSheet[]) {
    if (sheet.state === 'hidden' || sheet.state === 'veryHidden') continue;
    const merges = ((sheet.model as { merges?: string[] }).merges ?? []).filter((x) => typeof x === 'string');
    parts.push(`<h2 class="sgc-hoja-nombre${shown > 0 ? ' sgc-hoja-sig' : ''}">${escapeHtml(sheet.name)}</h2>`);
    shown++;
    const maxRow = Math.min(sheet.rowCount, MAX_SHEET_ROWS);
    const maxCol = Math.min(Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0), MAX_SHEET_COLS);
    // Rango a imprimir: el área de impresión del Excel o, si no tiene, hasta la última celda con contenido.
    let top = 1;
    let left = 1;
    let bottom = 0;
    let right = 0;
    const area = parsePrintArea(sheet.pageSetup?.printArea);
    if (area) {
      top = area.top;
      left = area.left;
      bottom = Math.min(area.bottom, top + MAX_SHEET_ROWS - 1);
      right = Math.min(area.right, left + MAX_SHEET_COLS - 1);
    } else {
      for (let r = 1; r <= maxRow; r++) {
        const row = sheet.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
          if (cellHasContent(row.getCell(c) as unknown as XCell)) {
            if (r > bottom) bottom = r;
            if (c > right) right = c;
          }
        }
      }
      for (const m of merges) {
        const [a, b] = m.split(':');
        const p = a ? addressOf(a) : null;
        const q = b ? addressOf(b) : null;
        if (!p || !q || Math.min(p.row, q.row) > bottom || Math.min(p.col, q.col) > right) continue;
        bottom = Math.min(maxRow, Math.max(bottom, p.row, q.row));
        right = Math.min(maxCol, Math.max(right, p.col, q.col));
      }
    }
    const cols: number[] = [];
    for (let c = left; c <= right; c++) if (!sheet.getColumn(c).hidden) cols.push(c);
    const rowsShown: number[] = [];
    for (let r = top; r <= bottom; r++) if (!sheet.getRow(r).hidden) rowsShown.push(r);
    if (!cols.length || !rowsShown.length) {
      parts.push('<p>(Hoja vacía)</p>');
      continue;
    }
    const colSet = new Set(cols);
    const rowSet = new Set(rowsShown);
    const { spans: rawSpans, covered } = parseMerges(merges);
    // Las combinaciones cuentan solo las filas y columnas visibles.
    const spans = new Map<string, { rowspan: number; colspan: number }>();
    for (const [key, span] of rawSpans) {
      const [r0, c0] = key.split(',').map(Number);
      let rowspan = 0;
      let colspan = 0;
      for (let r = r0; r < r0 + span.rowspan; r++) if (rowSet.has(r) && r <= bottom) rowspan++;
      for (let c = c0; c < c0 + span.colspan; c++) if (colSet.has(c) && c <= right) colspan++;
      spans.set(key, { rowspan: Math.max(1, rowspan), colspan: Math.max(1, colspan) });
    }
    const defaultWidth = Number(sheet.properties?.defaultColWidth ?? 8.43) || 8.43;
    let widthPt = 0;
    const regla: string[] = [];
    for (const c of cols) {
      const pt = columnWidthPt(Math.min(255, Math.max(0.5, Number(sheet.getColumn(c).width ?? defaultWidth) || defaultWidth)));
      widthPt += pt;
      const cls = `sgc-wp-${Math.round(pt * 10)}`;
      rules.set(cls, `width:${pt}pt`);
      regla.push(`<td class="${cls}"></td>`);
    }
    widthPt = Math.round(widthPt);
    // Filas de título: van en <thead> (Chrome las repite en cada página) si ninguna combinación cruza el borde.
    let titles = parsePrintTitles(sheet.pageSetup?.printTitlesRow);
    if (titles && (titles.first !== top || titles.last >= bottom)) titles = null;
    if (titles) {
      const t = titles;
      for (const [key, span] of rawSpans) {
        const r0 = Number(key.split(',')[0]);
        if (r0 <= t.last && r0 + span.rowspan - 1 > t.last) titles = null;
      }
    }
    const head: string[] = [];
    const body: string[] = [];
    for (const r of rowsShown) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      let hasText = false;
      for (const c of cols) {
        const key = `${r},${c}`;
        if (covered.has(key)) continue;
        const cell = row.getCell(c) as unknown as XCell & { font?: { size?: number } };
        const text = cellText(cell.value);
        if (text.trim()) hasText = true;
        const span = spans.get(key);
        const cls = cellClasses(cell, rules);
        const size = Number(cell.font?.size);
        if (Number.isFinite(size) && size >= 5 && size <= 40 && Math.round(size) !== 11) {
          cls.push(`sgc-fs-${Math.round(size)}`);
          rules.set(`sgc-fs-${Math.round(size)}`, `font-size:${Math.round(size)}pt`);
        }
        const attrs = `${span && span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ''}${span && span.colspan > 1 ? ` colspan="${span.colspan}"` : ''}${cls.length ? ` class="${cls.join(' ')}"` : ''}`;
        cells.push(`<td${attrs}>${text ? escapeHtml(text) : '&nbsp;'}</td>`);
      }
      const rowCls: string[] = hasText ? [] : ['sgc-vacia'];
      const height = Number(row.height);
      if (Number.isFinite(height) && height > 0 && height <= 400) {
        const h = Math.round(height);
        rowCls.push(`sgc-h-${h}`);
        rules.set(`sgc-h-${h}`, `height:${h}pt`);
      }
      (titles && r <= titles.last ? head : body).push(`<tr${rowCls.length ? ` class="${rowCls.join(' ')}"` : ''}>${cells.join('')}</tr>`);
    }
    const tcls = `sgc-t-${tables.length}`;
    const twcls = `sgc-tw-${widthPt}`;
    rules.set(twcls, `width:${widthPt}pt`);
    tables.push({ cls: tcls, widthPt });
    if (sheet.pageSetup?.orientation === 'landscape' || widthPt > PORTRAIT_SHEET_WIDTH_PT * 1.25) landscape = true;
    parts.push(
      `<table class="sgc-hoja ${tcls} ${twcls}">${head.length ? `<thead>${head.join('')}</thead>` : ''}<tbody><tr class="sgc-regla">${regla.join('')}</tr>${body.join('')}</tbody></table>`
    );
    if (bottom - top + 1 >= MAX_SHEET_ROWS) parts.push(`<p>Se muestran las primeras ${MAX_SHEET_ROWS} filas.</p>`);
  }
  // Las clases van dentro de «table.sgc-hoja» para ganarle a la regla general de las celdas (antes la negrita y el relleno no se veían).
  const scoped = (rule: string) => (rule.startsWith('.sgc-tw-') ? `table.sgc-hoja${rule}` : rule.startsWith('.sgc-') ? `table.sgc-hoja ${rule}` : rule);
  const css = [...BASE_SHEET_CSS.split('\n'), ...[...rules.entries()].map(([k, v]) => `.${k}{${v}}`)].map(scoped).join('\n');
  return { html: parts.join(''), css, layout: { landscape, tables } };
}

/** Solo el HTML de las hojas (compatibilidad: sin la hoja de estilos). */
export async function xlsxToHtml(bytes: Uint8Array): Promise<string> {
  return (await xlsxToSheet(bytes)).html;
}

export async function attachmentToViewablePdf(
  bytes: Uint8Array,
  fileName: string,
  deps: { docxToHtml: SgcDocxToHtml; htmlToPdf: SgcHtmlToPdf }
): Promise<Uint8Array | null> {
  const name = fileName.toLowerCase();
  if (isPdf(bytes)) return bytes;
  if (name.endsWith('.docx') && isZip(bytes)) {
    const html = await deps.docxToHtml(bytes);
    return deps.htmlToPdf(wrapDraftForPdf({ title: fileName, code: '', contentHtml: html }));
  }
  if (name.endsWith('.xlsx') && isZip(bytes)) {
    const sheet = await xlsxToSheet(bytes);
    return deps.htmlToPdf(wrapDraftForPdf({ title: fileName, code: '', contentHtml: sheet.html, sheet: true, extraCss: sheet.css, sheetLayout: sheet.layout }));
  }
  return null;
}
