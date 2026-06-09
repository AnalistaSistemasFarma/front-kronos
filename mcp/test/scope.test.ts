import { describe, it, expect } from 'vitest';
import { effectiveCompanyIds, effectiveCompanyFilter } from '../src/scope.js';
import type { AuthScope } from '../src/auth.js';

const scopeA: AuthScope = { agent: 'a', role: 'reader', allCompanies: false, companyIds: [1] };
const scopeAB: AuthScope = { agent: 'ab', role: 'reader', allCompanies: false, companyIds: [1, 2] };
const scopeAdmin: AuthScope = { agent: 'admin', role: 'admin', allCompanies: true, companyIds: [] };

describe('effectiveCompanyIds — el alcance de la key manda', () => {
  it('sin empresa pedida usa todo el alcance de la key', () => {
    expect(effectiveCompanyIds(scopeAB, null)).toEqual([1, 2]);
    expect(effectiveCompanyIds(scopeAB, undefined)).toEqual([1, 2]);
  });

  it('pedir una empresa dentro del alcance la respeta', () => {
    expect(effectiveCompanyIds(scopeAB, 2)).toEqual([2]);
  });

  it('pedir una empresa FUERA del alcance NO la deja ver (intersección vacía)', () => {
    // Key con alcance [1] pide empresa 2 -> ninguna empresa efectiva.
    expect(effectiveCompanyIds(scopeA, 2)).toEqual([]);
  });

  it('pedir mezcla dentro/fuera solo deja las permitidas', () => {
    expect(effectiveCompanyIds(scopeAB, [2, 3, 99])).toEqual([2]);
  });

  it('nunca amplía el alcance aunque se pida una lista enorme', () => {
    const result = effectiveCompanyIds(scopeA, [1, 2, 3, 4, 5]);
    expect(result).toEqual([1]);
    expect(result.every((id) => scopeA.companyIds.includes(id))).toBe(true);
  });
});

describe('effectiveCompanyFilter — admin "*" vs lista cerrada', () => {
  it('key con lista siempre aplica filtro (regla de oro intacta)', () => {
    expect(effectiveCompanyFilter(scopeAB, null)).toEqual({
      applyFilter: true,
      companyIds: [1, 2],
    });
    // Lista [1] que pide 2 -> filtro vacío (cero filas), nunca abre el alcance.
    expect(effectiveCompanyFilter(scopeA, 2)).toEqual({ applyFilter: true, companyIds: [] });
  });

  it('admin sin companyId NO aplica filtro (ve todo)', () => {
    expect(effectiveCompanyFilter(scopeAdmin, null)).toEqual({
      applyFilter: false,
      companyIds: [],
    });
    expect(effectiveCompanyFilter(scopeAdmin, undefined)).toEqual({
      applyFilter: false,
      companyIds: [],
    });
  });

  it('admin con companyId del cliente acota por conveniencia (sin ampliar nada)', () => {
    expect(effectiveCompanyFilter(scopeAdmin, 7)).toEqual({
      applyFilter: true,
      companyIds: [7],
    });
    expect(effectiveCompanyFilter(scopeAdmin, [7, 8, 8])).toEqual({
      applyFilter: true,
      companyIds: [7, 8],
    });
  });
});
