import { codeFollowsGuide, getDocumentCodeError, inheritsParentNumber, normalizeDocumentCode, parseSequenceFromCode, type SgcCodingGuideInput } from './coding';
import { isSgcConfidentiality, type SgcConfidentiality } from './constants';

/**
 * IMPORTACIÓN DEL LISTADO MAESTRO (Sprint 8, socialización con Calidad OLP del
 * 2026-10-07) — funciones PURAS.
 *
 * Calidad carga el Excel del listado maestro de documentos internos que ya
 * existen. Cada fila crea un documento con SU código de siempre, su versión y
 * su fecha de vigencia, en estado «pendiente de archivo» (el PDF se carga
 * después, Sprint 9). El consecutivo de los documentos nuevos sigue desde el
 * mayor código cargado (lib/sgc/coding.ts → nextSequence).
 *
 * FORMATO DEL EXCEL (la plantilla se descarga desde la pantalla de carga):
 *   Hoja 1, fila 1 = encabezados; desde la fila 2, un documento por fila.
 *   | Columna                      | Obligatoria | Ejemplo        |
 *   | Código                       | sí          | OLP-GCC-02     |
 *   | Nombre del documento         | sí          | Almacenamiento y distribución de producto acondicionado |
 *   | Tipo documental (código)     | sí          | PR             |
 *   | Proceso (código)             | sí          | GCC            |
 *   | Versión                      | sí          | 3              |
 *   | Fecha de vigencia            | sí          | 2024-05-10 (o 10/05/2024, o fecha de Excel) |
 *   | Confidencialidad             | no          | publica | departamento | confidencial (vacío = publica) |
 *   | Código del documento padre   | no          | OLP-GCC-02 (formatos e instructivos de un procedimiento) |
 * Los encabezados se reconocen sin importar mayúsculas, tildes ni espacios, y
 * con algunos sinónimos (p. ej. «Nombre», «Título», «Tipo», «Vigente desde»).
 *
 * Nada se carga si la fila tiene un error; las filas con error se reportan y
 * se guardan en el historial de la importación sin crear el documento.
 */

export const SGC_MASTER_LIST_MAX_ROWS = 3000;

export type SgcMasterListField = 'code' | 'title' | 'documentTypeCode' | 'processCode' | 'versionNumber' | 'effectiveDate' | 'confidentiality' | 'parentCode';

export interface SgcMasterListColumn {
  field: SgcMasterListField;
  header: string;
  required: boolean;
  aliases: readonly string[];
  help: string;
}

export const SGC_MASTER_LIST_COLUMNS: readonly SgcMasterListColumn[] = [
  { field: 'code', header: 'Código', required: true, aliases: ['codigo del documento', 'cod', 'code'], help: 'Código que el documento ya tiene (por ejemplo OLP-GCC-02). No se puede cambiar después.' },
  { field: 'title', header: 'Nombre del documento', required: true, aliases: ['nombre', 'titulo', 'titulo del documento', 'documento'], help: 'Nombre completo del documento.' },
  { field: 'documentTypeCode', header: 'Tipo documental (código)', required: true, aliases: ['tipo documental', 'tipo', 'tipo de documento'], help: 'Código del tipo documental configurado en el SGC (MA, PR, IN, FO…).' },
  { field: 'processCode', header: 'Proceso (código)', required: true, aliases: ['proceso', 'area', 'codigo del proceso'], help: 'Código del proceso o área configurado en el SGC.' },
  { field: 'versionNumber', header: 'Versión', required: true, aliases: ['version', 'version vigente', 'no. version', 'numero de version'], help: 'Número de la versión vigente (1 a 999).' },
  { field: 'effectiveDate', header: 'Fecha de vigencia', required: true, aliases: ['vigente desde', 'fecha de emision', 'fecha vigencia', 'fecha'], help: 'Fecha desde la que rige esa versión (AAAA-MM-DD o DD/MM/AAAA). No puede ser futura.' },
  { field: 'confidentiality', header: 'Confidencialidad', required: false, aliases: ['nivel de confidencialidad'], help: 'publica, departamento o confidencial. Vacío = publica.' },
  { field: 'parentCode', header: 'Código del documento padre', required: false, aliases: ['documento padre', 'codigo padre', 'padre', 'procedimiento asociado'], help: 'Para formatos e instructivos: el código del procedimiento del que se desprenden.' },
];

