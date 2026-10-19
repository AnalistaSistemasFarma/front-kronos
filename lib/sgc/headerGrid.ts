import { SgcError } from './errors';

/**
 * GRILLA DEL ENCABEZADO configurable por Calidad (reunión del 2026-10-19:
 * «tiene muy poquitos campos… modificar la grilla y todo, para dejarlo en el
 * control de campos»; amplía la D20) — funciones PURAS (cliente y servidor).
 *
 * FASE 1: la tabla del encabezado de la PRIMERA página deja de ser fija. Cada
 * plantilla puede definir su grilla:
 *   - filas (alto en puntos) y columnas (ancho relativo);
 *   - celdas combinadas (filas y columnas que ocupa cada celda);
 *   - qué CAMPO va en cada celda (logo, nombre, código, versión, página,
 *     elaboró / revisó / aprobó con su recuadro de firma, fecha de emisión,
 *     proceso, tipo documental o un TEXTO FIJO) y su rótulo.
 * Sin grilla, el encabezado institucional de siempre. El encabezado corto de
 * las demás páginas y la altura máxima del encabezado (el espacio que el
 * contenido deja arriba) no cambian: la grilla debe caber en ese espacio.
 * Lo pendiente para la fase 2 está en docs/sgc/padres-hijos-encabezado-grilla.md.
 */

export const SGC_HEADER_FIELDS = [
  'logo',
  'empresa',
  'nombre',
  'codigo',
  'version',
  'pagina',
  'codigo_version_pagina',
  'elaboro',
  'reviso',
  'aprobo',
  'firma_elaboro',
  'firma_reviso',
  'firma_aprobo',
  'fecha_emision',
  'proceso',
  'tipo_documental',
  'proceso_tipo',
  'texto',
  'vacio',
] as const;
export type SgcHeaderField = (typeof SGC_HEADER_FIELDS)[number];

export const SGC_HEADER_FIELD_LABELS: Record<SgcHeaderField, string> = {
  logo: 'Logo de la empresa',
  empresa: 'Nombre de la empresa',
  nombre: 'Nombre del documento',
  codigo: 'Código',
  version: 'Versión',
  pagina: 'Página x de y',
  codigo_version_pagina: 'Código, versión y página (juntos)',
  elaboro: 'Elaboró (nombre y cargo)',
  reviso: 'Revisó (nombre y cargo)',
  aprobo: 'Aprobó (nombre y cargo)',
  firma_elaboro: 'Firma de quien elaboró',
  firma_reviso: 'Firma de quien revisó',
  firma_aprobo: 'Firma de quien aprobó',
  fecha_emision: 'Fecha de emisión',
  proceso: 'Proceso',
  tipo_documental: 'Tipo documental',
  proceso_tipo: 'Proceso y tipo documental (fila inferior)',
  texto: 'Texto fijo',
  vacio: 'Celda vacía',
};

/** Campos que solo pueden ir una vez (todos menos el texto fijo y la celda vacía). */
const UNIQUE_FIELDS = SGC_HEADER_FIELDS.filter((f) => f !== 'texto' && f !== 'vacio');

/** Requisitos de la grilla: cada grupo debe estar cubierto por al menos uno de sus campos. */
export const SGC_HEADER_GRID_REQUIRED: { label: string; any: SgcHeaderField[] }[] = [
  { label: 'el nombre del documento', any: ['nombre'] },
  { label: 'el código', any: ['codigo', 'codigo_version_pagina'] },
  { label: 'la versión', any: ['version', 'codigo_version_pagina'] },
  { label: 'la página x de y', any: ['pagina', 'codigo_version_pagina'] },
  { label: 'la fecha de emisión (se estampa al quedar vigente)', any: ['fecha_emision'] },
  { label: 'la firma de quien elaboró', any: ['firma_elaboro'] },
  { label: 'la firma de quien revisó', any: ['firma_reviso'] },
  { label: 'la firma de quien aprobó', any: ['firma_aprobo'] },
];

export const SGC_HEADER_GRID_MAX_ROWS = 8;
export const SGC_HEADER_GRID_MAX_COLS = 8;
export const SGC_HEADER_ROW_MIN = 12;
export const SGC_HEADER_ROW_MAX = 80;
/** Alto máximo de la tabla (pt): el mismo del encabezado institucional (50 + 30 + 44 + 18), que es el espacio que deja el contenido. */
export const SGC_HEADER_GRID_MAX_HEIGHT = 142;
const TEXT_MAX = 160;
const LABEL_MAX = 40;

export type SgcHeaderAlign = 'left' | 'center';

