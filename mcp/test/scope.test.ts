import { describe, it, expect } from 'vitest';
import { effectiveCompanyIds } from '../src/scope.js';
import type { AuthScope } from '../src/auth.js';

const scopeA: AuthScope = { agent: 'a', role: 'reader', companyIds: [1] };
const scopeAB: AuthScope = { agent: 'ab', role: 'reader', companyIds: [1, 2] };

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
