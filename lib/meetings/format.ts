/**
 * Display helpers of "Mis reuniones" (pure, browser and server). Spanish UI,
 * always in Bogotá time.
 */
export const MEETINGS_HREF = '/process/reuniones';

const TZ = 'America/Bogota';

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

/** "hoy", "ayer" or the short date, relative to `now`. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  const day = key(new Date(iso));
  if (day === key(now)) return 'Hoy';
  if (day === key(new Date(now.getTime() - 86_400_000))) return 'Ayer';
  return formatDay(iso);
}

/** 45 → "45 min", 90 → "1 h 30 min", 120 → "2 h". */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const text = h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${r} min`;
  return min < 0 ? `-${text}` : text;
}

/** Percentage change vs the previous period, or null when there is no base. */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
