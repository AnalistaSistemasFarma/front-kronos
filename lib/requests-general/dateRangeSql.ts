/**
 * Rango de fechas de los filtros (AAAA-MM-DD) listo para SQL, sin depender de la zona horaria.
 *
 * Se manda como tipo DATE y se compara así:
 *   created_at >= @date_from  AND  created_at < DATEADD(day, 1, @date_to)
 * de modo que "Hasta" incluye TODO ese día y nada del siguiente. (Antes `new Date(d + 'T23:59:59')`
 * se leía en la hora del servidor y metía la madrugada del día siguiente.)
 * Igual que en las pantallas que filtran en el navegador, si vienen al revés se ordenan.
 */
export type SqlDateRange = { from: Date | null; to: Date | null };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' → fecha a medianoche UTC (lo que mssql envía como DATE). Inválida → null. */
export function sqlDateOnly(value: string | null | undefined): Date | null {
  const m = DATE_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Descarta fechas imposibles (p. ej. 2026-02-31).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function sqlDateRange(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): SqlDateRange {
  let from = sqlDateOnly(dateFrom);
  let to = sqlDateOnly(dateTo);
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}
