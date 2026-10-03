import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { toWinAnsiSafe } from '../watermark';
import type { SgcPlacedMeaning, SgcPlacementParticipant, SgcStoredField } from '../signature/fields';

/**
 * PLANTILLA INSTITUCIONAL del SGC (correcciones de Calidad OLP, 2026-10-02) —
 * funciones PURAS sobre pdf-lib y texto (se prueban sin red).
 *
 * El encabezado lo pone el SISTEMA (no el elaborador), igual al de la
 * plantilla de procedimiento de Calidad: en la primera página del contenido,
 * logo de la empresa, nombre del documento, CÓDIGO, VERSIÓN, PÁGINA x DE y,
 * ELABORÓ / REVISÓ / APROBÓ (nombres) con su recuadro «Firma», FECHA DE
 * EMISIÓN y PROCESO; en las demás páginas, un encabezado corto con logo,
 * nombre, código, versión y página. Los recuadros «Firma» son la ubicación
 * sugerida de cada firma; el elaborador las puede mover (mecanismo de
 * SynerLink). La FECHA DE EMISIÓN es la fecha en que el documento queda
 * vigente: el PDF firmado no se modifica después (su huella SHA-256 es la
 * registrada y sobre ella firman los lectores), así que la fecha se estampa
 * en ese recuadro en cada copia controlada que entrega el visor.
 *
 * Campos de sistema en el CUERPO: el elaborador puede escribir las marcas
 * {{CODIGO}}, {{VERSION}}, {{NOMBRE_DOCUMENTO}}, {{PROCESO}},
 * {{TIPO_DOCUMENTAL}}, {{EMPRESA}}, {{ELABORO}}, {{REVISO}}, {{APROBO}} y
 * {{HISTORIAL_CAMBIOS}}; el sistema las llena al generar el PDF controlado.
 */

/** Márgenes del contenido (CSS @page) para dejar espacio al encabezado. */
export const SGC_INSTITUTIONAL_FIRST_TOP_CM = 6.6;
export const SGC_INSTITUTIONAL_OTHER_TOP_CM = 2.8;

export const SGC_SYSTEM_TOKENS = ['CODIGO', 'VERSION', 'NOMBRE_DOCUMENTO', 'PROCESO', 'TIPO_DOCUMENTAL', 'EMPRESA', 'ELABORO', 'REVISO', 'APROBO', 'HISTORIAL_CAMBIOS'] as const;
export type SgcSystemToken = (typeof SGC_SYSTEM_TOKENS)[number];

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.48);
const LINE = rgb(0.35, 0.38, 0.42);
const BOX = rgb(0.6, 0.63, 0.68);

const MARGIN_X = 36;
const TOP = 28;
const ROW_A = 50;
const ROW_B = 30;
const ROW_C = 44;
const ROW_D = 18;
const SHORT_ROW = 28;

export interface SgcInstitutionalHeaderData {
  company: string;
  title: string;
  code: string;
  versionLabel: string;
  process: string;
  documentType: string;
  elaboro: string[];
  reviso: string[];
  aprobo: string[];
  /** Texto del recuadro «Fecha de emisión» en el PDF guardado. */
  emissionText: string;
  /** Logo de la empresa (PNG o JPEG) o null. */
  logo: { bytes: Uint8Array; kind: 'png' | 'jpg' } | null;
}

export interface SgcRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function fit(text: string, font: PDFFont, size: number, width: number, min = 5): { text: string; size: number } {
  const t = toWinAnsiSafe(text);
  let s = size;
  while (s > min && font.widthOfTextAtSize(t, s) > width) s -= 0.25;
  if (font.widthOfTextAtSize(t, s) <= width) return { text: t, size: s };
  let cut = t;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, s) > width) cut = cut.slice(0, -1);
  return { text: `${cut}...`, size: s };
}

function cell(page: PDFPage, r: SgcRect) {
  page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, borderColor: LINE, borderWidth: 0.7 });
}

