import { describe, expect, it } from 'vitest';
import { sealPixelAlpha } from '../sealAlpha';

describe('sealPixelAlpha', () => {
  it('vuelve transparente el fondo blanco y casi blanco', () => {
    expect(sealPixelAlpha(255, 255, 255, 255)).toBe(0);
    expect(sealPixelAlpha(240, 242, 238, 255)).toBe(0);
  });

  it('conserva la tinta de cualquier color', () => {
    expect(sealPixelAlpha(20, 40, 160, 255)).toBe(255);
    expect(sealPixelAlpha(200, 30, 30, 255)).toBe(255);
    expect(sealPixelAlpha(0, 0, 0, 255)).toBe(255);
  });

  it('desvanece el borde entre tinta y papel', () => {
    const edge = sealPixelAlpha(218, 218, 218, 255);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('respeta la transparencia que ya traía el PNG', () => {
    expect(sealPixelAlpha(10, 10, 10, 0)).toBe(0);
    expect(sealPixelAlpha(10, 10, 10, 128)).toBe(128);
  });
});
