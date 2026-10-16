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
export interface SgcSheetHtml {
  html: string;
  css: string;
}

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
  'table.sgc-hoja{border-collapse:collapse;table-layout:auto}',
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
].join('\n');

/** Todas las hojas de un .xlsx como tablas HTML con su presentación (solo lectura: no evalúa macros ni fórmulas). */
export async function xlsxToSheet(bytes: Uint8Array): Promise<SgcSheetHtml> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const parts: string[] = [];
  const rules = new Map<string, string>();
  for (const sheet of wb.worksheets) {
    if ((sheet as { state?: string }).state === 'hidden' || (sheet as { state?: string }).state === 'veryHidden') continue;
    const { spans, covered } = parseMerges(((sheet.model as { merges?: string[] }).merges ?? []).filter((x) => typeof x === 'string'));
    const lastRow = Math.min(sheet.rowCount, MAX_SHEET_ROWS);
    const lastCol = Math.min(Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0), MAX_SHEET_COLS);
    parts.push(`<h2 class="sgc-hoja-nombre">${escapeHtml(sheet.name)}</h2>`);
    if (lastRow === 0 || lastCol === 0) {
      parts.push('<p>(Hoja vacía)</p>');
      continue;
    }
    const widths: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      const w = Math.round(Math.min(99, Math.max(2, Number(sheet.getColumn(c).width ?? 10))));
      widths.push(`sgc-w-${w}`);
      rules.set(`sgc-w-${w}`, `width:${w}ch;min-width:${Math.max(2, Math.round(w * 0.6))}ch`);
    }
    const rows: string[] = [];
    for (let r = 1; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      let hasText = false;
      for (let c = 1; c <= lastCol; c++) {
        const key = `${r},${c}`;
        if (covered.has(key)) continue;
        const cell = row.getCell(c) as unknown as XCell;
        const text = cellText(cell.value);
        if (text.trim()) hasText = true;
        const span = spans.get(key);
        const cls = [...cellClasses(cell, rules), ...(r === 1 ? [widths[c - 1]] : [])];
        const attrs = `${span && span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ''}${span && span.colspan > 1 ? ` colspan="${span.colspan}"` : ''}${cls.length ? ` class="${cls.join(' ')}"` : ''}`;
        cells.push(`<td${attrs}>${text ? escapeHtml(text) : '&nbsp;'}</td>`);
      }
      rows.push(`<tr${hasText ? '' : ' class="sgc-vacia"'}>${cells.join('')}</tr>`);
    }
    parts.push(`<table class="sgc-hoja"><tbody>${rows.join('')}</tbody></table>`);
    if (sheet.rowCount > MAX_SHEET_ROWS) parts.push(`<p>Se muestran las primeras ${MAX_SHEET_ROWS} filas.</p>`);
  }
  const css = [BASE_SHEET_CSS, ...[...rules.entries()].map(([k, v]) => `.${k}{${v}}`)].join('\n');
  return { html: parts.join(''), css };
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
    return deps.htmlToPdf(wrapDraftForPdf({ title: fileName, code: '', contentHtml: sheet.html, sheet: true, extraCss: sheet.css }));
  }
  return null;
}
