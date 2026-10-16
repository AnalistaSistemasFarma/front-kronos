import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast';
import {
  appearanceFromHex,
  isCustomPaletteKey,
  toCustomPaletteKey,
} from '../customPalette';
import {
  getPaletteAppearance,
  isValidPaletteKey,
  paletteCustomHex,
  PALETTES,
  PALETTE_APPEARANCE,
  resolvePrimaryColor,
  type PaletteMode,
} from '../palettes';
import { DUO_PALETTES } from '../duoPalettes';
import { darkTokens, lightTokens } from '../tokens';

const WCAG_AA = 4.5;
const MODES: PaletteMode[] = ['light', 'dark'];

describe('paletas de color — accesibilidad WCAG AA', () => {
  it('toda paleta del catálogo tiene apariencia light y dark', () => {
    for (const p of PALETTES) {
      expect(PALETTE_APPEARANCE[p.key]).toBeDefined();
      expect(PALETTE_APPEARANCE[p.key].light).toBeDefined();
      expect(PALETTE_APPEARANCE[p.key].dark).toBeDefined();
    }
  });

  for (const p of PALETTES) {
    for (const mode of MODES) {
      it(`${p.key} (${mode}): acento contra fondo >= 4.5:1`, () => {
        const vars = PALETTE_APPEARANCE[p.key][mode];
        const ratio = contrastRatio(vars.accent, vars.bg);
        expect(
          ratio,
          `${p.key}/${mode} acento ${vars.accent} sobre ${vars.bg} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(WCAG_AA);
      });
    }
  }

  it('sanity: la utilidad de contraste calcula negro/blanco = 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});

describe('combinaciones de dos tonos (fondo pastel)', () => {
  it('son claves válidas, usan la tupla custom con su tono fuerte y tienen apariencia', () => {
    for (const d of DUO_PALETTES) {
      expect(isValidPaletteKey(d.key)).toBe(true);
      expect(resolvePrimaryColor(d.key)).toBe('custom');
      expect(paletteCustomHex(d.key)).toBe(d.accent);
      expect(PALETTE_APPEARANCE[d.key]).toBeDefined();
    }
    expect(paletteCustomHex('gss')).toBeNull();
  });

  it('el fondo claro es el pastel y las tarjetas no son blancas', () => {
    for (const d of DUO_PALETTES) {
      const light = getPaletteAppearance(d.key, 'light');
      expect(light.bg).toBe(d.pastel);
      expect(light.surface.toLowerCase()).not.toBe('#ffffff');
    }
  });

  for (const d of DUO_PALETTES) {
    for (const mode of MODES) {
      it(`${d.key} (${mode}): acento y texto legibles (>= 4.5:1)`, () => {
        const vars = getPaletteAppearance(d.key, mode);
        const tokens = mode === 'light' ? lightTokens : darkTokens;
        expect(contrastRatio(vars.accent, vars.bg), `acento ${vars.accent} / ${vars.bg}`).toBeGreaterThanOrEqual(WCAG_AA);
        expect(contrastRatio(tokens.text, vars.bg)).toBeGreaterThanOrEqual(WCAG_AA);
        expect(contrastRatio(tokens.text, vars.surface)).toBeGreaterThanOrEqual(WCAG_AA);
        expect(contrastRatio(tokens.textMuted, vars.bg), `texto secundario sobre ${vars.bg}`).toBeGreaterThanOrEqual(WCAG_AA);
      });
    }
  }
});

describe('paleta personalizada', () => {
  it('acepta claves custom:#rrggbb y las rechaza si son inválidas', () => {
    expect(isCustomPaletteKey('custom:#2563eb')).toBe(true);
    expect(isValidPaletteKey('custom:#2563eb')).toBe(true);
    expect(isValidPaletteKey('custom:#fff')).toBe(false);
    expect(isValidPaletteKey('custom:blue')).toBe(false);
    expect(toCustomPaletteKey('#1A2B3C')).toBe('custom:#1a2b3c');
    expect(resolvePrimaryColor('custom:#2563eb')).toBe('custom');
  });

  const samples = ['#2563eb', '#fef08a', '#111827', '#dc2626', '#22c55e'];

  for (const hex of samples) {
    for (const mode of MODES) {
      it(`${hex} (${mode}): acento contra fondo >= 4.5:1`, () => {
        const vars = appearanceFromHex(hex)[mode];
        const ratio = contrastRatio(vars.accent, vars.bg);
        expect(
          ratio,
          `${hex}/${mode} acento ${vars.accent} sobre ${vars.bg} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(WCAG_AA);
        expect(getPaletteAppearance(`custom:${hex.toLowerCase()}`, mode)).toEqual(vars);
      });
    }
  }
});
