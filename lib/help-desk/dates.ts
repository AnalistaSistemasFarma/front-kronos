export function parseTicketDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fecha y hora de un ticket: «27 nov 2026, 10:41 a. m.». SQL Server guarda la hora local
 * (SYSDATETIME) sin zona y llega como «…Z», así que se lee en UTC para mostrarla tal cual
 * (lo mismo que el «+5 horas» de las notas). Los tickets creados antes de guardar la hora
 * quedaron a las 00:00: de esos se muestra solo el día.
 */
export function formatTicketDateTime(
  value: string | Date | null | undefined,
  fallback = '—'
): string {
  const parsed =
    typeof value === 'string' && DATE_ONLY.test(value.trim())
      ? new Date(`${value.trim()}T00:00:00Z`)
      : parseTicketDate(value);
  if (!parsed) return fallback;
  const dateOnly =
    parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit', hour12: true }),
  }).format(parsed);
}

/** «Ahora» con la hora local escrita como si fuera UTC, igual a como la devuelve el servidor. */
export function ticketNowIso(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
}

export function formatTicketDateIso(
  value: string | Date | null | undefined,
  fallback = '—'
): string {
  const parsed = parseTicketDate(value);
  if (!parsed) return fallback;
  return parsed.toISOString().split('T')[0];
}
