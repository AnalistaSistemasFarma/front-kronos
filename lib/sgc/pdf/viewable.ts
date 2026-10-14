import ExcelJS from 'exceljs';
import { isPdf } from '../storage';
import { isXlsx as isZip } from '../training/xlsx';
import { wrapDraftForPdf, type SgcDocxToHtml, type SgcHtmlToPdf } from './render';

/**
 * 2026-10-05 (RN de auditoría: «Ver documento» nunca descarga): convierte un
 * adjunto de la solicitud en un PDF para el VISOR SEGURO de la app.
 *   - PDF → tal cual.
 *   - Word (.docx) → HTML (mammoth) → PDF (Chrome headless), como el borrador.
 *   - Excel (.xlsx) → tablas HTML (exceljs, valores guardados) → PDF.
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

/** Todas las hojas de un .xlsx como tablas HTML (solo lectura: no evalúa macros ni fórmulas). */
export async function xlsxToHtml(bytes: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const parts: string[] = [];
  for (const sheet of wb.worksheets) {
    const rows: string[] = [];
    let truncated = false;
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= MAX_SHEET_ROWS) {
        truncated = true;
        return;
      }
      const values = (Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : []).slice(0, MAX_SHEET_COLS);
      const tag = n === 1 ? 'th' : 'td';
      rows.push(`<tr>${values.map((v) => `<${tag}>${escapeHtml(cellText(v))}</${tag}>`).join('')}</tr>`);
    });
    parts.push(`<h2>${escapeHtml(sheet.name)}</h2>`);
    parts.push(rows.length ? `<table><tbody>${rows.join('')}</tbody></table>` : '<p>(Hoja vacía)</p>');
    if (truncated) parts.push(`<p>Se muestran las primeras ${MAX_SHEET_ROWS} filas.</p>`);
  }
  return parts.join('');
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
    const html = await xlsxToHtml(bytes);
    return deps.htmlToPdf(wrapDraftForPdf({ title: fileName, code: '', contentHtml: html }));
  }
  return null;
}
