import { describe, expect, it } from 'vitest';
import { availableActions, checkTransition, isLegacyState, normalizeState } from './states';

describe('normalizeState', () => {
  it('trata null, vacio, desconocidos y heredados como no operables', () => {
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState('')).toBeNull();
    expect(normalizeState('XYZ')).toBeNull();
    expect(normalizeState('AC')).toBeNull();
  });
  it('normaliza mayusculas y espacios', () => {
    expect(normalizeState(' aeda ')).toBe('AEDA');
  });
});

describe('isLegacyState', () => {
  it('reconoce AC, EAC, NAC y ER', () => {
    expect(isLegacyState('AC')).toBe(true);
    expect(isLegacyState('eac')).toBe(true);
    expect(isLegacyState('B')).toBe(false);
    expect(isLegacyState(null)).toBe(false);
  });
});

describe('checkTransition', () => {
  it('enviar y reenviar los decide el motor de reglas', () => {
    expect(checkTransition('B', 'enviar')).toEqual({ ok: true, to: 'reglas', requiresReason: false });
    expect(checkTransition('NAP', 'reenviar')).toMatchObject({ ok: true, to: 'reglas' });
  });
  it('cadena de precios: aprobar pasa por la puerta de cupo, devolver exige motivo', () => {
    expect(checkTransition('AP', 'aprobar_precios')).toMatchObject({ ok: true, to: 'reglas' });
    expect(checkTransition('AP', 'devolver_precios')).toEqual({ ok: true, to: 'NAP', requiresReason: true });
  });
  it('cadena de extracupo: comercial -> administrativa -> aprobado', () => {
    expect(checkTransition('AE', 'aprobar_comercial')).toMatchObject({ ok: true, to: 'AEDA' });
    expect(checkTransition('AE', 'negar_comercial')).toEqual({ ok: true, to: 'NADC', requiresReason: true });
    expect(checkTransition('AEDA', 'aprobar_administrativa')).toMatchObject({ ok: true, to: 'A' });
    expect(checkTransition('AEDA', 'negar_administrativa')).toEqual({ ok: true, to: 'NADA', requiresReason: true });
  });
  it('retomar devuelve a borrador desde los rechazos de extracupo', () => {
    expect(checkTransition('NADC', 'retomar')).toMatchObject({ ok: true, to: 'B' });
    expect(checkTransition('NADA', 'retomar')).toMatchObject({ ok: true, to: 'B' });
  });
  it('anular no cambia el estado y exige motivo', () => {
    expect(checkTransition('B', 'anular')).toEqual({ ok: true, to: 'sin_cambio', requiresReason: true });
  });
  it('rechaza acciones fuera de orden', () => {
    const r = checkTransition('AE', 'aprobar_administrativa');
    expect(r.ok).toBe(false);
    expect(checkTransition('A', 'anular').ok).toBe(false);
    expect(checkTransition(null, 'enviar')).toMatchObject({ ok: false });
    expect(checkTransition('AC', 'enviar')).toMatchObject({ ok: false });
  });
  it('accion desconocida', () => {
    expect(checkTransition('B', 'x' as never)).toMatchObject({ ok: false });
  });
});

describe('availableActions', () => {
  it('lista las acciones por estado', () => {
    expect(availableActions('B')).toEqual(['enviar', 'anular']);
    expect(availableActions('AP')).toEqual(['aprobar_precios', 'devolver_precios']);
    expect(availableActions('A')).toEqual([]);
    expect(availableActions('AC')).toEqual([]);
  });
});
