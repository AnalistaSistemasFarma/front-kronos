import { mixHex } from './colorMath';
import { appearanceFromHex, tuneAccent } from './customPalette';
import type { PaletteVars } from './palettes';

/**
 * Combinaciones de dos tonos (como los temas de Chrome): un tono fuerte para botones y acentos,
 * y su pastel para el fondo de las páginas y las tarjetas, en lugar del blanco.
 *
 * Se eligen en el perfil junto a las paletas de un color y usan la misma lógica global
 * (variables --app-*, primaryColor de Mantine y el script del primer pintado). El acento se
 * ajusta solo hasta tener contraste AA contra su pastel (lib/theme/__tests__/paletteContrast).
 */

export type DuoPalette = {
  /** Clave estable guardada en el perfil (prefijo duo-). */
  key: string;
  label: string;
  /** Tono fuerte: botones, enlaces, acentos. */
  accent: string;
  /** Tono pastel: fondo de páginas (las tarjetas usan una versión aún más clara). */
  pastel: string;
};

export const DUO_PALETTES: DuoPalette[] = [
  { key: 'duo-gss', label: 'GSS suave', accent: '#1f3a8a', pastel: '#e4eaf8' },
  { key: 'duo-cielo', label: 'Cielo', accent: '#1d5fa8', pastel: '#e1eefa' },
  { key: 'duo-lavanda', label: 'Lavanda', accent: '#5b3fa8', pastel: '#ece6f8' },
  { key: 'duo-ciruela', label: 'Ciruela', accent: '#6b2a6e', pastel: '#f3e4f3' },
  { key: 'duo-rosa', label: 'Rosa', accent: '#a3245e', pastel: '#f9e4ee' },
  { key: 'duo-coral', label: 'Coral', accent: '#b3323f', pastel: '#fbe5e6' },
  { key: 'duo-durazno', label: 'Durazno', accent: '#a8481c', pastel: '#fbe9dd' },
  { key: 'duo-arena', label: 'Arena', accent: '#7a5a1e', pastel: '#f4ecdb' },
  { key: 'duo-oliva', label: 'Oliva', accent: '#5a6420', pastel: '#eef0dc' },
  { key: 'duo-salvia', label: 'Salvia', accent: '#2f6b4f', pastel: '#e3efe7' },
  { key: 'duo-turquesa', label: 'Turquesa', accent: '#0e6e72', pastel: '#dff2f1' },
  { key: 'duo-pizarra', label: 'Pizarra', accent: '#3b4a63', pastel: '#e6eaf1' },
];

export function findDuoPalette(key: unknown): DuoPalette | null {
  return typeof key === 'string' ? DUO_PALETTES.find((d) => d.key === key) ?? null : null;
}

/**
 * Claro: el pastel es el fondo y las tarjetas son un pastel más suave (nunca blanco puro), con
 * el acento oscurecido lo necesario para leerse. Oscuro: misma lógica que un color personalizado.
 */
export function appearanceFromDuo(duo: Pick<DuoPalette, 'accent' | 'pastel'>): {
  light: PaletteVars;
  dark: PaletteVars;
} {
  const bg = duo.pastel;
  const surface = mixHex('#ffffff', duo.pastel, 0.45);
  const raised = mixHex('#ffffff', duo.pastel, 0.3);
  const accent = tuneAccent(duo.accent, bg, 'light');
  return {
    light: {
      bg,
      surface,
      surfaceRaised: raised,
      header: surface,
      accent,
      accentHover: mixHex(accent, '#000000', 0.12),
    },
    dark: appearanceFromHex(duo.accent).dark,
  };
}