/** Geometría de la tabla del encabezado de la PRIMERA página (en puntos, origen abajo-izquierda). */
export function firstPageHeaderGeometry(pageWidth: number, pageHeight: number) {
  const w = pageWidth - MARGIN_X * 2;
  const top = pageHeight - TOP;
  const yA = top - ROW_A;
  const yB = yA - ROW_B;
  const yC = yB - ROW_C;
  const yD = yC - ROW_D;
  const logoW = 92;
  const codeW = 150;
  const titleW = w - logoW - codeW;
  const col = w / 4;
  const colRect = (i: number, y: number, h: number): SgcRect => ({ x: MARGIN_X + col * i, y, width: col, height: h });
  return {
    logo: { x: MARGIN_X, y: yA, width: logoW, height: ROW_A },
    title: { x: MARGIN_X + logoW, y: yA, width: titleW, height: ROW_A },
    code: { x: MARGIN_X + logoW + titleW, y: yA, width: codeW, height: ROW_A },
    labels: [0, 1, 2, 3].map((i) => colRect(i, yB, ROW_B)),
    firmas: [0, 1, 2].map((i) => colRect(i, yC, ROW_C)),
    emission: colRect(3, yC, ROW_C),
    process: { x: MARGIN_X, y: yD, width: w, height: ROW_D },
    bottom: yD,
  };
}

const MEANING_COLUMN: Record<SgcPlacedMeaning, number> = { elaboro: 0, reviso: 1, aprobo: 2 };

