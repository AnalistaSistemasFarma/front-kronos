/**
 * Filtros parametrizables del Constructor de Vistas SQL (Incremento 3).
 *
 * El AUTOR define un conjunto de filtros sobre las columnas del RESULTADO de la
 * vista. El CONSUMIDOR envía valores desde la galería; el backend construye un
 * WHERE externo PARAMETRIZADO exclusivamente a partir de esas definiciones
 * (whitelist), nunca del input libre:
 *
 *     SELECT * FROM ( <sql> ) AS _v WHERE <condiciones> AND <scope empresa>
 *
 * Reglas de seguridad:
 *   - El nombre de columna proviene SIEMPRE de la definición guardada y se valida
 *     como identificador simple; se acota entre corchetes ([col]) escapando ']'.
 *   - Los VALORES nunca se interpolan: van como parámetros mssql (@f0, @f1, ...).
 *   - operator -> SQL: eq (=), like (LIKE %v%), in (IN (...)), between (BETWEEN),
 *     gte (>=), lte (<=).
 */

export const FILTER_TYPES = ['text', 'select', 'date', 'daterange', 'number'] as const;
export const FILTER_OPERATORS = ['eq', 'like', 'in', 'between', 'gte', 'lte'] as const;

export type FilterType = (typeof FILTER_TYPES)[number];
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterDef {
  id_saved_view_filter?: number;
  column_name: string;
  label: string;
  filter_type: string;
  operator: string;
  options_json: string | null;
  default_value: string | null;
  required: boolean;
  sort_order: number;
}

/** Identificador de columna del resultado: letras/dígitos/_/espacios, sin metacaracteres. */
export function isValidFilterColumn(col: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_ ]{0,127}$/.test(col.trim());
}

/** Acota un identificador entre corchetes escapando ']' (anti-inyección). */
export function quoteIdent(col: string): string {
  return `[${col.trim().replace(/]/g, ']]')}]`;
}

/**
 * Normaliza y valida el array de definiciones de filtro que envía el autor.
 * Lanza un error claro (para respuesta 400) si algo no es válido.
 */
export function normalizeFilterDefs(input: unknown): FilterDef[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error('El campo "filters" debe ser un arreglo de definiciones de filtro.');
  }

  const out: FilterDef[] = [];
  input.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Filtro #${idx + 1}: definición inválida.`);
    }
    const r = raw as Record<string, unknown>;

    const column_name = typeof r.column_name === 'string' ? r.column_name.trim() : '';
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    const filter_type = typeof r.filter_type === 'string' ? r.filter_type.trim() : '';
    const operator = typeof r.operator === 'string' ? r.operator.trim() : '';

    if (!column_name || !label || !filter_type || !operator) {
      throw new Error(
        `Filtro #${idx + 1}: columna, etiqueta, tipo y operador son obligatorios.`
      );
    }
    if (!isValidFilterColumn(column_name)) {
      throw new Error(
        `Filtro "${label}": la columna "${column_name}" no es un identificador válido.`
      );
    }
    if (!(FILTER_TYPES as readonly string[]).includes(filter_type)) {
      throw new Error(`Filtro "${label}": tipo "${filter_type}" no permitido.`);
    }
    if (!(FILTER_OPERATORS as readonly string[]).includes(operator)) {
      throw new Error(`Filtro "${label}": operador "${operator}" no permitido.`);
    }

    let options_json: string | null = null;
    if (r.options_json != null && r.options_json !== '') {
      options_json =
        typeof r.options_json === 'string'
          ? r.options_json.trim()
          : JSON.stringify(r.options_json);
      if (options_json) {
        try {
          JSON.parse(options_json);
        } catch {
          throw new Error(`Filtro "${label}": las opciones (options_json) no son JSON válido.`);
        }
      }
    }

    let default_value: string | null = null;
    if (r.default_value != null && typeof r.default_value !== 'object') {
      const dv = String(r.default_value).trim();
      default_value = dv ? dv.slice(0, 500) : null;
    }

    const required = r.required === true || r.required === 1 || r.required === 'true';
    const sort_order = Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : idx;

    out.push({
      column_name,
      label,
      filter_type,
      operator,
      options_json,
      default_value,
      required,
      sort_order,
    });
  });

  return out;
}