/** Encabezado normalizado: minúsculas, sin tildes, sin signos ni espacios repetidos. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

const HEADER_INDEX: ReadonlyMap<string, SgcMasterListField> = new Map(
  SGC_MASTER_LIST_COLUMNS.flatMap((c) => [normalizeHeader(c.header), ...c.aliases.map(normalizeHeader)].map((h) => [h, c.field] as const))
);

/** Campo de un encabezado del Excel (o null si no se reconoce). */
export function fieldOfHeader(header: unknown): SgcMasterListField | null {
  return HEADER_INDEX.get(normalizeHeader(header)) ?? null;
}

/** Texto de una celda de ExcelJS (texto, número, fecha, enlace, fórmula, texto enriquecido). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: { text?: unknown }[]; hyperlink?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((r) => String(r.text ?? '')).join('').trim();
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    return '';
  }
  return String(value).trim();
}

export interface SgcMasterListRawRow {
  /** Número de la fila en el Excel (la fila 1 es el encabezado). */
  rowNumber: number;
  values: Partial<Record<SgcMasterListField, string>>;
}

export interface SgcMasterListTable {
  rows: SgcMasterListRawRow[];
  /** Campos obligatorios sin columna en el Excel. */
  missingColumns: SgcMasterListField[];
  /** Encabezados que no se reconocen (se ignoran). */
  ignoredHeaders: string[];
}

/**
 * Convierte la tabla de la primera hoja (fila 1 = encabezados) en filas. Las
 * filas vacías se saltan. `table[i][j]` = valor de la celda (fila i+1, col j+1).
 */
export function parseMasterListTable(table: readonly (readonly unknown[])[]): SgcMasterListTable {
  const header = table[0] ?? [];
  const columns = new Map<number, SgcMasterListField>();
  const ignoredHeaders: string[] = [];
  header.forEach((h, j) => {
    const text = cellText(h);
    if (!text) return;
    const field = fieldOfHeader(text);
    if (field && ![...columns.values()].includes(field)) columns.set(j, field);
    else ignoredHeaders.push(text);
  });
  const present = new Set(columns.values());
  const missingColumns = SGC_MASTER_LIST_COLUMNS.filter((c) => c.required && !present.has(c.field)).map((c) => c.field);
  const rows: SgcMasterListRawRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const values: Partial<Record<SgcMasterListField, string>> = {};
    for (const [j, field] of columns) {
      const text = cellText(table[i]?.[j]);
      if (text) values[field] = text;
    }
    if (Object.keys(values).length) rows.push({ rowNumber: i + 1, values });
  }
  return { rows, missingColumns, ignoredHeaders };
}

/** Rótulo visible de un campo (para los mensajes). */
export function masterListFieldLabel(field: SgcMasterListField): string {
  return SGC_MASTER_LIST_COLUMNS.find((c) => c.field === field)!.header;
}

/**
 * Fecha del listado a «AAAA-MM-DD»: acepta AAAA-MM-DD, DD/MM/AAAA (o con
 * guiones) y el número de serie de Excel. null si no es una fecha válida.
 */
export function parseListDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  let y: number;
  let m: number;
  let d: number;
  let match: RegExpExecArray | null;
  const [whole, fraction = '0'] = s.split('.');
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.split('T')[0]))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d{4,5}$/.test(whole) && /^\d{1,15}$/.test(fraction) && s.split('.').length <= 2) {
    // Serie de Excel (días desde 1899-12-30).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1950) return null;
  return date.toISOString().slice(0, 10);
}

/** Lo que el validador necesita saber de la empresa. */
export interface SgcMasterListContext {
  guide: SgcCodingGuideInput | null;
  /** Procesos ACTIVOS por código. */
  processes: ReadonlyMap<string, { id: number; processTypeCode: string; idDepartment: number | null }>;
  /** Tipos documentales ACTIVOS por código. */
  documentTypes: ReadonlyMap<string, { id: number }>;
  /** Códigos que ya existen en la empresa (en mayúsculas) con su consecutivo registrado. */
  existing: ReadonlyMap<string, { sequence: number | null; processCode: string; processTypeCode: string; documentTypeCode: string }>;
  /** Hoy (AAAA-MM-DD, hora de Colombia). */
  today: string;
}