export interface SgcHeaderGridCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  field: SgcHeaderField;
  /** Rótulo propio (null = el de la plantilla; '' = sin rótulo). */
  label?: string | null;
  /** Texto de la celda «texto fijo». */
  text?: string | null;
  align?: SgcHeaderAlign;
}

export interface SgcHeaderGrid {
  /** Ancho RELATIVO de cada columna (1 a 100). */
  columns: number[];
  /** Alto de cada fila en puntos. */
  rows: number[];
  cells: SgcHeaderGridCell[];
}

/** Punto de partida del editor: el encabezado institucional en 4 columnas. */
export const SGC_DEFAULT_HEADER_GRID: SgcHeaderGrid = {
  columns: [1, 1, 1, 1],
  rows: [50, 30, 44, 18],
  cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, field: 'logo', align: 'center' },
    { row: 0, col: 1, rowSpan: 1, colSpan: 2, field: 'nombre' },
    { row: 0, col: 3, rowSpan: 1, colSpan: 1, field: 'codigo_version_pagina' },
    { row: 1, col: 0, rowSpan: 1, colSpan: 1, field: 'elaboro' },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, field: 'reviso' },
    { row: 1, col: 2, rowSpan: 1, colSpan: 1, field: 'aprobo' },
    { row: 1, col: 3, rowSpan: 1, colSpan: 1, field: 'texto', text: 'FECHA DE EMISIÓN:' },
    { row: 2, col: 0, rowSpan: 1, colSpan: 1, field: 'firma_elaboro' },
    { row: 2, col: 1, rowSpan: 1, colSpan: 1, field: 'firma_reviso' },
    { row: 2, col: 2, rowSpan: 1, colSpan: 1, field: 'firma_aprobo' },
    { row: 2, col: 3, rowSpan: 1, colSpan: 1, field: 'fecha_emision', label: '' },
    { row: 3, col: 0, rowSpan: 1, colSpan: 4, field: 'proceso_tipo' },
  ],
};

export function isSgcHeaderField(v: unknown): v is SgcHeaderField {
  return typeof v === 'string' && (SGC_HEADER_FIELDS as readonly string[]).includes(v);
}

const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Mapa «fila,columna» → índice de la celda que la ocupa (o un error si se solapan o se salen). */
export function occupancy(grid: Pick<SgcHeaderGrid, 'rows' | 'columns' | 'cells'>): { owner: Map<string, number>; errors: string[] } {
  const owner = new Map<string, number>();
  const errors: string[] = [];
  grid.cells.forEach((c, i) => {
    if (c.row + c.rowSpan > grid.rows.length || c.col + c.colSpan > grid.columns.length) {
      errors.push(`La celda ${i + 1} se sale de la grilla.`);
      return;
    }
    for (let r = c.row; r < c.row + c.rowSpan; r++) {
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        const key = `${r},${k}`;
        if (owner.has(key)) errors.push(`Las celdas ${owner.get(key)! + 1} y ${i + 1} se solapan (fila ${r + 1}, columna ${k + 1}).`);
        else owner.set(key, i);
      }
    }
  });
  return { owner, errors };
}

/**
 * Valida y normaliza la grilla que guarda Calidad. Errores en español: la
 * grilla cubre todas las casillas sin solaparse, cabe en el alto del
 * encabezado y trae los campos obligatorios (una sola vez cada uno).
 */
