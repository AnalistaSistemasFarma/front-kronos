/**
 * Catálogo de paletas de color seleccionables por el usuario.
 * Cada paleta mapea a un color base de Mantine (primaryColor) y expone un
 * swatch aproximado en hex para mostrarlo en la interfaz.
 */

export interface PaletteOption {
  /** Clave estable persistida en el perfil / localStorage */
  key: string;
  /** Nombre visible para el usuario */
  label: string;
  /** Color base de Mantine que se inyecta como primaryColor */
  primaryColor: string;
  /** Hex aproximado para pintar el swatch en la UI */
  swatch: string;
}

export const PALETTES: PaletteOption[] = [
  { key: 'gss', label: 'GSS Corporativo', primaryColor: 'blue', swatch: '#1f3a8a' },
  { key: 'ocean', label: 'Océano', primaryColor: 'cyan', swatch: '#0891b2' },
  { key: 'sunset', label: 'Atardecer', primaryColor: 'orange', swatch: '#ea580c' },
  { key: 'forest', label: 'Bosque', primaryColor: 'green', swatch: '#16a34a' },
  { key: 'orchid', label: 'Orquídea', primaryColor: 'grape', swatch: '#9333ea' },
  { key: 'graphite', label: 'Grafito', primaryColor: 'gray', swatch: '#4b5563' },
  { key: 'cherry', label: 'Cereza', primaryColor: 'red', swatch: '#dc2626' },
  { key: 'mint', label: 'Menta', primaryColor: 'teal', swatch: '#0d9488' },
];

/** Paleta por defecto (corporativa GSS → azul) */
export const DEFAULT_PALETTE_KEY = 'gss';

/** Clave de localStorage donde se persiste la paleta elegida */
export const PALETTE_STORAGE_KEY = 'theme-palette';

const PALETTE_KEYS = PALETTES.map((p) => p.key);

/** Set de claves válidas (para validar entradas del usuario/API) */
export const PALETTE_KEY_SET: ReadonlySet<string> = new Set(PALETTE_KEYS);

export function isValidPaletteKey(key: unknown): key is string {
  return typeof key === 'string' && PALETTE_KEY_SET.has(key);
}

/** Resuelve una clave de paleta a su color base de Mantine, con fallback al default */
export function resolvePrimaryColor(key: unknown): string {
  const found = PALETTES.find((p) => p.key === key);
  if (found) return found.primaryColor;
  const fallback = PALETTES.find((p) => p.key === DEFAULT_PALETTE_KEY);
  return fallback ? fallback.primaryColor : 'blue';
}

/** Lee la paleta guardada en localStorage (o null si no hay/ inválida) */
export function readStoredPalette(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isValidPaletteKey(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Refleja la paleta activa como atributo data-palette en :root */
export function applyPaletteToDocument(key: string) {
  if (typeof document === 'undefined') return;
  const resolved = isValidPaletteKey(key) ? key : DEFAULT_PALETTE_KEY;
  document.documentElement.setAttribute('data-palette', resolved);
}
