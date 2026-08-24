import type { MantineColorsTuple } from '@mantine/core';
import { contrastRatio } from './contrast';
import { hexToHsl, hslToHex, mixHex, normalizeHex } from './colorMath';
import type { PaletteMode, PaletteVars } from './palettes';

export const CUSTOM_PALETTE_PREFIX = 'custom:';

export function isCustomPaletteKey(key: unknown): key is string {
  return typeof key === 'string' && /^custom:#[0-9a-fA-F]{6}$/.test(key);
}

export function parseCustomPaletteHex(key: string): string | null {
  if (!isCustomPaletteKey(key)) return null;
  return normalizeHex(key.slice(CUSTOM_PALETTE_PREFIX.length));
}

export function toCustomPaletteKey(hex: string): string | null {
  const n = normalizeHex(hex);
  return n ? `${CUSTOM_PALETTE_PREFIX}${n}` : null;
}

function tuneAccent(hex: string, bg: string, mode: PaletteMode): string {
  const [h, ...hsl] = hexToHsl(hex);
  let [s, l] = hsl;
  s = Math.max(38, Math.min(82, s));
  if (mode === 'light') {
    l = Math.min(l, 42);
    while (contrastRatio(hslToHex(h, s, l), bg) < 4.5 && l > 10) l -= 2;
  } else {
    l = Math.max(l, 58);
    while (contrastRatio(hslToHex(h, s, l), bg) < 4.5 && l < 90) l += 2;
  }
  return hslToHex(h, s, l);
}

/** Misma lógica que las paletas fijas: tinte sutil + acento AA. */
export function appearanceFromHex(hex: string): {
  light: PaletteVars;
  dark: PaletteVars;
} {
  const color = normalizeHex(hex) ?? '#2563eb';

  const lightBg = mixHex('#eef1f5', color, 0.1);
  const lightSurface = mixHex('#ffffff', color, 0.045);
  const lightRaised = mixHex('#ffffff', color, 0.03);
  const lightAccent = tuneAccent(color, lightBg, 'light');

  const darkBg = mixHex('#151c2e', color, 0.16);
  const darkSurface = mixHex('#1f2840', color, 0.18);
  const darkRaised = mixHex('#283352', color, 0.2);
  const darkHeader = mixHex('#121824', color, 0.14);
  const darkAccent = tuneAccent(color, darkBg, 'dark');

  return {
    light: {
      bg: lightBg,
      surface: lightSurface,
      surfaceRaised: lightRaised,
      header: lightSurface,
      accent: lightAccent,
      accentHover: mixHex(lightAccent, '#000000', 0.12),
    },
    dark: {
      bg: darkBg,
      surface: darkSurface,
      surfaceRaised: darkRaised,
      header: darkHeader,
      accent: darkAccent,
      accentHover: mixHex(darkAccent, '#ffffff', 0.14),
    },
  };
}

export function mantineTupleFromHex(hex: string): MantineColorsTuple {
  const color = normalizeHex(hex) ?? '#2563eb';
  const [h, s] = hexToHsl(color);
  const lights = [96, 90, 80, 68, 56, 46, 38, 30, 22, 14];
  return lights.map((l) => hslToHex(h, Math.max(35, s), l)) as unknown as MantineColorsTuple;
}
