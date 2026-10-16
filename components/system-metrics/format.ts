import type { RangeKey } from './types';

export function formatValue(n: number, maxDigits?: number): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  const digits = maxDigits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(n);
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  if (ms >= 60_000) return `${formatValue(ms / 60_000, 1)} min`;
  if (ms >= 1000) return `${formatValue(ms / 1000, 1)} s`;
  return `${formatInt(ms)} ms`;
}

export function formatBucket(iso: string, range: RangeKey): string {
  const d = new Date(iso);
  if (range === '7d') {
    return new Intl.DateTimeFormat('es-CO', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  }
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** "hace 12 s", "hace 3 min" */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

const PROGRAM_NAMES: Record<string, string> = {
  tiberius: 'Prisma (Kronos)',
  'node-mssql': 'mssql (Kronos)',
  tedious: 'mssql (Kronos)',
};

/** Nombre legible del programa que abrió una sesión en SQL Server (`program_name`). */
export function programLabel(name: string): string {
  if (PROGRAM_NAMES[name]) return PROGRAM_NAMES[name];
  if (name.startsWith('Microsoft SQL Server Management Studio') || name === 'SQL Server Management Studio') {
    return 'SQL Server Management Studio';
  }
  if (name.startsWith('Microsoft Office') || name.startsWith('Microsoft® Excel')) return 'Excel / Office';
  if (name.startsWith('SQLAgent')) return 'Agente SQL (tareas programadas)';
  if (name.startsWith('Microsoft JDBC')) return 'Aplicación Java (JDBC)';
  if (name.startsWith('.Net SqlClient') || name.startsWith('Core Microsoft SqlClient')) return 'Aplicación .NET';
  if (name.startsWith('Power BI') || name.startsWith('Mashup Engine')) return 'Power BI';
  return name || '(sin nombre)';
}

/** Variación porcentual; null si no hay base para comparar. */
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Iniciales para el avatar: "Laura Gómez" → "LG"; sin nombre, del correo. */
export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}
