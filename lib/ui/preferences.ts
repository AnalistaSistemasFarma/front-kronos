/**
 * Preferencias de interfaz por usuario (tabla dbo.user_ui_preference, clave/valor). PURO.
 * Claves permitidas: así el navegador no puede guardar cualquier cosa.
 */
export const PREF_COMPANY_COLORS = 'tables.companyColors';
const WIDTHS_PREFIX = 'tables.widths.';

export function widthsKey(table: string): string {
  return `${WIDTHS_PREFIX}${table}`;
}

export function isAllowedPrefKey(key: string): boolean {
  return key === PREF_COMPANY_COLORS || /^tables\.widths\.[a-z0-9-]{1,60}$/.test(key);
}

/** Valida y normaliza el valor según la clave (null = inválido). */
export function normalizePrefValue(key: string, value: unknown): string | null {
  if (key === PREF_COMPANY_COLORS) return value === true || value === 'true' ? 'true' : 'false';
  if (key.startsWith(WIDTHS_PREFIX)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      const n = Math.round(Number(v));
      if (/^[a-zA-Z0-9_-]{1,40}$/.test(k) && Number.isFinite(n)) out[k] = Math.min(1200, Math.max(60, n));
    }
    return JSON.stringify(out);
  }
  return null;
}

export function parsePrefValue(key: string, raw: string | null | undefined): unknown {
  if (raw == null) return undefined;
  if (key === PREF_COMPANY_COLORS) return raw === 'true';
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
