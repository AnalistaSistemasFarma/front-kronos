import {
  appearanceFromHex,
  isCustomPaletteKey,
  parseCustomPaletteHex,
} from './customPalette';

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
  if (typeof key !== 'string') return false;
  if (PALETTE_KEY_SET.has(key)) return true;
  return isCustomPaletteKey(key);
}

/** Resuelve una clave de paleta a su color base de Mantine, con fallback al default */
export function resolvePrimaryColor(key: unknown): string {
  if (typeof key === 'string' && parseCustomPaletteHex(key)) return 'custom';
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

export type PaletteMode = 'light' | 'dark';

/** Variables de superficie/acento derivadas de la paleta para un modo dado */
export interface PaletteVars {
  /** Fondo de la app (near-white/near-black con un lavado MUY sutil del hue) */
  bg: string;
  /** Superficie de tarjetas */
  surface: string;
  /** Superficie elevada */
  surfaceRaised: string;
  /** Fondo del header */
  header: string;
  /** Acento accesible (WCAG AA >= 4.5:1 contra bg de este modo) */
  accent: string;
  /** Acento en hover */
  accentHover: string;
}

/**
 * Apariencia por paleta y por modo. Generado con mezcla lineal del hue de la
 * paleta sobre bases neutras (light: near-white; dark: navy near-black) para
 * un tinte apenas perceptible, y acentos calibrados a WCAG AA (>= 4.5:1)
 * contra el fondo de cada modo. El acento claro sale del tono ~6-9 de la tupla
 * Mantine (oscurecido a mano cuando la tupla no alcanzaba AA: sunset/forest/
 * cherry/mint); el oscuro sale del tono ~3-4. Verificado en
 * lib/theme/__tests__/paletteContrast.test.ts.
 */
export const PALETTE_APPEARANCE: Record<string, { light: PaletteVars; dark: PaletteVars }> = {
  gss: {
    light: { bg: '#e7ebf1', surface: '#fbfbfd', surfaceRaised: '#fcfdfe', header: '#fbfbfd', accent: '#1864ab', accentHover: '#155693' },
    dark: { bg: '#161e33', surface: '#1f2944', surfaceRaised: '#283355', header: '#131a29', accent: '#4dabf7', accentHover: '#66b7f8' },
  },
  ocean: {
    light: { bg: '#e6eef3', surface: '#fafdfd', surfaceRaised: '#fcfefe', header: '#fafdfd', accent: '#0b7285', accentHover: '#096272' },
    dark: { bg: '#142235', surface: '#1e2d46', surfaceRaised: '#263857', header: '#121e2b', accent: '#3bc9db', accentHover: '#56d1e0' },
  },
  sunset: {
    light: { bg: '#eeeced', surface: '#fffcfa', surfaceRaised: '#fffdfc', header: '#fffcfa', accent: '#9a3412', accentHover: '#842d0f' },
    dark: { bg: '#201f2c', surface: '#292a3d', surfaceRaised: '#32354f', header: '#1d1b23', accent: '#ffa94d', accentHover: '#ffb566' },
  },
  forest: {
    light: { bg: '#e6eeef', surface: '#fafdfb', surfaceRaised: '#fcfefd', header: '#fafdfb', accent: '#166534', accentHover: '#13572d' },
    dark: { bg: '#15232f', surface: '#1f2e41', surfaceRaised: '#273952', header: '#121f26', accent: '#69db7c', accentHover: '#7ee08e' },
  },
  orchid: {
    light: { bg: '#ebeaf5', surface: '#fdfbff', surfaceRaised: '#fefdff', header: '#fdfbff', accent: '#9c36b5', accentHover: '#862e9c' },
    dark: { bg: '#1b1d37', surface: '#252949', surfaceRaised: '#2d335a', header: '#18192e', accent: '#da77f2', accentHover: '#df8af4' },
  },
  graphite: {
    light: { bg: '#e8ecf0', surface: '#fbfcfc', surfaceRaised: '#fdfdfd', header: '#fbfcfc', accent: '#495057', accentHover: '#3f454b' },
    dark: { bg: '#181f31', surface: '#212a42', surfaceRaised: '#2a3553', header: '#151b27', accent: '#ced4da', accentHover: '#d5dadf' },
  },
  cherry: {
    light: { bg: '#edeaee', surface: '#fefbfb', surfaceRaised: '#fffcfc', header: '#fefbfb', accent: '#c92a2a', accentHover: '#ad2424' },
    dark: { bg: '#1f1d2e', surface: '#28283f', surfaceRaised: '#313250', header: '#1c1924', accent: '#ff8787', accentHover: '#ff9898' },
  },
  mint: {
    light: { bg: '#e6eef1', surface: '#fafdfd', surfaceRaised: '#fcfefe', header: '#fafdfd', accent: '#0f766e', accentHover: '#0d655f' },
    dark: { bg: '#152233', surface: '#1e2d44', surfaceRaised: '#273855', header: '#121e29', accent: '#38d9a9', accentHover: '#54deb5' },
  },
};

/** Devuelve las variables de apariencia de una paleta+modo, con fallback al default */
export function getPaletteAppearance(key: unknown, mode: PaletteMode): PaletteVars {
  const customHex = typeof key === 'string' ? parseCustomPaletteHex(key) : null;
  if (customHex) {
    return appearanceFromHex(customHex)[mode];
  }
  const entry =
    PALETTE_APPEARANCE[typeof key === 'string' && PALETTE_KEY_SET.has(key) ? key : DEFAULT_PALETTE_KEY];
  return entry[mode];
}

/** Mapa nombre-de-variable-CSS -> valor, para una apariencia dada */
export function paletteVarsToCss(v: PaletteVars): Record<string, string> {
  return {
    '--app-bg': v.bg,
    '--background': v.bg,
    '--mantine-color-body': v.bg,
    '--app-surface': v.surface,
    '--surface': v.surface,
    '--app-surface-raised': v.surfaceRaised,
    '--surface-muted': v.surfaceRaised,
    '--app-header': v.header,
    '--app-accent': v.accent,
    '--app-accent-hover': v.accentHover,
    '--mantine-color-anchor': v.accent,
  };
}

/** Aplica el tinte + acento de la paleta activa como estilos inline en :root */
export function applyPaletteAppearanceToDocument(key: string, mode: PaletteMode) {
  if (typeof document === 'undefined') return;
  const vars = paletteVarsToCss(getPaletteAppearance(key, mode));
  const root = document.documentElement;
  for (const [k, val] of Object.entries(vars)) {
    root.style.setProperty(k, val);
  }
}
