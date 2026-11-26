/**
 * ANNUAL CALENDAR of a flow (2026-11-26; Calidad OLP: «cronograma de auditorías por área y mes»). Pure helpers.
 */
export interface CalendarItem {
  id: number;
  consecutive: string | null;
  subject: string | null;
  date: string;
  status_req: number;
  id_option: number | null;
}

export const MAX_PLAN_ITEMS = 120;

/** «2027-03-15» → 3; null if it is not a date of that year. */
export function monthOf(date: string, year: number): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m || Number(m[1]) !== year) return null;
  return Number(m[2]);
}

/** Grid: group (option id or 0 = sin grupo) → month (1..12) → items. */
export function buildGrid(items: CalendarItem[], year: number): Map<number, Map<number, CalendarItem[]>> {
  const grid = new Map<number, Map<number, CalendarItem[]>>();
  for (const it of items) {
    const m = monthOf(it.date, year);
    if (!m) continue;
    const g = it.id_option ?? 0;
    const row = grid.get(g) ?? new Map<number, CalendarItem[]>();
    row.set(m, [...(row.get(m) ?? []), it].sort((a, b) => a.date.localeCompare(b.date)));
    grid.set(g, row);
  }
  return grid;
}

export interface PlanItem {
  date: string;
  groupOptionId: number | null;
  subject: string;
}

/** Validates the items of «Nuevo cronograma»: dates of the year, subject, no duplicates of group + date. */
export function validatePlan(raw: unknown, year: number, groupOptions: Set<number> | null): { items: PlanItem[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Agregue al menos una fecha al cronograma.' };
  if (raw.length > MAX_PLAN_ITEMS) return { error: `Máximo ${MAX_PLAN_ITEMS} programaciones por vez.` };
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const [i, x] of raw.entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const date = String(o.date ?? '').slice(0, 10);
    if (!monthOf(date, year)) return { error: `Fila ${i + 1}: la fecha debe ser del año ${year}.` };
    const g = o.groupOptionId === null || o.groupOptionId === undefined || o.groupOptionId === '' ? null : Number(o.groupOptionId);
    if (groupOptions && (g === null || !groupOptions.has(g))) return { error: `Fila ${i + 1}: elija el área.` };
    const subject = String(o.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 255);
    if (subject.length < 3) return { error: `Fila ${i + 1}: escriba el asunto.` };
    const key = `${g ?? 0}|${date}`;
    if (seen.has(key)) return { error: `Fila ${i + 1}: ya hay una programación para esa área y fecha.` };
    seen.add(key);
    items.push({ date, groupOptionId: g, subject });
  }
  return { items };
}