export function normalizeHeaderGrid(raw: unknown): SgcHeaderGrid {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SgcError('La grilla del encabezado no es válida.');
  const r = raw as Record<string, unknown>;
  const cols = Array.isArray(r.columns) ? r.columns : [];
  const rows = Array.isArray(r.rows) ? r.rows : [];
  if (cols.length < 1 || cols.length > SGC_HEADER_GRID_MAX_COLS) throw new SgcError(`La grilla admite de 1 a ${SGC_HEADER_GRID_MAX_COLS} columnas.`);
  if (rows.length < 1 || rows.length > SGC_HEADER_GRID_MAX_ROWS) throw new SgcError(`La grilla admite de 1 a ${SGC_HEADER_GRID_MAX_ROWS} filas.`);
  const columns = cols.map((c, i) => {
    const n = intIn(c, 1, 100);
    if (n === null) throw new SgcError(`El ancho de la columna ${i + 1} debe ser un entero de 1 a 100 (es relativo).`);
    return n;
  });
  const heights = rows.map((h, i) => {
    const n = intIn(h, SGC_HEADER_ROW_MIN, SGC_HEADER_ROW_MAX);
    if (n === null) throw new SgcError(`El alto de la fila ${i + 1} debe estar entre ${SGC_HEADER_ROW_MIN} y ${SGC_HEADER_ROW_MAX} puntos.`);
    return n;
  });
  const total = heights.reduce((a, b) => a + b, 0);
  if (total > SGC_HEADER_GRID_MAX_HEIGHT) throw new SgcError(`La grilla mide ${total} puntos de alto: el máximo es ${SGC_HEADER_GRID_MAX_HEIGHT} (el espacio del encabezado sobre el contenido).`);
  const rawCells = Array.isArray(r.cells) ? r.cells : [];
  if (rawCells.length === 0 || rawCells.length > SGC_HEADER_GRID_MAX_ROWS * SGC_HEADER_GRID_MAX_COLS) throw new SgcError('La grilla no tiene celdas.');
  const cells: SgcHeaderGridCell[] = rawCells.map((c: unknown, i: number) => {
    const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const row = intIn(o.row, 0, heights.length - 1);
    const col = intIn(o.col, 0, columns.length - 1);
    const rowSpan = intIn(o.rowSpan ?? 1, 1, heights.length);
    const colSpan = intIn(o.colSpan ?? 1, 1, columns.length);
    if (row === null || col === null || rowSpan === null || colSpan === null) throw new SgcError(`La celda ${i + 1} tiene una posición inválida.`);
    if (!isSgcHeaderField(o.field)) throw new SgcError(`La celda ${i + 1} tiene un campo no permitido.`);
    const label = o.label === undefined || o.label === null ? null : String(o.label).replace(/\s+/g, ' ').trim().toUpperCase();
    if (label !== null && label.length > LABEL_MAX) throw new SgcError(`El rótulo de la celda ${i + 1} admite máximo ${LABEL_MAX} caracteres.`);
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim() : '';
    if (text.length > TEXT_MAX) throw new SgcError(`El texto fijo de la celda ${i + 1} admite máximo ${TEXT_MAX} caracteres.`);
    if (o.field === 'texto' && text.length < 1) throw new SgcError(`Escriba el texto fijo de la celda ${i + 1}.`);
    const align: SgcHeaderAlign = o.align === 'center' ? 'center' : 'left';
    const cell: SgcHeaderGridCell = { row, col, rowSpan, colSpan, field: o.field };
    if (label !== null) cell.label = label;
    if (o.field === 'texto') cell.text = text;
    if (align === 'center' || o.field === 'logo') cell.align = 'center';
    return cell;
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  const grid: SgcHeaderGrid = { columns, rows: heights, cells };
  const { owner, errors } = occupancy(grid);
  if (errors.length) throw new SgcError(errors[0]);
  const missing: string[] = [];
  for (let rr = 0; rr < heights.length; rr++) for (let k = 0; k < columns.length; k++) if (!owner.has(`${rr},${k}`)) missing.push(`fila ${rr + 1}, columna ${k + 1}`);
  if (missing.length) throw new SgcError(`Hay casillas sin celda: ${missing.slice(0, 4).join('; ')}${missing.length > 4 ? '…' : ''}. Use «Celda vacía» si no lleva nada.`);
  for (const f of UNIQUE_FIELDS) {
    const n = cells.filter((c) => c.field === f).length;
    if (n > 1) throw new SgcError(`«${SGC_HEADER_FIELD_LABELS[f]}» va en una sola celda (está en ${n}).`);
  }
  if (cells.some((c) => c.field === 'codigo_version_pagina') && cells.some((c) => c.field === 'codigo' || c.field === 'version' || c.field === 'pagina')) {
    throw new SgcError('Use «Código, versión y página (juntos)» o las celdas separadas, no ambos.');
  }
  const absent = SGC_HEADER_GRID_REQUIRED.filter((req) => !cells.some((c) => req.any.includes(c.field)));
  if (absent.length) throw new SgcError(`Al encabezado le falta ${absent.map((a) => a.label).join(', ')}.`);
  return grid;
}

export interface SgcRectPt {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Recuadro de cada celda en la página (puntos, origen abajo-izquierda), con
 * los mismos márgenes del encabezado institucional (36 a los lados, 28 arriba).
 */
export function headerGridRects(grid: SgcHeaderGrid, pageWidth: number, pageHeight: number, marginX = 36, top = 28): { cell: SgcHeaderGridCell; rect: SgcRectPt }[] {
  const w = pageWidth - marginX * 2;
  const sum = grid.columns.reduce((a, b) => a + b, 0);
  const xs = [marginX];
  grid.columns.forEach((c) => xs.push(xs[xs.length - 1] + (w * c) / sum));
  const ys = [pageHeight - top];
  grid.rows.forEach((h) => ys.push(ys[ys.length - 1] - h));
  return grid.cells.map((cell) => {
    const x = xs[cell.col];
    const right = xs[cell.col + cell.colSpan];
    const topY = ys[cell.row];
    const bottom = ys[cell.row + cell.rowSpan];
    return { cell, rect: { x, y: bottom, width: right - x, height: topY - bottom } };
  });
}

// ---------------------------------------------------------------------------
// Operaciones del editor visual (combinar, separar, filas y columnas)
// ---------------------------------------------------------------------------

const clone = (g: SgcHeaderGrid): SgcHeaderGrid => ({ columns: [...g.columns], rows: [...g.rows], cells: g.cells.map((c) => ({ ...c })) });

/** Celda a la derecha (misma fila y alto) o abajo (misma columna y ancho) para combinar; null si no se puede. */
function neighbour(g: SgcHeaderGrid, i: number, dir: 'derecha' | 'abajo'): number | null {
  const c = g.cells[i];
  if (!c) return null;
  const j = g.cells.findIndex((o) => (dir === 'derecha' ? o.row === c.row && o.rowSpan === c.rowSpan && o.col === c.col + c.colSpan : o.col === c.col && o.colSpan === c.colSpan && o.row === c.row + c.rowSpan));
  return j >= 0 ? j : null;
}

export function canMerge(g: SgcHeaderGrid, i: number, dir: 'derecha' | 'abajo'): boolean {
  return neighbour(g, i, dir) !== null;
}

/** Combina la celda con la de la derecha o la de abajo (queda el campo de la primera). */
export function mergeCell(g: SgcHeaderGrid, i: number, dir: 'derecha' | 'abajo'): SgcHeaderGrid {
  const j = neighbour(g, i, dir);
  if (j === null) return g;
  const out = clone(g);
  const c = out.cells[i];
  const o = out.cells[j];
  if (dir === 'derecha') c.colSpan += o.colSpan;
  else c.rowSpan += o.rowSpan;
  out.cells.splice(j, 1);
  return out;
}

/** Separa una celda combinada en casillas sueltas (las nuevas quedan vacías). */
export function splitCell(g: SgcHeaderGrid, i: number): SgcHeaderGrid {
  const c = g.cells[i];
  if (!c || (c.rowSpan === 1 && c.colSpan === 1)) return g;
  const out = clone(g);
  const base = out.cells[i];
  const extra: SgcHeaderGridCell[] = [];
  for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) if (r !== c.row || k !== c.col) extra.push({ row: r, col: k, rowSpan: 1, colSpan: 1, field: 'vacio' });
  base.rowSpan = 1;
  base.colSpan = 1;
  out.cells.push(...extra);
  out.cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/** Agrega una fila o columna al final (con celdas vacías). */
export function addLine(g: SgcHeaderGrid, kind: 'fila' | 'columna'): SgcHeaderGrid {
  const out = clone(g);
  if (kind === 'fila') {
    if (out.rows.length >= SGC_HEADER_GRID_MAX_ROWS) return g;
    const r = out.rows.length;
    out.rows.push(SGC_HEADER_ROW_MIN + 6);
    for (let k = 0; k < out.columns.length; k++) out.cells.push({ row: r, col: k, rowSpan: 1, colSpan: 1, field: 'vacio' });
  } else {
    if (out.columns.length >= SGC_HEADER_GRID_MAX_COLS) return g;
    const k = out.columns.length;
    out.columns.push(1);
    for (let r = 0; r < out.rows.length; r++) out.cells.push({ row: r, col: k, rowSpan: 1, colSpan: 1, field: 'vacio' });
  }
  out.cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/** Quita la última fila o columna; las celdas que la ocupaban se recortan (y las que quedan sin espacio se quitan). */
export function removeLastLine(g: SgcHeaderGrid, kind: 'fila' | 'columna'): SgcHeaderGrid {
  const out = clone(g);
  if (kind === 'fila') {
    if (out.rows.length <= 1) return g;
    const last = out.rows.length - 1;
    out.rows.pop();
    out.cells = out.cells.filter((c) => c.row < last).map((c) => (c.row + c.rowSpan > last ? { ...c, rowSpan: last - c.row } : c));
  } else {
    if (out.columns.length <= 1) return g;
    const last = out.columns.length - 1;
    out.columns.pop();
    out.cells = out.cells.filter((c) => c.col < last).map((c) => (c.col + c.colSpan > last ? { ...c, colSpan: last - c.col } : c));
  }
  return out;
}

/** Problemas de la grilla para mostrarlos en el editor sin lanzar (null si está bien). */
export function headerGridProblem(g: SgcHeaderGrid): string | null {
  try {
    normalizeHeaderGrid(g);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
