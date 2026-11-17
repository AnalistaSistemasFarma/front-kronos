/**
 * Date helpers for the Rooms module, always in Bogotá time.
 *
 * Colombia has no daylight saving time: the offset is fixed (-05:00). Dates
 * travel as `YYYY-MM-DD` strings and times as `HH:mm`; they are converted to
 * instants (ISO with offset) only when talking to Graph. Pure and
 * dependency-free: tested in lib/rooms/__tests__.
 */

export const BOGOTA_OFFSET = '-05:00';
/** Windows time zone name Graph understands for Bogotá. */
export const GRAPH_TIME_ZONE = 'SA Pacific Standard Time';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Is it a real `YYYY-MM-DD` date (not 2026-02-30)? */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Is it an `HH:mm` time between 00:00 and 23:59? */
export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toText(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Formats an `HH:mm` time in Colombian 12-hour style: `8:30 a. m.`, `12:00 p. m.`.
 * `24:00` (end of day) is shown as `12:00 a. m.`. Invalid input is returned as is.
 */
export function formatTime12h(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time ?? '');
  if (!m) return time;
  const h = Number(m[1]) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** `HH:mm` options every `stepMinutes`, labeled in 12-hour format (for selects). */
export function timeOptions(stepMinutes = 15): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  for (let min = 0; min < 24 * 60; min += stepMinutes) {
    const value = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    options.push({ value, label: formatTime12h(value) });
  }
  return options;
}

/** Adds (or subtracts) days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toText(d);
}

/** Same date N years later; Feb 29 becomes Feb 28 on non-leap years. */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const last = daysInMonth(y + years, m);
  return `${String(y + years).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Days in a month (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day of week: 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return utc(date).getUTCDay();
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** Today's date in Bogotá. */
export function todayBogota(now: Date = new Date()): string {
  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** ISO instant with Bogotá offset: `2026-11-17T08:30:00-05:00`. */
export function bogotaIso(date: string, time: string): string {
  return `${date}T${time}:00${BOGOTA_OFFSET}`;
}

/** Epoch milliseconds of a Bogotá date and time. */
export function bogotaMs(date: string, time: string): number {
  return new Date(bogotaIso(date, time)).getTime();
}

/**
 * `calendarView` range for one or more whole days, WITH the -05:00 offset.
 * (`Prefer: outlook.timezone` only changes the response format, not the filter.)
 */
export function dayRange(from: string, to: string = from): { start: string; end: string } {
  return {
    start: `${from}T00:00:00${BOGOTA_OFFSET}`,
    end: `${addDays(to, 1)}T00:00:00${BOGOTA_OFFSET}`,
  };
}

/**
 * Splits the `dateTime` returned by Graph (already in Bogotá time thanks to
 * `Prefer: outlook.timezone`) into local date and time.
 */
export function graphParts(dateTime: string): { date: string; time: string } {
  return { date: dateTime.slice(0, 10), time: dateTime.slice(11, 16) };
}