export interface BuiltFilters {
  /** Cláusula combinada (condiciones unidas por AND), o '' si no hay ninguna. */
  clause: string;
  /** Parámetros mssql a inyectar con request.input(nombre, valor). */
  params: Record<string, unknown>;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** Convierte a lista (para IN): arreglo tal cual, o string separada por comas. */
function toList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.filter((x) => !isEmpty(x));
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return isEmpty(v) ? [] : [v];
}

/** Convierte a par [desde, hasta] (para BETWEEN / daterange). */
function toPair(v: unknown): [unknown, unknown] {
  if (Array.isArray(v)) return [v[0], v[1]];
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.from ?? o.desde ?? o[0], o.to ?? o.hasta ?? o[1]];
  }
  if (typeof v === 'string' && v.includes(',')) {
    const [a, b] = v.split(',').map((s) => s.trim());
    return [a, b];
  }
  return [v, undefined];
}

/** Coacciona un valor según el tipo de filtro (número vs texto/fecha). */
function coerce(def: FilterDef, v: unknown): unknown {
  if (def.filter_type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === 'string' ? v : String(v);
}

/**
 * Construye la cláusula WHERE parametrizada a partir de las definiciones de
 * filtro y los valores del consumidor. Los valores ausentes usan default_value;
 * si tras ello un filtro requerido queda vacío, lanza error (400).
 *
 * @param filters Definiciones guardadas de la vista (whitelist de columnas/operadores).
 * @param values  Valores del consumidor, indexados por id de filtro o por column_name.
 */
export function buildFilterConditions(
  filters: FilterDef[],
  values: Record<string, unknown> | null | undefined
): BuiltFilters {
  const vals = values && typeof values === 'object' ? values : {};
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  let pi = 0;
  const nextName = () => `f${pi++}`;

  for (const f of filters) {
    if (!isValidFilterColumn(f.column_name)) {
      // Defensa en profundidad: nunca interpolar una columna no validada.
      throw new Error(`La columna del filtro "${f.label}" no es válida.`);
    }

    // Lookup del valor: por id del filtro y, en su defecto, por nombre de columna.
    let raw: unknown = undefined;
    if (f.id_saved_view_filter != null) raw = vals[String(f.id_saved_view_filter)];
    if (isEmpty(raw)) raw = vals[f.column_name];

    // Fallback al valor por defecto definido por el autor.
    if (isEmpty(raw) && f.default_value != null && f.default_value !== '') {
      raw = f.default_value;
    }

    if (isEmpty(raw)) {
      if (f.required) {
        throw new Error(`El filtro "${f.label}" es obligatorio.`);
      }
      continue;
    }

    const col = quoteIdent(f.column_name);

    switch (f.operator) {
      case 'eq': {
        const p = nextName();
        params[p] = coerce(f, raw);
        conds.push(`${col} = @${p}`);
        break;
      }
      case 'like': {
        const p = nextName();
        params[p] = `%${String(raw)}%`;
        conds.push(`${col} LIKE @${p}`);
        break;
      }
      case 'gte': {
        const p = nextName();
        params[p] = coerce(f, raw);
        conds.push(`${col} >= @${p}`);
        break;
      }
      case 'lte': {
        const p = nextName();
        params[p] = coerce(f, raw);
        conds.push(`${col} <= @${p}`);
        break;
      }
      case 'in': {
        const list = toList(raw);
        if (list.length === 0) {
          if (f.required) throw new Error(`El filtro "${f.label}" es obligatorio.`);
          break;
        }
        const placeholders = list.map((item) => {
          const p = nextName();
          params[p] = coerce(f, item);
          return `@${p}`;
        });
        conds.push(`${col} IN (${placeholders.join(', ')})`);
        break;
      }
      case 'between': {
        const [a, b] = toPair(raw);
        if (isEmpty(a) || isEmpty(b)) {
          if (f.required) throw new Error(`El filtro "${f.label}" requiere un rango completo.`);
          break;
        }
        const p1 = nextName();
        const p2 = nextName();
        params[p1] = coerce(f, a);
        params[p2] = coerce(f, b);
        conds.push(`${col} BETWEEN @${p1} AND @${p2}`);
        break;
      }
      default:
        // Operador no soportado: se ignora (no debería ocurrir por la validación).
        break;
    }
  }

  return { clause: conds.join(' AND '), params };
}
