/**
 * SLA (ANS) of SynerLink requests (Nicolás Rivera, 2026-11-18).
 *
 * Pure module (no DB, no network) so it can be unit-tested and reused by the API, the
 * baseline script and the UI.
 *
 * Time model
 * ----------
 * KRONOSDB stores DATETIME as Bogotá wall-clock time (GETDATE() on the server) and the
 * `mssql` driver runs with `useUTC: true`, so a value read from the DB is a `Date` whose
 * UTC fields ARE the Bogotá wall clock. Every function here works on that "wall clock in
 * UTC fields" convention. Use `bogotaWallNow()` to get "now" in the same convention.
 * Colombia has no daylight saving time (fixed UTC-5).
 *
 * Business time: Monday–Friday 08:00–17:00 (9 h/day), excluding Colombian holidays
 * (computed by law in `lib/portal/calendario.ts`, no table to maintain).
 *
 * States of an open request (status 1 Abierto, 4 Sin empezar, 5 Por autorizar):
 *   - overdue:  elapsed > SLA
 *   - near_due: remaining <= warnPct % of the SLA (20 % by default)
 *   - on_time:  everything else
 * Returned (7) and draft (6) requests are with the requester: they do not count. A
 * subprocess without SLA yields `no_sla` ("Sin ANS").
 */
import { festivosColombia } from '@/lib/portal/calendario';

export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 17;
export const BUSINESS_HOURS_PER_DAY = BUSINESS_END_HOUR - BUSINESS_START_HOUR;
export const DEFAULT_WARN_PCT = 20;
const BOGOTA_OFFSET_MS = 5 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type SlaUnit = 'business_hours' | 'business_days' | 'calendar_hours';
export const SLA_UNITS: SlaUnit[] = ['business_hours', 'business_days', 'calendar_hours'];
export type SlaState = 'overdue' | 'near_due' | 'on_time' | 'no_sla';

/** Request statuses whose SLA clock runs (status_case). */
export const SLA_RUNNING_STATUSES = [1, 4, 5] as const;
export const REQUEST_RETURNED_STATUS = 7;

export interface SlaConfig {
  value: number | null | undefined;
  unit: string | null | undefined;
  warnPct?: number | null;
}

export interface SlaPause {
  pausedAt: Date;
  /** null = still paused. */
  resumedAt: Date | null;
}

/** "Now" as Bogotá wall clock in UTC fields (same convention as the DB values). */
export function bogotaWallNow(now: Date = new Date()): Date {
  return new Date(now.getTime() - BOGOTA_OFFSET_MS);
}

const holidayCache = new Map<number, Set<string>>();
function holidays(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    set = new Set(festivosColombia(year).map((f) => f.fecha));
    holidayCache.set(year, set);
  }
  return set;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** True for Monday–Friday that is not a Colombian holiday (date read from UTC fields). */
export function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays(d.getUTCFullYear()).has(isoDay(d));
}

/** Business milliseconds between two wall-clock instants (0 if end <= start). */
export function businessMsBetween(start: Date, end: Date): number {
  const s = start.getTime();
  const e = end.getTime();
  if (!(e > s)) return 0;
  let total = 0;
  // Walk day by day; requests live weeks or months, so this is cheap.
  let day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (; day < e; day += DAY_MS) {
    const d = new Date(day);
    if (!isBusinessDay(d)) continue;
    const ws = day + BUSINESS_START_HOUR * HOUR_MS;
    const we = day + BUSINESS_END_HOUR * HOUR_MS;
    const from = Math.max(ws, s);
    const to = Math.min(we, e);
    if (to > from) total += to - from;
  }
  return total;
}

export const businessHoursBetween = (start: Date, end: Date) => businessMsBetween(start, end) / HOUR_MS;

/** SLA length in milliseconds of its own clock (business or calendar). null = no SLA. */
export function slaDurationMs(cfg: SlaConfig): number | null {
  const v = Number(cfg.value);
  if (!cfg.value || !Number.isFinite(v) || v <= 0) return null;
  switch (cfg.unit) {
    case 'business_days':
      return v * BUSINESS_HOURS_PER_DAY * HOUR_MS;
    case 'calendar_hours':
    case 'business_hours':
      return v * HOUR_MS;
    default:
      // Unknown unit: treat the value as business hours (the baseline stores hours).
      return v * HOUR_MS;
  }
}

/** Elapsed time on the SLA clock from `createdAt` to `now`, minus pauses. */
export function slaElapsedMs(createdAt: Date, now: Date, unit: string | null | undefined, pauses: SlaPause[] = []): number {
  const measure = unit === 'calendar_hours'
    ? (a: Date, b: Date) => Math.max(0, b.getTime() - a.getTime())
    : businessMsBetween;
  let elapsed = measure(createdAt, now);
  for (const p of pauses) {
    const from = new Date(Math.max(p.pausedAt.getTime(), createdAt.getTime()));
    const to = new Date(Math.min((p.resumedAt ?? now).getTime(), now.getTime()));
    if (to > from) elapsed -= measure(from, to);
  }
  return Math.max(0, elapsed);
}

