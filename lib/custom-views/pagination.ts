/**
 * Paginación del lado servidor para el visor de vistas publicadas.
 *
 * El display de una vista ya NO tiene tope de filas: se pagina con SQL Server
 * (`OFFSET/FETCH`) y se devuelve el TOTAL con `COUNT_BIG(*)`. El export sigue un
 * camino aparte (una sola corrida con un tope de seguridad alto).
 *
 * Funciones PURAS (sin BD): `normalizePageParams`, `buildPageSql`, `buildCountSql`,
 * `totalPages`. El SQL de página/total envuelve el `inner` (ya validado por el
 * candado) como tabla derivada `AS _v` / `AS _c` y aplica el mismo WHERE (scope
 * de empresa + filtros) al COUNT y a la PÁGINA.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './access';

export interface PageParams {
  /** Página 1-based ya normalizada (>= 1). */
  page: number;
  /** Tamaño de página normalizado (1..MAX_PAGE_SIZE). */
  pageSize: number;
  /** OFFSET calculado = (page - 1) * pageSize (>= 0). */
  offset: number;
}

/**
 * Normaliza `page` y `pageSize` de entrada (posiblemente inválidos) a valores
 * seguros y calcula el `offset`. `page` mínimo 1; `pageSize` en [1, MAX_PAGE_SIZE]
 * con default DEFAULT_PAGE_SIZE.
 */
export function normalizePageParams(
  page: unknown,
  pageSize: unknown,
  opts?: { defaultPageSize?: number; maxPageSize?: number }
): PageParams {
  const def = opts?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const max = opts?.maxPageSize ?? MAX_PAGE_SIZE;

  const pRaw = Math.floor(Number(page));
  const p = Number.isFinite(pRaw) && pRaw >= 1 ? pRaw : 1;

  const psRaw = Math.floor(Number(pageSize));
  let ps = Number.isFinite(psRaw) && psRaw >= 1 ? psRaw : def;
  if (ps > max) ps = max;

  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

/** Normaliza y limpia el `inner` (SQL de la vista): sin ';' final. */
function cleanInner(inner: string): string {
  return inner.replace(/;\s*$/, '');
}

/** Compone la cláusula WHERE (vacía → '1 = 1'). */
function whereOrTrue(whereClause: string): string {
  const w = (whereClause ?? '').trim();
  return w.length > 0 ? w : '1 = 1';
}

/**
 * SQL de una PÁGINA de resultados. Envuelve `inner` como derivada `_v`, aplica el
 * WHERE y pagina con OFFSET/FETCH. OFFSET/FETCH exige ORDER BY → se usa
 * `ORDER BY (SELECT NULL)` (no-op estable). Los valores van parametrizados:
 * `@__off` (offset) y `@__ps` (page size), además de los `@fN` de los filtros.
 */
export function buildPageSql(inner: string, whereClause: string): string {
  return `SELECT * FROM (\n${cleanInner(inner)}\n) AS _v WHERE ${whereOrTrue(
    whereClause
  )} ORDER BY (SELECT NULL) OFFSET @__off ROWS FETCH NEXT @__ps ROWS ONLY`;
}

/**
 * SQL del TOTAL de filas (mismo `inner` + mismo WHERE), con COUNT_BIG para
 * soportar conteos grandes (> 2^31).
 */
export function buildCountSql(inner: string, whereClause: string): string {
  return `SELECT COUNT_BIG(*) AS total FROM (\n${cleanInner(inner)}\n) AS _c WHERE ${whereOrTrue(
    whereClause
  )}`;
}

/**
 * SQL del EXPORT: una sola corrida con TOP de seguridad (`cap`). Trae hasta `cap`
 * filas (sin paginar) para exportar TODO. El llamador detecta truncamiento
 * comparando rowCount con `cap`.
 */
export function buildExportSql(inner: string, whereClause: string, cap: number): string {
  const safeCap = Number.isInteger(cap) && cap > 0 ? cap : 1;
  return `SELECT TOP (${safeCap}) * FROM (\n${cleanInner(inner)}\n) AS _v WHERE ${whereOrTrue(
    whereClause
  )}`;
}

/** Número total de páginas para un total y un tamaño de página dados. */
export function totalPages(total: number, pageSize: number): number {
  const t = Number(total);
  const ps = Number(pageSize);
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (!Number.isFinite(ps) || ps <= 0) return 0;
  return Math.ceil(t / ps);
}