export interface SgcMasterListItem {
  rowNumber: number;
  code: string;
  title: string;
  documentTypeCode: string;
  processCode: string;
  versionNumber: number | null;
  effectiveDate: string | null;
  confidentiality: SgcConfidentiality;
  parentCode: string | null;
  idProcess: number | null;
  idDocumentType: number | null;
  /** Consecutivo del código según la guía (si la sigue). */
  sequence: number | null;
  status: 'ok' | 'error';
  errors: string[];
  warnings: string[];
}

export interface SgcMasterListValidation {
  items: SgcMasterListItem[];
  summary: { total: number; ok: number; errors: number; warnings: number };
}

/**
 * Valida el listado fila por fila. Error = la fila NO se carga (código
 * inválido o repetido, tipo o proceso inexistente, versión o fecha
 * inválidas…). Advertencia = se carga pero conviene revisarla (el código no
 * sigue la guía de codificación configurada).
 */
export function validateMasterList(rows: readonly SgcMasterListRawRow[], ctx: SgcMasterListContext): SgcMasterListValidation {
  const seen = new Map<string, number>();
  const inFile = new Map<string, { processCode: string; processTypeCode: string; documentTypeCode: string }>();
  for (const r of rows) {
    const code = normalizeDocumentCode(r.values.code ?? '');
    const proc = ctx.processes.get((r.values.processCode ?? '').trim().toUpperCase());
    if (code && !inFile.has(code)) inFile.set(code, { processCode: (r.values.processCode ?? '').trim().toUpperCase(), processTypeCode: proc?.processTypeCode ?? '', documentTypeCode: (r.values.documentTypeCode ?? '').trim().toUpperCase() });
  }
  const items = rows.map((r): SgcMasterListItem => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const v = r.values;
    for (const c of SGC_MASTER_LIST_COLUMNS) if (c.required && !(v[c.field] ?? '').trim()) errors.push(`Falta «${c.header}».`);

    const code = normalizeDocumentCode(v.code ?? '');
    if (code) {
      const e = getDocumentCodeError(code);
      if (e) errors.push(e);
      const first = seen.get(code);
      if (first !== undefined) errors.push(`El código ${code} está repetido (fila ${first}).`);
      else seen.set(code, r.rowNumber);
      if (ctx.existing.has(code)) errors.push(`El código ${code} ya existe en el SGC de la empresa.`);
    }
    const title = (v.title ?? '').trim().replace(/\s+/g, ' ');
    if (title && title.length < 3) errors.push('El nombre del documento es muy corto (mínimo 3 caracteres).');
    if (title.length > 300) errors.push('El nombre del documento admite máximo 300 caracteres.');

    const typeCode = (v.documentTypeCode ?? '').trim().toUpperCase();
    const type = typeCode ? ctx.documentTypes.get(typeCode) : undefined;
    if (typeCode && !type) errors.push(`El tipo documental «${typeCode}» no existe o está inactivo en el SGC de la empresa.`);
    const processCode = (v.processCode ?? '').trim().toUpperCase();
    const process = processCode ? ctx.processes.get(processCode) : undefined;
    if (processCode && !process) errors.push(`El proceso «${processCode}» no existe o está inactivo en el SGC de la empresa.`);

    let versionNumber: number | null = null;
    if ((v.versionNumber ?? '').trim()) {
      const raw = (v.versionNumber ?? '').trim().replace(/^v(ersi[oó]n)?\s*/i, '');
      const n = Number(raw);
      if (!/^[\d.]{1,12}$/.test(raw) || !Number.isInteger(n) || n < 1 || n > 999) errors.push(`La versión «${v.versionNumber}» debe ser un número entero entre 1 y 999.`);
      else versionNumber = n;
    }
    let effectiveDate: string | null = null;
    if ((v.effectiveDate ?? '').trim()) {
      effectiveDate = parseListDate(v.effectiveDate ?? '');
      if (!effectiveDate) errors.push(`La fecha de vigencia «${v.effectiveDate}» no es válida (use AAAA-MM-DD o DD/MM/AAAA).`);
      else if (effectiveDate > ctx.today) {
        errors.push(`La fecha de vigencia ${effectiveDate} es futura.`);
        effectiveDate = null;
      }
    }
    const rawConf = (v.confidentiality ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let confidentiality: SgcConfidentiality = 'publica';
    if (rawConf) {
      if (isSgcConfidentiality(rawConf)) confidentiality = rawConf;
      else errors.push(`La confidencialidad «${v.confidentiality}» no es válida (publica, departamento o confidencial).`);
    }
    if (confidentiality === 'departamento' && process && process.idDepartment === null) {
      errors.push(`Un documento «por departamento» necesita que el proceso ${processCode} tenga departamento dueño.`);
    }

    const parentCode = normalizeDocumentCode(v.parentCode ?? '') || null;
    let parentInfo: { processCode: string; processTypeCode: string; documentTypeCode: string; sequence: number | null } | null = null;
    if (parentCode) {
      if (parentCode === code) errors.push('Un documento no puede ser su propio padre.');
      else {
        const known = ctx.existing.get(parentCode) ?? null;
        const file = inFile.get(parentCode) ?? null;
        if (!known && !file) errors.push(`El documento padre ${parentCode} no está en el listado ni en el SGC de la empresa.`);
        else parentInfo = known ?? { ...file!, sequence: null };
      }
    }

    let sequence: number | null = null;
    if (ctx.guide && code && process && type && !errors.length) {
      const parts = { processTypeCode: process.processTypeCode, processCode, documentTypeCode: typeCode };
      const inherits = inheritsParentNumber(ctx.guide, typeCode);
      if (inherits && !parentCode) {
        warnings.push(`El tipo ${typeCode} hereda el número de su documento padre: indique el «Código del documento padre» para relacionarlo.`);
      }
      const parent = parentCode && parentInfo
        ? { code: parentCode, sequence: parentInfo.sequence, parts: { processTypeCode: parentInfo.processTypeCode, processCode: parentInfo.processCode, documentTypeCode: parentInfo.documentTypeCode } }
        : null;
      if (!(inherits && !parentCode) && !codeFollowsGuide(ctx.guide, parts, code, parent)) {
        warnings.push(`El código ${code} no sigue la guía de codificación configurada; se carga con el código del listado.`);
      }
      if (!inherits) sequence = parseSequenceFromCode(ctx.guide, parts, code);
    }

    return {
      rowNumber: r.rowNumber,
      code,
      title,
      documentTypeCode: typeCode,
      processCode,
      versionNumber,
      effectiveDate,
      confidentiality,
      parentCode,
      idProcess: process?.id ?? null,
      idDocumentType: type?.id ?? null,
      sequence,
      status: errors.length ? 'error' : 'ok',
      errors,
      warnings,
    };
  });
  return {
    items,
    summary: {
      total: items.length,
      ok: items.filter((i) => i.status === 'ok').length,
      errors: items.filter((i) => i.status === 'error').length,
      warnings: items.filter((i) => i.warnings.length > 0).length,
    },
  };
}

