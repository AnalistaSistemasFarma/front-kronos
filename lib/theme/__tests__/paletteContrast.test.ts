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
  PALETTES,
  PALETTE_APPEARANCE,
  resolvePrimaryColor,
  type PaletteMode,
} from '../palettes';

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
