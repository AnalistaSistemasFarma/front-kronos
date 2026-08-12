import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast';
import { PALETTES, PALETTE_APPEARANCE, type PaletteMode } from '../palettes';

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
