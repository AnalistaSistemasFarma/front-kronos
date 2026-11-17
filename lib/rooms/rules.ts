/**
 * Pure rules of the Rooms module: request validation, series expansion,
 * 1-year cap, booking window and conflicts. No network or database: tested in
 * lib/rooms/__tests__/rules.test.ts.
 *
 * User-facing messages are in Spanish (SynerLink UI language).
 */
import { addDays, addYears, bogotaMs, dayOfWeek, diffDays, isDate, isTime } from './dates';

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'specific';

export interface Recurrence {
  type: RecurrenceType;
  /** Daily: Monday to Friday only. */
  weekdaysOnly?: boolean;
  /** Weekly: days of week (0 = Sunday … 6 = Saturday). Defaults to the start date's weekday. */
  daysOfWeek?: number[];
  /** Daily, weekly, monthly and yearly: last date of the series (inclusive). */
  until?: string;
  /** Specific days picked on the calendar (the start date is always included). */
  dates?: string[];
}

export interface BookingRequest {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  subject: string;
  /** Comma-separated emails (Cristian's decision, 2026-10-06: no «;»). */
  attendees: string;
  recurrence: Recurrence;
}

export interface Occurrence {
  date: string;
  startMs: number;
  endMs: number;
}

export interface ExistingEvent {
  startMs: number;
  endMs: number;
  /** Visible subject, or «Ocupado» if the event is private. */
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface Conflict {
  date: string;
  subject: string;
  startTime: string;
  endTime: string;
}

/** Max occurrences in a series (1 year daily = 366). */
export const MAX_OCCURRENCES = 370;
export const MAX_ATTENDEES = 50;
export const MAX_SUBJECT = 255;

const EMAIL_RE = /^[^\s@,;<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

export class BookingError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

/** Splits attendees by comma and validates each email. Returns a de-duplicated list. */
export function parseAttendees(text: string): string[] {
  const list = (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = list.filter((c) => !EMAIL_RE.test(c));
  if (invalid.length > 0) {
    throw new BookingError(
      `Correo de invitado no válido: ${invalid.slice(0, 3).join(', ')}. Separe los correos con coma.`
    );
  }
  const unique = [...new Set(list.map((c) => c.toLowerCase()))];
  if (unique.length > MAX_ATTENDEES) {
    throw new BookingError(`Máximo ${MAX_ATTENDEES} invitados por reserva.`);
  }
  return unique;
}

/** Validates the basic fields of the request (no Graph calls). */
export function validateRequest(r: BookingRequest): void {
  if (!r.roomId) throw new BookingError('Seleccione una sala.');
  if (!isDate(r.date)) throw new BookingError('La fecha no es válida.');
  if (!isTime(r.startTime) || !isTime(r.endTime)) throw new BookingError('La hora no es válida.');
  if (r.endTime <= r.startTime) {
    throw new BookingError('La hora de fin debe ser posterior a la hora de inicio.');
  }
  const subject = (r.subject ?? '').trim();
  if (!subject) throw new BookingError('Escriba el asunto de la reunión.');
  if (subject.length > MAX_SUBJECT) throw new BookingError(`El asunto admite máximo ${MAX_SUBJECT} caracteres.`);
}

/** First date no longer allowed by the 1-year cap. */
export function oneYearCap(start: string): string {
  return addYears(start, 1);
}

function capError(first: string): BookingError {
  return new BookingError(
    `La serie no puede pasar de 1 año: la última fecha permitida es ${addDays(oneYearCap(first), -1)}.`
  );
}

/**
 * Expands the recurrence into the list of dates (sorted, unique).
 * Throws BookingError if the series exceeds 1 year from its first date.
 */
export function expandDates(start: string, rec: Recurrence): string[] {
  if (!isDate(start)) throw new BookingError('La fecha no es válida.');
  const type = rec?.type ?? 'none';
  if (type === 'none') return [start];

  if (type === 'specific') {
    const dates = [...new Set([start, ...(rec.dates ?? [])])];
    if (dates.some((d) => !isDate(d))) throw new BookingError('Hay una fecha no válida en los días específicos.');
    dates.sort();
    if (dates[dates.length - 1] >= oneYearCap(dates[0])) throw capError(dates[0]);
    if (dates.length > MAX_OCCURRENCES) throw new BookingError(`Máximo ${MAX_OCCURRENCES} fechas por serie.`);
    return dates;
  }

  const until = rec.until;
  if (!isDate(until)) throw new BookingError('Indique hasta qué fecha se repite la reunión.');
  if (until < start) throw new BookingError('La fecha final de la serie debe ser posterior a la fecha de inicio.');
  if (until >= oneYearCap(start)) throw capError(start);

  const dates: string[] = [];
  const total = diffDays(start, until);
  const [, startMonth, startDay] = start.split('-').map(Number);
  const weekDays =
    type === 'weekly'
      ? new Set((rec.daysOfWeek?.length ? rec.daysOfWeek : [dayOfWeek(start)]).filter((d) => d >= 0 && d <= 6))
      : null;

  for (let i = 0; i <= total; i++) {
    const d = addDays(start, i);
    const dow = dayOfWeek(d);
    const [, month, day] = d.split('-').map(Number);
    let include = false;
    switch (type) {
      case 'daily':
        include = !rec.weekdaysOnly || (dow >= 1 && dow <= 5);
        break;
      case 'weekly':
        include = weekDays!.has(dow);
        break;
      case 'monthly':
        // Like Graph (absoluteMonthly): months without that day are skipped.
        include = day === startDay;
        break;
      case 'yearly':
        include = day === startDay && month === startMonth;
        break;
      default:
        throw new BookingError('Tipo de repetición no válido.');
    }
    if (include) dates.push(d);
  }
  if (dates.length === 0) throw new BookingError('La repetición elegida no genera ninguna fecha.');
  if (dates.length > MAX_OCCURRENCES) throw new BookingError(`Máximo ${MAX_OCCURRENCES} fechas por serie.`);
  return dates;
}

/** Occurrences (instants) of a request, from its dates. */
export function toOccurrences(dates: string[], startTime: string, endTime: string): Occurrence[] {
  return dates.map((date) => ({
    date,
    startMs: bogotaMs(date, startTime),
    endMs: bogotaMs(date, endTime),
  }));
}

/**
 * Booking window (BookingWindowInDays): Exchange rejects the whole series if
 * it ends outside it, and a single booking outside it may be silently
 * declined. Returns the last allowed date.
 */
export function maxWindowDate(today: string, windowDays: number): string {
  return addDays(today, windowDays);
}

export function validateWindow(dates: string[], today: string, windowDays: number, roomName: string): void {
  const max = maxWindowDate(today, windowDays);
  const last = dates[dates.length - 1];
  if (last > max) {
    throw new BookingError(
      `${roomName} acepta reservas hasta ${windowDays} días adelante: la fecha máxima permitida es ${max}.`,
      400,
      { code: 'WINDOW', maxDate: max, windowDays }
    );
  }
}

/** No bookings in the past (the first occurrence is compared to now). */
export function validateNotPast(occ: Occurrence[], nowMs: number): void {
  if (occ.length > 0 && occ[0].startMs < nowMs) {
    throw new BookingError('No se puede reservar en una fecha u hora que ya pasó.');
  }
}

/** Overlaps between the requested occurrences and the room's existing events. */
export function findConflicts(occ: Occurrence[], existing: ExistingEvent[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const o of occ) {
    for (const e of existing) {
      if (o.startMs < e.endMs && e.startMs < o.endMs) {
        conflicts.push({ date: o.date, subject: e.subject, startTime: e.startTime, endTime: e.endTime });
      }
    }
  }
  return conflicts;
}

/** SALAS_SOLO_LECTURA guard: throws 423 before any write to Graph. */
export function requireWritable(readOnly: boolean, message: string): void {
  if (readOnly) throw new BookingError(message, 423, { code: 'READ_ONLY' });
}

const GRAPH_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Graph recurrence pattern for the regular types. «Specific days» have no
 * pattern: they are created as single events.
 */
export function graphPattern(start: string, rec: Recurrence): Record<string, unknown> | null {
  const [, month, day] = start.split('-').map(Number);
  switch (rec.type) {
    case 'daily':
      return rec.weekdaysOnly
        ? { type: 'weekly', interval: 1, daysOfWeek: GRAPH_DAYS.slice(1, 6), firstDayOfWeek: 'sunday' }
        : { type: 'daily', interval: 1 };
    case 'weekly': {
      const days = rec.daysOfWeek?.length ? rec.daysOfWeek : [dayOfWeek(start)];
      return {
        type: 'weekly',
        interval: 1,
        daysOfWeek: [...new Set(days)].sort().map((d) => GRAPH_DAYS[d]),
        firstDayOfWeek: 'sunday',
      };
    }
    case 'monthly':
      return { type: 'absoluteMonthly', interval: 1, dayOfMonth: day };
    case 'yearly':
      return { type: 'absoluteYearly', interval: 1, dayOfMonth: day, month };
    default:
      return null;
  }
}
