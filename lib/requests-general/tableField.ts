/**
 * Utilidades PURAS para el tipo de campo "Tabla" de Solicitudes Generales.
 *
 * Un campo de tipo `table` permite al admin definir COLUMNAS tipadas en la
 * parametrización del flujo; al crear la solicitud el usuario agrega FILAS
 * respetando el tipo de cada columna.
 *
 * - La DEFINICIÓN de columnas se guarda como JSON en `process_form_field.config_json`
 *   con la forma `{ "columns": [{ key, label, type, required, options? }] }`.
 * - Las FILAS diligenciadas se guardan como JSON en `request_form_value.value_text`
 *   con la forma `{ "rows": [{ [colKey]: valor, ... }] }`.
 *
 * Este módulo es PURO (sin Prisma ni imports de servidor) para poder importarse
 * tanto desde los componentes de cliente (builder y create-request) como desde
 * las rutas del servidor. El resolver SAP por empresa vive en la ruta del servidor.
 */

import { SAP_SOURCE_KEYS } from './sapSources';

/** field_type que identifica un campo de tipo tabla. */
export const TABLE_FIELD_TYPE = 'table';

/** Tipos de columna disponibles dentro de una tabla (renderer por celda). */
export type TableColumnType =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'select'
  | 'yesno'
  | 'sap_items'
  | 'sap_business_partners';

/** Catálogo de tipos de columna para poblar el Select del builder. */
export const TABLE_COLUMN_TYPES: { value: TableColumnType; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'money', label: 'Moneda (COP)' },
  { value: 'date', label: 'Fecha' },
  { value: 'select', label: 'Lista (opciones)' },
  { value: 'yesno', label: 'Sí / No' },
  { value: 'sap_items', label: 'Artículo (SAP)' },
  { value: 'sap_business_partners', label: 'Socio de negocio (SAP)' },
];

const VALID_COLUMN_TYPES = new Set<string>(TABLE_COLUMN_TYPES.map((t) => t.value));

/** Definición de una columna de la tabla. */
export interface TableColumn {
  /** Clave estable e interna de la columna (identifica el valor en cada fila). */
  key: string;
  /** Etiqueta visible en el encabezado. */
  label: string;
  /** Tipo de dato/renderer de la columna. */
  type: TableColumnType;
  /** Si es obligatoria, ninguna fila puede dejar esta celda vacía. */
  required: boolean;
  /** Opciones (solo para type='select'). */
  options?: string[];
}

/** Config completa serializada en config_json. */
export interface TableConfig {
  columns: TableColumn[];
}

/** Una fila diligenciada: mapa columnKey -> valor. */
export type TableRow = Record<string, unknown>;

/** Valor completo serializado en value_text. */
export interface TableValue {
  rows: TableRow[];
}

/** True si el type indicado corresponde a una columna SAP curada. */
export function isSapColumn(type: string | null | undefined): boolean {
  return !!type && SAP_SOURCE_KEYS.includes(type);
}

/**
 * Parsea el config_json de un campo tabla a una estructura segura.
 * Nunca lanza: ante datos corruptos devuelve `{ columns: [] }`.
 */
export function parseTableConfig(configJson: string | null | undefined): TableConfig {
  if (!configJson || typeof configJson !== 'string') return { columns: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(configJson);
  } catch {
    return { columns: [] };
  }
  const cols = (raw as { columns?: unknown })?.columns;
  if (!Array.isArray(cols)) return { columns: [] };

  const columns: TableColumn[] = [];
  for (const c of cols) {
    if (!c || typeof c !== 'object') continue;
    const obj = c as Record<string, unknown>;
    const key = typeof obj.key === 'string' ? obj.key.trim() : '';
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    const type =
      typeof obj.type === 'string' && VALID_COLUMN_TYPES.has(obj.type)
        ? (obj.type as TableColumnType)
        : 'text';
    if (!key || !label) continue;
    const column: TableColumn = {
      key,
      label,
      type,
      required: Boolean(obj.required),
    };
    if (type === 'select') {
      const opts = Array.isArray(obj.options) ? obj.options : [];
      column.options = opts
        .map((o) => (typeof o === 'string' ? o.trim() : ''))
        .filter((o) => o.length > 0);
    }
    columns.push(column);
  }
  return { columns };
}

/** Serializa una lista de columnas a config_json (string). */
export function serializeTableConfig(columns: TableColumn[]): string {
  return JSON.stringify({ columns });
}

/**
 * Parsea el value_text de una respuesta de tipo tabla a filas seguras.
 * Nunca lanza: ante datos corruptos devuelve `{ rows: [] }`.
 */
export function parseTableValue(valueText: string | null | undefined): TableValue {
  if (!valueText || typeof valueText !== 'string') return { rows: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(valueText);
  } catch {
    return { rows: [] };
  }
  const rows = (raw as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return { rows: [] };
  const clean: TableRow[] = [];
  for (const r of rows) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      clean.push(r as TableRow);
    }
  }
  return { rows: clean };
}

/** Serializa filas a value_text (string). */
export function serializeTableValue(rows: TableRow[]): string {
  return JSON.stringify({ rows });
}

/** True si el valor de una celda se considera vacío. */
export function isCellEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** True si una fila entera está vacía (todas sus celdas vacías). */
export function isRowEmpty(row: TableRow, columns: TableColumn[]): boolean {
  return columns.every((c) => isCellEmpty(row[c.key]));
}

/**
 * Valida las filas de un campo tabla contra su definición de columnas.
 * Devuelve un mensaje de error (string) o `null` si es válido.
 *
 * Reglas:
 * - Si el campo es obligatorio → debe haber al menos una fila (no vacía).
 * - Cada columna `required` no puede quedar vacía en ninguna fila diligenciada.
 * - Las filas totalmente vacías se ignoran (no cuentan ni disparan error).
 */
export function validateTableRows(
  columns: TableColumn[],
  rows: TableRow[],
  fieldRequired: boolean,
  fieldLabel = 'la tabla'
): string | null {
  const nonEmptyRows = rows.filter((r) => !isRowEmpty(r, columns));

  if (fieldRequired && nonEmptyRows.length === 0) {
    return `Debe agregar al menos una fila en: ${fieldLabel}`;
  }

  for (let i = 0; i < nonEmptyRows.length; i++) {
    const row = nonEmptyRows[i];
    for (const col of columns) {
      if (col.required && isCellEmpty(row[col.key])) {
        return `Fila ${i + 1}: "${col.label}" es obligatorio en ${fieldLabel}`;
      }
    }
  }
  return null;
}

/** Genera una clave de columna estable y única dentro de una lista dada. */
export function newColumnKey(existing: TableColumn[]): string {
  const used = new Set(existing.map((c) => c.key));
  let n = existing.length + 1;
  let key = `col_${n}`;
  while (used.has(key)) {
    n += 1;
    key = `col_${n}`;
  }
  return key;
}
