import { describe, expect, it } from 'vitest';
import type { HelpdeskCaseDetail } from '../aggregate';
import {
  countActiveFilters,
  distinctValues,
  EMPTY_CASE_FILTERS,
  filterCaseDetails,
  normalizeText,
  isSelectedCombination,
  rankCombinations,
  toggleCombination,
  withoutCombination,
  type CaseColumnFilters,
} from '../caseFilters';

function detail(overrides: Partial<HelpdeskCaseDetail>): HelpdeskCaseDetail {
  return {
    id: 1,
    subject: 'Atasco de papel en la impresora',
    status: 'Resuelto',
    caseType: 'Solicitud',
    company: 'FARMALOGICA S.A.',
    department: 'PRODUCCIÓN',
    technician: 'Rafael Solarte',
    category: 'Soporte Area De Sistemas',
    subcategory: 'Impresoras',
    activity: 'Atasco',
    createdAt: '2026-01-28',
    endDate: '2026-01-30',
    resolutionDays: 2,
    ...overrides,
  };
}

const cases: HelpdeskCaseDetail[] = [
  detail({ id: 396 }),
  detail({ id: 395, subject: 'Soporte compu finales de línea', status: 'Abierto', technician: 'Sin técnico asignado', category: 'Sin Asignar', endDate: null, resolutionDays: null }),
  detail({ id: 364, subject: 'Punto de red en planta', status: 'Abierto', company: 'LABORATORIOS RYAN', createdAt: '2026-01-23', endDate: null, resolutionDays: null }),
  detail({ id: 312, subject: 'Clave correo', company: 'LABORATORIOS RYAN', technician: 'Santiago Rojas', createdAt: '2025-12-10', endDate: '2025-12-20', resolutionDays: 10 }),
];

const ids = (f: Partial<CaseColumnFilters>) => filterCaseDetails(cases, { ...EMPTY_CASE_FILTERS, ...f }).map((c) => c.id);

describe('case preview column filters', () => {
  it('without filters returns every case', () => {
    expect(ids({})).toEqual([396, 395, 364, 312]);
    expect(countActiveFilters(EMPTY_CASE_FILTERS)).toBe(0);
  });

  it('text filters ignore case and accents', () => {
    expect(normalizeText('  LÍNEA ')).toBe('linea');
    expect(ids({ subject: 'linea' })).toEqual([395]);
    expect(ids({ subject: 'produccion' })).toEqual([396, 395, 364, 312]);
    expect(ids({ id: '39' })).toEqual([396, 395]);
    expect(ids({ search: 'santiago' })).toEqual([312]);
  });

  it('list filters accept several values of the same column', () => {
    expect(ids({ status: ['Abierto'] })).toEqual([395, 364]);
    expect(ids({ company: ['LABORATORIOS RYAN'], status: ['Resuelto'] })).toEqual([312]);
    expect(ids({ technician: ['Rafael Solarte', 'Santiago Rojas'] })).toEqual([396, 364, 312]);
    expect(ids({ category: ['Sin Asignar'] })).toEqual([395]);
  });

  it('date range on creation, closing date and resolution days', () => {
    expect(ids({ createdFrom: '2026-01-01' })).toEqual([396, 395, 364]);
    expect(ids({ createdFrom: '2026-01-24', createdTo: '2026-01-28' })).toEqual([396, 395]);
    expect(ids({ closed: 'without' })).toEqual([395, 364]);
    expect(ids({ closed: 'with' })).toEqual([396, 312]);
    expect(ids({ daysMin: '5' })).toEqual([312]);
    expect(ids({ daysMax: '2' })).toEqual([396]);
    expect(ids({ daysMin: 'abc' })).toEqual([396, 395, 364, 312]);
  });

  it('filters by subcategory and activity', () => {
    expect(ids({ subcategory: ['Impresoras'], activity: ['Atasco'] })).toEqual([396, 395, 364, 312]);
    expect(ids({ activity: ['Otra'] })).toEqual([]);
  });

  it('ranks category · subcategory · activity from most and least repeated', () => {
    const data = [
      ...cases,
      detail({ id: 500, category: 'Hardware', subcategory: 'Portátil', activity: 'Diagnóstico' }),
      detail({ id: 501, category: 'Hardware', subcategory: 'Portátil', activity: 'Diagnóstico' }),
      detail({ id: 502, category: 'Hardware', subcategory: 'Monitor', activity: 'Cambio' }),
    ];
    const most = rankCombinations(data, 'most');
    expect(most.map((r) => [r.category, r.subcategory, r.activity, r.total])).toEqual([
      ['Soporte Area De Sistemas', 'Impresoras', 'Atasco', 3],
      ['Hardware', 'Portátil', 'Diagnóstico', 2],
      ['Hardware', 'Monitor', 'Cambio', 1],
      ['Sin Asignar', 'Impresoras', 'Atasco', 1],
    ]);
    expect(most[0].percent).toBe(42.9);
    const least = rankCombinations(data, 'least', 2);
    expect(least.map((r) => [r.category, r.subcategory, r.total])).toEqual([
      ['Hardware', 'Monitor', 1],
      ['Sin Asignar', 'Impresoras', 1],
    ]);
    expect(rankCombinations([], 'most')).toEqual([]);
  });

  it('a ranking row toggles its combination and keeps the other filters', () => {
    const combo = { category: 'Hardware', subcategory: 'Portátil', activity: 'Diagnóstico' };
    const base: CaseColumnFilters = { ...EMPTY_CASE_FILTERS, status: ['Abierto'] };
    const selected = toggleCombination(base, combo);
    expect(isSelectedCombination(selected, combo)).toBe(true);
    expect(selected.status).toEqual(['Abierto']);
    const back = toggleCombination(selected, combo);
    expect(isSelectedCombination(back, combo)).toBe(false);
    expect(back).toEqual(base);
    const other = toggleCombination(selected, { ...combo, activity: 'Cambio' });
    expect(other.activity).toEqual(['Cambio']);
    expect(withoutCombination({ ...selected, category: ['A', 'B'] })).toEqual(base);
  });

  it('counts the active filters and lists distinct values', () => {
    expect(countActiveFilters({ ...EMPTY_CASE_FILTERS, status: ['Abierto'], createdFrom: '2026-01-01', createdTo: '2026-01-31', closed: 'with' })).toBe(3);
    expect(distinctValues(cases, (c) => c.company)).toEqual(['FARMALOGICA S.A.', 'LABORATORIOS RYAN']);
  });
});
