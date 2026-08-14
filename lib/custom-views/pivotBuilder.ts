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
 *   - Cada columna de campo usa la ETIQUETA REAL del campo (con espacios y tildes)
 *     como encabezado, entre corchetes: `AS [Tipo de documento]` (ver `prettyAlias`).
 *
 * Los campos de tipo "Tabla" (field_type = 'table', JSON multi-fila en value_text)
 * se EXCLUYEN del pivote y se anotan en un comentario del SQL.
 *
 * CAVEAT del candado: el escáner de palabras clave (`assertReadOnlySql`) busca
 * palabras reservadas (DELETE/UPDATE/INSERT/SET/…) por límite de palabra en TODO
 * el texto, incluidos los alias entre corchetes. Como ahora el alias conserva
 * espacios, una etiqueta que contenga una palabra reservada como palabra suelta
 * (p. ej. "Set de firmas") podría disparar un FALSO POSITIVO y hacer fallar la
 * previsualización/guardado de ESA vista. Es un riesgo acotado (etiquetas en
 * español rara vez son palabras reservadas en inglés); no rompe el resto.
 *
 * Funciones PURAS (sin BD): `cleanFieldLabel`, `prettyAlias`, `buildPivotSql`.
 */

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
 * Limpia la ETIQUETA de un campo para usarla como encabezado de columna LEGIBLE.
 * Conserva espacios, tildes y signos (¿ ?). Limpieza mínima:
 *  - saltos de línea / espacios múltiples → un solo espacio, y trim,
 *  - quita un paréntesis de EJEMPLO al final: "(Ej: ...)", "(ej. ...)", etc.,
 *  - escapa ']' como ']]' para no romper el identificador entre corchetes de
 *    SQL Server (`[...]`).
 * Puede devolver cadena vacía (el llamador aplica un fallback).
 */
export function cleanFieldLabel(label: string): string {
  return (label ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Quita un sufijo de ejemplo entre paréntesis: "(Ej: ...)", "(ej. ...)".
    .replace(/\s*\(\s*ej[:.\s][^)]*\)\s*$/i, '')
    .trim()
    // Escapa ']' para que el corchete de cierre no termine el identificador antes.
    .replace(/]/g, ']]');
}

/**
 * Devuelve el alias LEGIBLE y ÚNICO para una columna de campo (para usar entre
 * corchetes: `AS [<alias>]`). Usa la etiqueta real limpia; si queda vacía, usa
 * `Campo <id>`. Deduplica contra `used` (alias ya usados, en MINÚSCULAS; se muta)
 * agregando sufijo " 2", " 3", …
 */
export function prettyAlias(label: string, used: Set<string>, fieldId: number): string {
  let base = cleanFieldLabel(label);
  if (!base) base = `Campo ${fieldId}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} ${n++}`;
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
    const alias = prettyAlias(f.field_label, used, f.id);
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