export interface SlaEvaluation {
  state: SlaState;
  /** Elapsed time on the SLA clock, hours. */
  elapsedHours: number;
  /** SLA length, hours of its clock. null when there is no SLA. */
  slaHours: number | null;
  /** Remaining hours (negative when overdue). null when there is no SLA. */
  remainingHours: number | null;
}

export function evaluateSla(createdAt: Date, cfg: SlaConfig, now: Date, pauses: SlaPause[] = []): SlaEvaluation {
  const elapsedMs = slaElapsedMs(createdAt, now, cfg.unit, pauses);
  const slaMs = slaDurationMs(cfg);
  const elapsedHours = elapsedMs / HOUR_MS;
  if (slaMs == null) return { state: 'no_sla', elapsedHours, slaHours: null, remainingHours: null };
  const remainingMs = slaMs - elapsedMs;
  const warnPct = cfg.warnPct && cfg.warnPct > 0 && cfg.warnPct < 100 ? cfg.warnPct : DEFAULT_WARN_PCT;
  let state: SlaState;
  if (remainingMs < 0) state = 'overdue';
  else if (remainingMs <= (slaMs * warnPct) / 100) state = 'near_due';
  else state = 'on_time';
  return { state, elapsedHours, slaHours: slaMs / HOUR_MS, remainingHours: remainingMs / HOUR_MS };
}

/**
 * Baseline rounding (Nicolás, 2026-11-18): the average resolution time rounded UP to whole
 * business hours, or to whole business days (9 h) when it is 9 h or more. Result in hours.
 */
export function roundBaselineHours(avgHours: number): number | null {
  if (!Number.isFinite(avgHours) || avgHours <= 0) return null;
  const h = Math.max(1, Math.ceil(avgHours - 1e-9));
  if (h < BUSINESS_HOURS_PER_DAY) return h;
  return Math.ceil(avgHours / BUSINESS_HOURS_PER_DAY - 1e-9) * BUSINESS_HOURS_PER_DAY;
}

/** Spanish label of an SLA: "3 días hábiles", "5 horas hábiles", "24 horas calendario". */
export function formatSla(cfg: SlaConfig): string {
  const v = Number(cfg.value);
  if (!cfg.value || !Number.isFinite(v) || v <= 0) return 'Sin ANS';
  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  if (cfg.unit === 'business_days') return plural(v, 'día hábil', 'días hábiles');
  if (cfg.unit === 'calendar_hours') return plural(v, 'hora calendario', 'horas calendario');
  if (v >= BUSINESS_HOURS_PER_DAY && v % BUSINESS_HOURS_PER_DAY === 0) {
    return plural(v / BUSINESS_HOURS_PER_DAY, 'día hábil', 'días hábiles');
  }
  return plural(v, 'hora hábil', 'horas hábiles');
}

/** Short Spanish label of the remaining time, e.g. "Vence en 3 h" / "Vencida hace 2 d". */
export function formatRemaining(remainingHours: number | null): string {
  if (remainingHours == null) return '';
  const abs = Math.abs(remainingHours);
  const txt = abs >= BUSINESS_HOURS_PER_DAY
    ? `${Math.floor(abs / BUSINESS_HOURS_PER_DAY)} d`
    : `${Math.max(1, Math.round(abs))} h`;
  return remainingHours < 0 ? `Vencida hace ${txt}` : `Vence en ${txt}`;
}

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  overdue: 'Vencidos',
  near_due: 'Próximos a vencer',
  on_time: 'Dentro del tiempo',
  no_sla: 'Sin ANS',
};

/** Parses/validates the admin input. Returns null config when value is empty. */
export function parseSlaInput(raw: { value?: unknown; unit?: unknown; warnPct?: unknown }):
  | { ok: true; value: number | null; unit: SlaUnit | null; warnPct: number | null }
  | { ok: false; error: string } {
  const empty = raw.value === null || raw.value === undefined || raw.value === '';
  if (empty) return { ok: true, value: null, unit: null, warnPct: null };
  const value = Number(raw.value);
  if (!Number.isInteger(value) || value <= 0 || value > 10_000) {
    return { ok: false, error: 'El ANS debe ser un número entero mayor que cero.' };
  }
  const unit = String(raw.unit ?? 'business_hours') as SlaUnit;
  if (!SLA_UNITS.includes(unit)) return { ok: false, error: 'Unidad de ANS no válida.' };
  let warnPct: number | null = null;
  if (raw.warnPct !== null && raw.warnPct !== undefined && raw.warnPct !== '') {
    warnPct = Number(raw.warnPct);
    if (!Number.isInteger(warnPct) || warnPct < 1 || warnPct > 99) {
      return { ok: false, error: 'El umbral de «próximo a vencer» debe estar entre 1 y 99 %.' };
    }
  }
  return { ok: true, value, unit, warnPct };
}