/** Recuadros «Firma» (Elaboró, Revisó, Aprobó) en PORCENTAJE de la página (origen arriba-izquierda), para sugerir la ubicación. */
export function institutionalSignatureBoxesPct(pageWidth = 595.28, pageHeight = 841.89): Record<SgcPlacedMeaning, { x: number; y: number; width: number; height: number }> {
  const g = firstPageHeaderGeometry(pageWidth, pageHeight);
  const toPct = (r: SgcRect) => {
    const inner = { x: r.x + 3, y: r.y + 3, width: r.width - 6, height: r.height - 12 };
    return { x: (inner.x / pageWidth) * 100, y: ((pageHeight - inner.y - inner.height) / pageHeight) * 100, width: (inner.width / pageWidth) * 100, height: (inner.height / pageHeight) * 100 };
  };
  return { elaboro: toPct(g.firmas[0]), reviso: toPct(g.firmas[1]), aprobo: toPct(g.firmas[2]) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ubicación SUGERIDA de las firmas que faltan: dentro del recuadro «Firma» de
 * su significado en la página 1 (varias personas del mismo rol se reparten el
 * recuadro). El elaborador las puede mover o redimensionar después.
 */
export function suggestInstitutionalPlacements(participants: readonly SgcPlacementParticipant[], existing: readonly SgcStoredField[]): SgcStoredField[] {
  const boxes = institutionalSignatureBoxesPct();
  const placed = new Set(existing.map((f) => f.signerKey));
  const out: SgcStoredField[] = [];
  for (const meaning of ['elaboro', 'reviso', 'aprobo'] as const) {
    const group = participants.filter((p) => p.meaning === meaning);
    const box = boxes[meaning];
    const w = box.width / Math.max(1, group.length);
    group.forEach((p, i) => {
      if (placed.has(p.key)) return;
      out.push({ id: `sug-${MEANING_COLUMN[meaning]}-${i}`, signerKey: p.key, meaning, page: 1, x: round2(box.x + w * i), y: round2(box.y), width: round2(w), height: round2(box.height), label: `${p.role} · ${p.name}` });
    });
  }
  return out;
}

function drawLines(page: PDFPage, font: PDFFont, lines: string[], r: SgcRect, opts: { size: number; top: number; color?: ReturnType<typeof rgb> }) {
  let y = r.y + r.height - opts.top;
  for (const l of lines) {
    const f = fit(l, font, opts.size, r.width - 8);
    if (y < r.y + 2) break;
    page.drawText(f.text, { x: r.x + 4, y, size: f.size, font, color: opts.color ?? INK });
    y -= f.size + 2;
  }
}

function drawLogo(page: PDFPage, logo: PDFImage | null, r: SgcRect, fallback: string, font: PDFFont) {
  if (logo) {
    const scale = Math.min((r.width - 8) / logo.width, (r.height - 8) / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.drawImage(logo, { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h });
    return;
  }
  const f = fit(fallback, font, 9, r.width - 8);
  page.drawText(f.text, { x: r.x + 4, y: r.y + r.height / 2 - f.size / 2, size: f.size, font, color: MUTED });
}

function names(list: string[]): string {
  return list.length ? list.join(', ') : 'No aplica';
}

/**
 * Dibuja el encabezado institucional en las páginas del contenido. Devuelve
 * el recuadro de la FECHA DE EMISIÓN de la primera página (en puntos), para
 * que el visor estampe la fecha de vigencia en cada copia controlada.
 */
export async function drawInstitutionalHeaders(pdf: PDFDocument, pages: readonly PDFPage[], data: SgcInstitutionalHeaderData, fonts: Fonts): Promise<{ emission: SgcRect | null }> {
  let logo: PDFImage | null = null;
  if (data.logo) {
    try {
      logo = data.logo.kind === 'png' ? await pdf.embedPng(data.logo.bytes) : await pdf.embedJpg(data.logo.bytes);
    } catch {
      logo = null; // Un logo ilegible no impide el documento.
    }
  }
  const total = pages.length;
  let emission: SgcRect | null = null;
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const pageLabel = `PÁGINA ${i + 1} DE ${total}`;
    if (i === 0) {
      const g = firstPageHeaderGeometry(width, height);
      [g.logo, g.title, g.code, ...g.labels, ...g.firmas, g.emission, g.process].forEach((r) => cell(page, r));
      drawLogo(page, logo, g.logo, data.company, fonts.bold);
      drawLines(page, fonts.regular, ['NOMBRE DEL DOCUMENTO'], g.title, { size: 6.5, top: 10, color: MUTED });
      const titleLines = splitTitle(data.title, fonts.bold, 10.5, g.title.width - 8);
      drawLines(page, fonts.bold, titleLines, { ...g.title, height: g.title.height - 10 }, { size: 10.5, top: 12 });
      drawLines(page, fonts.bold, [`CÓDIGO: ${data.code}`, `VERSIÓN: ${data.versionLabel}`, pageLabel], g.code, { size: 8, top: 13 });
      const labels: [string, string][] = [
        ['ELABORÓ:', names(data.elaboro)],
        ['REVISÓ:', names(data.reviso)],
        ['APROBÓ:', names(data.aprobo)],
        ['FECHA DE EMISIÓN:', ''],
      ];
      labels.forEach(([label, value], c) => {
        drawLines(page, fonts.bold, [label], g.labels[c], { size: 7, top: 9 });
        if (value) drawLines(page, fonts.regular, [value], { ...g.labels[c], height: g.labels[c].height - 10 }, { size: 6.8, top: 9 });
      });
      g.firmas.forEach((r) => {
        page.drawText('Firma', { x: r.x + 4, y: r.y + r.height - 8, size: 5.5, font: fonts.regular, color: BOX });
      });
      drawLines(page, fonts.regular, [data.emissionText], g.emission, { size: 7.5, top: 16, color: MUTED });
      emission = { x: g.emission.x + 1, y: g.emission.y + 1, width: g.emission.width - 2, height: g.emission.height - 2 };
      drawLines(page, fonts.bold, [`PROCESO: ${data.process}    ·    TIPO DOCUMENTAL: ${data.documentType}`], g.process, { size: 7.5, top: 12 });
      return;
    }
    const w = width - MARGIN_X * 2;
    const top = height - TOP;
    const logoR = { x: MARGIN_X, y: top - SHORT_ROW, width: 70, height: SHORT_ROW };
    const codeR = { x: MARGIN_X + w - 190, y: top - SHORT_ROW, width: 190, height: SHORT_ROW };
    const titleR = { x: logoR.x + logoR.width, y: top - SHORT_ROW, width: w - logoR.width - codeR.width, height: SHORT_ROW };
    [logoR, titleR, codeR].forEach((r) => cell(page, r));
    drawLogo(page, logo, logoR, data.company, fonts.bold);
    drawLines(page, fonts.bold, [data.title], titleR, { size: 8.5, top: 17 });
    drawLines(page, fonts.bold, [`CÓDIGO: ${data.code} · VERSIÓN: ${data.versionLabel}`, pageLabel], codeR, { size: 7, top: 11 });
  });
  return { emission };
}

function splitTitle(title: string, font: PDFFont, size: number, width: number): string[] {
  const words = toWinAnsiSafe(title).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(probe, size) <= width || !line) line = probe;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Campos de sistema en el cuerpo e historial de cambios
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export interface SgcChangeHistoryRow {
  versionNumber: number;
  /** Fecha (YYYY-MM-DD) o texto («Al aprobar»). */
  date: string;
  previousVersion: number | null;
  reason: string;
}

/** Tabla «Historial de cambios» (columnas de la plantilla de Calidad). */
export function buildChangeHistoryHtml(rows: readonly SgcChangeHistoryRow[]): string {
  const body = rows
    .map((r, i) => `<tr><td>${i + 1}</td><td>${r.versionNumber}</td><td>${escapeHtml(r.date)}</td><td>${r.previousVersion ?? '—'}</td><td>${escapeHtml(r.reason)}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>No.</th><th>Versión</th><th>Fecha de modificación</th><th>No. de versión modificada</th><th>Motivo del cambio</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** ¿El HTML tiene la marca del historial de cambios? */
export function hasChangeHistoryToken(html: string): boolean {
  return /\{\{\s*HISTORIAL_CAMBIOS\s*\}\}/.test(html);
}

/**
 * Reemplaza las marcas de campos de sistema del cuerpo (HTML ya limpio). Los
 * valores se escapan; HISTORIAL_CAMBIOS recibe la tabla ya armada (HTML del
 * sistema). Las marcas desconocidas se dejan como están.
 */
export function applySystemFieldTokens(html: string, values: Partial<Record<SgcSystemToken, string>>, changeHistoryHtml: string | null): string {
  let out = html;
  if (changeHistoryHtml) {
    // El párrafo que solo tiene la marca se reemplaza entero por la tabla (una tabla no va dentro de <p>).
    out = out.replace(/<p>(?:<(?:strong|b|em|i|u|span)>){0,4}\{\{ ?HISTORIAL_CAMBIOS ?\}\}(?:<\/(?:strong|b|em|i|u|span)>){0,4}<\/p>/g, changeHistoryHtml);
  }
  return out.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name: string) => {
    if (name === 'HISTORIAL_CAMBIOS') return changeHistoryHtml ?? whole;
    const v = values[name as SgcSystemToken];
    return v === undefined ? whole : escapeHtml(v);
  });
}

// ---------------------------------------------------------------------------
// Logo de la empresa (sgc.company_config.logo_data_url)
// ---------------------------------------------------------------------------

export const SGC_LOGO_MAX_BYTES = 400 * 1024;

/** Bytes y tipo del logo guardado como data URL (PNG o JPEG verificados por su firma), o null. */
export function decodeLogoDataUrl(dataUrl: string | null | undefined): { bytes: Uint8Array; kind: 'png' | 'jpg' } | null {
  const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec((dataUrl ?? '').trim());
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[2], 'base64'));
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isPng) return { bytes, kind: 'png' };
  if (isJpg) return { bytes, kind: 'jpg' };
  return null;
}

/** Valida el logo que carga Calidad: PNG o JPEG real, máximo 400 KB. Devuelve el error en español o null. */
export function getLogoDataUrlError(dataUrl: unknown): string | null {
  if (typeof dataUrl !== 'string' || !dataUrl.trim()) return 'Cargue el logo como imagen PNG o JPEG.';
  const decoded = decodeLogoDataUrl(dataUrl);
  if (!decoded) return 'El logo debe ser una imagen PNG o JPEG.';
  if (decoded.bytes.length > SGC_LOGO_MAX_BYTES) return 'El logo supera 400 KB: use una imagen más liviana.';
  return null;
}