/** Error de la forma de las filas que llegan a la API (o null). */
export function getMasterListRowsError(rows: unknown): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return 'El archivo no tiene filas con datos.';
  if (rows.length > SGC_MASTER_LIST_MAX_ROWS) return `El listado admite máximo ${SGC_MASTER_LIST_MAX_ROWS} filas por archivo.`;
  const fields = new Set<string>(SGC_MASTER_LIST_COLUMNS.map((c) => c.field));
  for (const r of rows) {
    const row = r as { rowNumber?: unknown; values?: unknown };
    if (!row || typeof row !== 'object' || !Number.isInteger(row.rowNumber) || (row.rowNumber as number) < 2) return 'Filas inválidas: cada fila necesita su número.';
    if (!row.values || typeof row.values !== 'object' || Array.isArray(row.values)) return 'Filas inválidas: faltan los valores de una fila.';
    for (const [k, val] of Object.entries(row.values as Record<string, unknown>)) {
      if (!fields.has(k)) return `Filas inválidas: columna desconocida «${k}».`;
      if (typeof val !== 'string' || val.length > 1000) return 'Filas inválidas: cada valor debe ser texto (máximo 1.000 caracteres).';
    }
  }
  return null;
}

/** JSON canónico de las filas (para su huella SHA-256 en el historial de la importación). */
export function canonicalRows(rows: readonly SgcMasterListRawRow[]): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((r) => [r.rowNumber, SGC_MASTER_LIST_COLUMNS.map((c) => r.values[c.field] ?? '')])
  );
}
