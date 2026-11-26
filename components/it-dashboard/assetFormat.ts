/** Formatting helpers shared by the Dashboard TI windows. */

export const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

export const formatMoney = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : '—');

/** Lower case, no accents, single spaces: for case-insensitive filters. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function statusColor(status: string | null | undefined): string {
  const s = normalizeText(status);
  if (s === 'en uso') return 'green';
  if (s === 'stock') return 'blue';
  if (s === 'en prestamo') return 'orange';
  if (s === 'baja') return 'red';
  return 'gray';
}

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
