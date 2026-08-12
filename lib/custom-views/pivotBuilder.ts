/**
 * Generador de SQL de vista PIVOTEADA por flujo de trabajo (Constructor de Vistas).
 *
 * Dado un flujo (`process_category`) y sus campos de formulario
 * (`process_form_field`), produce el SQL de una vista con:
 *   - UNA fila por solicitud del flujo (reutiliza la vista legible
 *     `vw_requests_general` para Empresa/Estado/Fecha/Solicitante/NumeroSolicitud,
 *     evitando whitelistear las tablas de empresa/estado/usuario), y
 *   - UNA columna por campo interno del formulario, pivoteando el modelo EAV
 *     (`request_form_value`) con `MAX(CASE WHEN rfv.id_form_field = <id> THEN
 *     COALESCE(pffo.option_label, rfv.value_text) END)`.
 *
 * El SQL se genera EN EL SERVIDOR a partir de datos de catálogo (nunca del input
 * del usuario), y está diseñado para PASAR el candado `assertReadOnlyAgainstCatalog`:
 *   - Solo referencia (FROM/JOIN): vw_requests_general, process_category_request_general,
 *     request_form_value, process_form_field_option — todas whitelisteadas en catalog_source.
 *   - Los alias de columna se sanean para no coincidir con palabras clave
 *     prohibidas ni prefijos peligrosos (ver `safeAlias`).
 *
 * Los campos de tipo "Tabla" (field_type = 'table', JSON multi-fila en value_text)
 * se EXCLUYEN del pivote y se anotan en un comentario del SQL.
 *
 * Funciones PURAS (sin BD): `sanitizeAliasBase`, `safeAlias`, `buildPivotSql`.
 */

import { isReadOnlySafeIdentifier } from '../sql/readonly';

/** field_type de un campo de tipo tabla (JSON multi-fila); se excluye del pivote. */
export const TABLE_FIELD_TYPE = 'table';

/** Campo de formulario mínimo necesario para pivotear. */
export interface PivotFormField {
  id: number;
  field_label: string;
  field_type: string;
  display_order?: number | null;
}

/** Columnas base legibles (de vw_requests_general) que encabezan la vista. */
interface BaseColumn {
  /** Expresión SQL (con alias de tabla r y corchetes donde aplica). */
  expr: string;
  /** Alias de salida. */
  alias: string;
}

const BASE_COLUMNS: BaseColumn[] = [
  { expr: 'r.NumeroSolicitud', alias: 'NumeroSolicitud' },
  { expr: 'r.Empresa', alias: 'Empresa' },
  { expr: 'r.EstadoSolicitud', alias: 'Estado' },
  { expr: 'r.[FechaCreación]', alias: 'FechaCreacion' },
  { expr: 'r.CreadorSolicitud', alias: 'Solicitante' },
];

/**
 * Convierte una etiqueta de campo en la BASE de un identificador SQL:
 * sin tildes, solo [A-Za-z0-9_], espacios/separadores → '_', sin '_' repetidos
 * ni al inicio/fin. Si empieza por dígito, se antepone 'c_'. Vacío → 'campo'.
 *
 * Nota: al colapsar separadores a '_' (que ES un carácter de palabra `\w`), se
 * neutralizan las palabras clave prohibidas EMBEBIDAS (p. ej. "Set de datos" →
 * "Set_de_datos": no hay límite `\b` alrededor de "Set"). El único caso residual
 * —que el alias completo sea una palabra prohibida o un prefijo peligroso— lo
 * resuelve `safeAlias`.
 */
export function sanitizeAliasBase(label: string): string {
  const noAccents = (label ?? '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  let token = noAccents
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!token) token = 'campo';
  if (/^[0-9]/.test(token)) token = `c_${token}`;
  return token;
}

/**
 * Devuelve un alias SQL SEGURO y ÚNICO para un campo:
 *  1) sanea la etiqueta a un identificador válido,
 *  2) si coincide con una palabra prohibida / prefijo peligroso del candado,
 *     lo neutraliza anteponiendo 'c_' (rompe el límite de palabra),
 *  3) evita colisiones con `used` agregando sufijo _2, _3, …
 *
 * `used` acumula los alias ya usados en MINÚSCULAS (se muta).
 */
