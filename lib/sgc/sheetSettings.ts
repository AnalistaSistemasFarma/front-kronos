import { SgcError } from './errors';

/**
 * AJUSTES DE PRESENTACIÓN de un Excel al convertirlo a PDF — funciones PURAS
 * (cliente y servidor).
 *
 * Reunión del 2026-10-21 con Calidad OLP (y visto bueno de Nicolás Rivera):
 * en la carga inicial, quien carga un formato en Excel puede PREVISUALIZAR la
 * conversión y ajustarla antes de publicarla, o cargarlo de una vez con el
 * ajuste automático. Los ajustes tocan SOLO la presentación (orientación,
 * escala, área de impresión, filas de título, hojas y columnas que salen),
 * nunca el texto de las celdas: el documento ya está aprobado y el PDF
 * vigente debe decir lo mismo que el original. Corregir el contenido es una
 * nueva versión con su flujo.
 */

export const SGC_SHEET_ORIENTATIONS = ['auto', 'vertical', 'horizontal'] as const;
export type SgcSheetOrientation = (typeof SGC_SHEET_ORIENTATIONS)[number];

/** ancho = se achica hasta caber en el ancho de la página; real = tamaño del Excel; escala = el porcentaje indicado. */
export const SGC_SHEET_FITS = ['ancho', 'real', 'escala'] as const;
export type SgcSheetFit = (typeof SGC_SHEET_FITS)[number];

export const SGC_SHEET_ORIENTATION_LABELS: Record<SgcSheetOrientation, string> = {
  auto: 'Automática (horizontal si la hoja es ancha)',
  vertical: 'Vertical',
  horizontal: 'Horizontal',
};

export const SGC_SHEET_FIT_LABELS: Record<SgcSheetFit, string> = {
  ancho: 'Ajustar al ancho de la página',
  real: 'Tamaño real del Excel',
  escala: 'Escala personalizada',
};

export const SGC_SHEET_SCALE_MIN = 25;
export const SGC_SHEET_SCALE_MAX = 150;

export interface SgcSheetOverride {
  /** Nombre de la hoja tal como está en el Excel. */
  name: string;
  /** false = la hoja no sale en el PDF. */
  include: boolean;
  /** Área de impresión «A1:H40»; null = la del Excel (o lo que tenga contenido). */
  printArea: string | null;
  /** Filas de título «1:3» que se repiten en cada página; null = las del Excel. */
  titleRows: string | null;
  /** Columnas que no salen (letras, «C», «AB»). */
  hiddenColumns: string[];
}

export interface SgcSheetSettings {
  orientation: SgcSheetOrientation;
  fit: SgcSheetFit;
  /** Solo con fit = escala (25 a 150). */
  scalePct: number | null;
  sheets: SgcSheetOverride[];
}

export const SGC_DEFAULT_SHEET_SETTINGS: SgcSheetSettings = { orientation: 'auto', fit: 'ancho', scalePct: null, sheets: [] };

const RANGE = /^([A-Z]{1,3})([1-9]\d{0,6}):([A-Z]{1,3})([1-9]\d{0,6})$/;
const ROWS = /^([1-9]\d{0,6}):([1-9]\d{0,6})$/;
const COLUMN = /^[A-Z]{1,3}$/;

/** Número de columna de una letra («A» = 1, «AB» = 28). */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Letra de una columna (1 = «A»). */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/\$/g, '').replace(/\s+/g, '') : '';
}

/** Área de impresión normalizada («a1 : h40» → «A1:H40»), null si viene vacía. Lanza si no es un rango válido. */
export function normalizePrintArea(value: unknown, sheet: string): string | null {
  const v = text(value);
  if (!v) return null;
  const m = RANGE.exec(v);
  if (!m) throw new SgcError(`Área de impresión inválida en la hoja «${sheet}»: escríbala como A1:H40.`);
  const [c1, r1, c2, r2] = [columnIndex(m[1]), Number(m[2]), columnIndex(m[3]), Number(m[4])];
  if (c1 > 16384 || c2 > 16384) throw new SgcError(`Área de impresión inválida en la hoja «${sheet}»: la columna no existe.`);
  return `${columnLetter(Math.min(c1, c2))}${Math.min(r1, r2)}:${columnLetter(Math.max(c1, c2))}${Math.max(r1, r2)}`;
}

