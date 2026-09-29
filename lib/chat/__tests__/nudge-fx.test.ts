import { describe, expect, it } from 'vitest';
import { marcarZumbidoMostrado, zumbidoFresco } from '../nudge-fx';
import { NUDGE_FRESH_MS } from '../people-rules';

describe('efectos del zumbido', () => {
  it('cada zumbido hace su efecto una sola vez (hilo y pulso no se duplican)', () => {
    expect(marcarZumbidoMostrado(901)).toBe(true);
    expect(marcarZumbidoMostrado(901)).toBe(false);
    expect(marcarZumbidoMostrado(902)).toBe(true);
  });

  it('un zumbido viejo ya no hace ruido', () => {
    const ahora = Date.parse('2026-09-29T12:00:00Z');
    expect(zumbidoFresco('2026-09-29T11:59:30Z', ahora)).toBe(true);
    expect(zumbidoFresco(new Date(ahora - NUDGE_FRESH_MS - 1).toISOString(), ahora)).toBe(false);
    expect(zumbidoFresco('no es fecha', ahora)).toBe(false);
  });
});
