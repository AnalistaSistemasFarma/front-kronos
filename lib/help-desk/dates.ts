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

export function formatTicketDateIso(
  value: string | Date | null | undefined,
  fallback = '—'
): string {
  const parsed = parseTicketDate(value);
  if (!parsed) return fallback;
  return parsed.toISOString().split('T')[0];
}
