import { describe, expect, it } from 'vitest';
import { availableActions, checkTransition, normalizeState } from './states';

describe('normalizeState', () => {
  it('trata null, vacio y desconocidos como sin estado', () => {
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState('')).toBeNull();
    expect(normalizeState('XYZ')).toBeNull();
  });
  it('normaliza mayusculas y espacios', () => {
    expect(normalizeState(' la ')).toBe('LA');
  });
});

describe('checkTransition', () => {
  it('B -> LA al enviar', () => {
    expect(checkTransition('B', 'enviar')).toEqual({ ok: true, to: 'LA', requiresReason: false });
  });
  it('LA -> A al aprobar, NAD al no aprobar (motivo), ENC al cotizar', () => {
    expect(checkTransition('LA', 'aprobar')).toMatchObject({ ok: true, to: 'A' });
    expect(checkTransition('LA', 'no_aprobar')).toMatchObject({ ok: true, to: 'NAD', requiresReason: true });
    expect(checkTransition('LA', 'cotizar')).toMatchObject({ ok: true, to: 'ENC' });
  });
  it('anular exige motivo y deja el estado en null', () => {
    expect(checkTransition('B', 'anular')).toEqual({ ok: true, to: null, requiresReason: true });
  });
  it('ENC -> LA y NAD -> B', () => {
    expect(checkTransition('ENC', 'reenviar')).toMatchObject({ ok: true, to: 'LA' });
    expect(checkTransition('NAD', 'retomar')).toMatchObject({ ok: true, to: 'B' });
  });
  it('rechaza transiciones desde un estado incorrecto', () => {
    expect(checkTransition('B', 'aprobar').ok).toBe(false);
    expect(checkTransition('A', 'enviar').ok).toBe(false);
    expect(checkTransition(null, 'retomar').ok).toBe(false);
  });
});

describe('availableActions', () => {
  it('lista las acciones por estado', () => {
    expect(availableActions('B')).toEqual(['enviar', 'anular']);
    expect(availableActions('LA')).toEqual(['aprobar', 'no_aprobar', 'cotizar']);
    expect(availableActions('A')).toEqual([]);
    expect(availableActions(null)).toEqual([]);
  });
});
