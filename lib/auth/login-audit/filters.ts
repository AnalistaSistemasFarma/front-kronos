/**
 * Filtros de la consulta de inicios de sesión — PUROS (se prueban en filters.test.ts).
 * Todo lo que llega por la URL se valida aquí; la consulta SQL solo recibe valores limpios.
 */
import {
  COUNTRY_FILTER_INTERNAL,
  COUNTRY_FILTER_UNKNOWN,
  LOGIN_AUDIT_LIMITS,
  isLoginProvider,
  type LoginProvider,
} from './constants';

export interface LoginAuditFilters {
  /** Texto libre: correo/NIT intentado o nombre del usuario. */
  user: string;
  /** Inicio del rango, inclusivo (UTC). */
  from: Date;
  /** Fin del rango, exclusivo (UTC). */
  to: Date;
  /** Código ISO de 2 letras, INTERNA, DESCONOCIDO o null (todos). */
  country: string | null;
  result: 'ok' | 'fallo' | null;
  provider: LoginProvider | null;
  /** Solo filas resaltadas: fuera de Colombia o 3+ fallos seguidos. */
  alertsOnly: boolean;
  page: number;
  limit: number;
}

/** Colombia no tiene horario de verano: el día va de 00:00 a 24:00 en UTC−5. */
const CO_OFFSET = '-05:00';
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RANGE_DAYS = 30;
/** Rango máximo consultable de una vez (protege la base). */
export const MAX_RANGE_DAYS = 366;

function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00${CO_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Fecha de hoy en Colombia como YYYY-MM-DD. */
export function todayInColombia(now: Date = new Date()): string {
  return new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD de hace `days` días en Colombia. */
export function daysAgoInColombia(days: number, now: Date = new Date()): string {
  return todayInColombia(new Date(now.getTime() - days * DAY_MS));
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function parseLoginAuditFilters(params: URLSearchParams, now: Date = new Date()): LoginAuditFilters {
  const toDay = parseDay(params.get('to')) ?? parseDay(todayInColombia(now))!;
  const to = new Date(toDay.getTime() + DAY_MS);
  let from = parseDay(params.get('from')) ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (from >= to) from = new Date(to.getTime() - DAY_MS);
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }

  const rawCountry = (params.get('country') ?? '').trim().toUpperCase();
  const country =
    rawCountry === COUNTRY_FILTER_INTERNAL || rawCountry === COUNTRY_FILTER_UNKNOWN || /^[A-Z]{2}$/.test(rawCountry)
      ? rawCountry
      : null;

  const rawResult = params.get('result');
  const rawProvider = params.get('provider');

  return {
    user: (params.get('user') ?? '').trim().slice(0, 100),
    from,
    to,
    country,
    result: rawResult === 'ok' || rawResult === 'fallo' ? rawResult : null,
    provider: isLoginProvider(rawProvider) ? rawProvider : null,
    alertsOnly: params.get('alerts') === '1',
    page: intParam(params.get('page'), 1, 1, 100_000),
    limit: intParam(params.get('limit'), 25, 1, LOGIN_AUDIT_LIMITS.maxPageSize),
  };
}

/** Escapa los comodines de LIKE de SQL Server para buscar el texto literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_[]/g, (c) => `\\${c}`);
}