/** Filas de título normalizadas («1:3»), null si vienen vacías. Lanza si no es un rango de filas válido. */
export function normalizeTitleRows(value: unknown, sheet: string): string | null {
  const v = text(value);
  if (!v) return null;
  const single = /^[1-9]\d{0,6}$/.test(v) ? `${v}:${v}` : v;
  const m = ROWS.exec(single);
  if (!m) throw new SgcError(`Filas de título inválidas en la hoja «${sheet}»: escríbalas como 1:3.`);
  const a = Math.min(Number(m[1]), Number(m[2]));
  const b = Math.max(Number(m[1]), Number(m[2]));
  if (b - a >= 30) throw new SgcError(`Filas de título inválidas en la hoja «${sheet}»: máximo 30 filas.`);
  return `${a}:${b}`;
}

/** Valida y normaliza los ajustes que llegan del navegador. Sin ajustes = automático. */
export function normalizeSheetSettings(input: unknown): SgcSheetSettings {
  if (input === null || input === undefined || input === '') return { ...SGC_DEFAULT_SHEET_SETTINGS, sheets: [] };
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > 20_000) throw new SgcError('Los ajustes del Excel son demasiado largos.');
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new SgcError('Los ajustes del Excel no son válidos.');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SgcError('Los ajustes del Excel no son válidos.');
  const o = raw as Record<string, unknown>;
  const orientation = (o.orientation ?? 'auto') as SgcSheetOrientation;
  if (!SGC_SHEET_ORIENTATIONS.includes(orientation)) throw new SgcError('Orientación no permitida.');
  const fit = (o.fit ?? 'ancho') as SgcSheetFit;
  if (!SGC_SHEET_FITS.includes(fit)) throw new SgcError('Ajuste de tamaño no permitido.');
  let scalePct: number | null = null;
  if (fit === 'escala') {
    const n = Number(o.scalePct);
    if (!Number.isInteger(n) || n < SGC_SHEET_SCALE_MIN || n > SGC_SHEET_SCALE_MAX) throw new SgcError(`La escala va de ${SGC_SHEET_SCALE_MIN} % a ${SGC_SHEET_SCALE_MAX} %.`);
    scalePct = n;
  }
  const list = o.sheets === undefined || o.sheets === null ? [] : o.sheets;
  if (!Array.isArray(list) || list.length > 50) throw new SgcError('Las hojas del Excel no son válidas.');
  const seen = new Set<string>();
  const sheets: SgcSheetOverride[] = list.map((s) => {
    if (!s || typeof s !== 'object') throw new SgcError('Las hojas del Excel no son válidas.');
    const r = s as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 100) : '';
    if (!name) throw new SgcError('Falta el nombre de una hoja.');
    if (seen.has(name)) throw new SgcError(`La hoja «${name}» está repetida en los ajustes.`);
    seen.add(name);
    const cols = r.hiddenColumns === undefined || r.hiddenColumns === null ? [] : r.hiddenColumns;
    if (!Array.isArray(cols) || cols.length > 200) throw new SgcError(`Columnas ocultas inválidas en la hoja «${name}».`);
    const hiddenColumns = [...new Set(cols.map((c) => text(c)))].filter(Boolean);
    if (hiddenColumns.some((c) => !COLUMN.test(c))) throw new SgcError(`Columnas ocultas inválidas en la hoja «${name}»: use letras (A, B, AB).`);
    hiddenColumns.sort((a, b) => columnIndex(a) - columnIndex(b));
    return { name, include: r.include !== false, printArea: normalizePrintArea(r.printArea, name), titleRows: normalizeTitleRows(r.titleRows, name), hiddenColumns };
  });
  return { orientation, fit, scalePct, sheets };
}

/** ¿Son los ajustes automáticos (sin cambios del usuario)? */
export function isDefaultSheetSettings(s: SgcSheetSettings): boolean {
  return s.orientation === 'auto' && s.fit === 'ancho' && s.sheets.every((x) => x.include && !x.printArea && !x.titleRows && x.hiddenColumns.length === 0);
}

/** Descripción en prosa de los ajustes (para la auditoría y la descripción de la versión). */
export function describeSheetSettings(s: SgcSheetSettings): string {
  if (isDefaultSheetSettings(s)) return 'ajuste automático';
  const parts: string[] = [];
  if (s.orientation !== 'auto') parts.push(`hoja ${s.orientation}`);
  if (s.fit === 'real') parts.push('tamaño real');
  if (s.fit === 'escala') parts.push(`escala ${s.scalePct} %`);
  for (const x of s.sheets) {
    if (!x.include) {
      parts.push(`sin la hoja «${x.name}»`);
      continue;
    }
    const d: string[] = [];
    if (x.printArea) d.push(`área ${x.printArea}`);
    if (x.titleRows) d.push(`títulos ${x.titleRows}`);
    if (x.hiddenColumns.length) d.push(`sin columnas ${x.hiddenColumns.join(', ')}`);
    if (d.length) parts.push(`«${x.name}»: ${d.join(', ')}`);
  }
  return parts.join('; ') || 'ajuste automático';
}