export function safeAlias(label: string, used: Set<string>): string {
  let base = sanitizeAliasBase(label);
  if (!isReadOnlySafeIdentifier(base)) {
    base = `c_${base}`;
  }
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}_${n++}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export interface BuildPivotArgs {
  /** id de process_category (flujo). Debe ser un entero. */
  processId: number;
  /** Campos del formulario (ya filtrados a active=1; se ordenan por display_order). */
  fields: PivotFormField[];
  /** Nombre del flujo, solo para el comentario del SQL (opcional). */
  processName?: string | null;
}

/**
 * Genera el SQL de la vista pivoteada. PURO (no toca BD).
 *
 * @throws si processId no es un entero.
 */
export function buildPivotSql(args: BuildPivotArgs): string {
  const { processId, fields, processName } = args;
  if (!Number.isInteger(processId)) {
    throw new Error('processId debe ser un entero.');
  }

  // Ordena por display_order y separa los campos pivotables de los de tipo tabla.
  const ordered = [...fields].sort((a, b) => {
    const da = a.display_order ?? 0;
    const db = b.display_order ?? 0;
    if (da !== db) return da - db;
    return a.id - b.id;
  });
  const pivotable = ordered.filter((f) => f.field_type !== TABLE_FIELD_TYPE);
  const excluded = ordered.filter((f) => f.field_type === TABLE_FIELD_TYPE);

  // Alias únicos: siembra con los alias de las columnas base para no colisionar.
  const used = new Set<string>(BASE_COLUMNS.map((c) => c.alias.toLowerCase()));

  const pivotColumns = pivotable.map((f) => {
    const alias = safeAlias(f.field_label, used);
    return `  MAX(CASE WHEN rfv.id_form_field = ${f.id} THEN COALESCE(pffo.option_label, rfv.value_text) END) AS [${alias}]`;
  });

  const baseSelect = BASE_COLUMNS.map((c) => `  ${c.expr} AS ${c.alias}`);
  const selectLines = [...baseSelect, ...pivotColumns].join(',\n');
  const groupByCols = BASE_COLUMNS.map((c) => c.expr).join(', ');

  const header: string[] = [];
  header.push(
    `-- Vista generada automáticamente para el flujo de trabajo #${processId}${
      processName ? ` (${processName.replace(/\r?\n/g, ' ').trim()})` : ''
    }.`
  );
  header.push('-- Una fila por solicitud + los campos del formulario pivoteados como columnas.');
  if (excluded.length > 0) {
    const names = excluded.map((f) => f.field_label.replace(/\r?\n/g, ' ').trim()).join(', ');
    header.push(`-- Campos de tipo Tabla EXCLUIDOS (multi-fila, no pivotables): ${names}.`);
  }

  // NOTA: sin ORDER BY de nivel superior. El motor de vistas envuelve esta
  // consulta como derivada (`SELECT TOP (n) * FROM ( <sql> ) AS _q`), y SQL Server
  // PROHÍBE ORDER BY sin TOP dentro de una tabla derivada. El orden se aplica
  // aparte al consultar la vista.

  // Sin campos pivotables: solo columnas base (evita joins EAV innecesarios).
  if (pivotColumns.length === 0) {
    return [
      ...header,
      'SELECT',
      baseSelect.join(',\n'),
      'FROM vw_requests_general r',
      'INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = r.NumeroSolicitud',
      `WHERE pcrg.id_process_category = ${processId}`,
    ].join('\n');
  }

  return [
    ...header,
    'SELECT',
    selectLines,
    'FROM vw_requests_general r',
    'INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = r.NumeroSolicitud',
    'LEFT JOIN request_form_value rfv ON rfv.id_request_general = r.NumeroSolicitud',
    'LEFT JOIN process_form_field_option pffo ON pffo.id = rfv.id_option',
    `WHERE pcrg.id_process_category = ${processId}`,
    `GROUP BY ${groupByCols}`,
  ].join('\n');
}
