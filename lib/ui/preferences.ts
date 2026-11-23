/**
 * Preferencias de interfaz por usuario (tabla dbo.user_ui_preference, clave/valor). PURO.
 * Claves permitidas: así el navegador no puede guardar cualquier cosa.
 */
export const PREF_COMPANY_COLORS = 'tables.companyColors';
const WIDTHS_PREFIX = 'tables.widths.';

/**
 * Indicator cards of the request inboxes (SLA row + status cards), per user. Stored as the
 * list of HIDDEN cards, so a card added later shows up by default.
 */
export const PREF_REQUEST_INDICATORS = 'requests.indicators';
export const SLA_INDICATOR_CARDS = ['sla.overdue', 'sla.near_due', 'sla.on_time', 'sla.no_sla', 'sla.paused'] as const;
export const STATUS_INDICATOR_CARDS = [
  'status.all',
  'status.pending',
  'status.returned',
  'status.done',
  'status.cancelled',
  'status.progress',
] as const;
export type IndicatorCard = (typeof SLA_INDICATOR_CARDS)[number] | (typeof STATUS_INDICATOR_CARDS)[number];
const INDICATOR_CARDS: readonly string[] = [...SLA_INDICATOR_CARDS, ...STATUS_INDICATOR_CARDS];

export interface IndicatorPrefs {
  /** «Ocultar indicadores»: hides the whole SLA row. */
  slaHidden: boolean;
  hiddenCards: IndicatorCard[];
}
export const DEFAULT_INDICATOR_PREFS: IndicatorPrefs = { slaHidden: false, hiddenCards: [] };

/** Validated indicator prefs; anything unknown falls back to the defaults. */
export function normalizeIndicatorPrefs(value: unknown): IndicatorPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_INDICATOR_PREFS, hiddenCards: [] };
  const v = value as { slaHidden?: unknown; hiddenCards?: unknown };
  const cards = Array.isArray(v.hiddenCards) ? v.hiddenCards : [];
  const hiddenCards = [...new Set(cards.filter((c): c is IndicatorCard => typeof c === 'string' && INDICATOR_CARDS.includes(c)))];
  return { slaHidden: v.slaHidden === true, hiddenCards };
}

/**
 * «Vencimiento» sort of the request lists, per user and per list. Value: 'none' | 'due_asc' |
 * 'due_desc' (anything else is rejected). Legacy (#1042): the lists no longer read these keys
 * (the SLA card picks the order); still accepted so older open tabs can save without errors.
 */
export const PREF_REQUEST_SORT_PREFIX = 'requests.sort.';
export const REQUEST_SORT_LISTS = ['assigned', 'general'] as const;
export type RequestSortList = (typeof REQUEST_SORT_LISTS)[number];
const REQUEST_SORT_VALUES = ['none', 'due_asc', 'due_desc'];
export const requestSortKey = (list: RequestSortList) => `${PREF_REQUEST_SORT_PREFIX}${list}`;
const isRequestSortKey = (key: string) =>
  key.startsWith(PREF_REQUEST_SORT_PREFIX) &&
  (REQUEST_SORT_LISTS as readonly string[]).includes(key.slice(PREF_REQUEST_SORT_PREFIX.length));

export function widthsKey(table: string): string {
  return `${WIDTHS_PREFIX}${table}`;
}

export function isAllowedPrefKey(key: string): boolean {
  return key === PREF_COMPANY_COLORS || key === PREF_REQUEST_INDICATORS || isRequestSortKey(key) || /^tables\.widths\.[a-z0-9-]{1,60}$/.test(key);
}

/** Valida y normaliza el valor según la clave (null = inválido). */
export function normalizePrefValue(key: string, value: unknown): string | null {
  if (key === PREF_COMPANY_COLORS) return value === true || value === 'true' ? 'true' : 'false';
  if (key === PREF_REQUEST_INDICATORS) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return JSON.stringify(normalizeIndicatorPrefs(value));
  }
  if (isRequestSortKey(key)) {
    return typeof value === 'string' && REQUEST_SORT_VALUES.includes(value) ? JSON.stringify(value) : null;
  }
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
