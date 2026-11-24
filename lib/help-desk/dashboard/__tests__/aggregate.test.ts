import { describe, expect, it } from 'vitest';
import {
  aggregateHelpdeskDashboard,
  buildMonthSeries,
  cleanLabel,
  computeKpis,
  filterCases,
  parseDashboardFilters,
  type HelpdeskCaseRow,
} from '../aggregate';

function row(overrides: Partial<HelpdeskCaseRow>): HelpdeskCaseRow {
  return {
    id: 1,
    createdAt: '2026-01-10T00:00:00.000Z',
    endDate: null,
    statusId: 1,
    status: 'Abierto',
    caseType: 'Solicitud',
    companyId: 1,
    company: 'FARMALOGICA S.A.',
    department: 'GERENCIA',
    technician: 'Rafael Solarte',
    category: 'Hardware\r\n',
    subcategory: 'Portátil',
    activity: 'Revisión',
    ...overrides,
  };
}

const NOW = new Date('2026-03-15T12:00:00.000Z');

const rows: HelpdeskCaseRow[] = [
  row({ id: 1, createdAt: '2025-11-04T00:00:00.000Z', statusId: 2, status: 'Resuelto', endDate: '2025-11-06T00:00:00.000Z' }),
  row({ id: 2, createdAt: '2025-11-20T00:00:00.000Z', statusId: 2, status: 'Resuelto', endDate: null }),
  row({ id: 3, createdAt: '2026-01-10T00:00:00.000Z', statusId: 3, status: 'Cancelado', companyId: 2, company: 'LABORATORIOS RYAN ' }),
  row({ id: 4, createdAt: '2026-03-01T00:00:00.000Z', statusId: 1, technician: null, category: null, caseType: 'Incidente' }),
  row({ id: 5, createdAt: '2026-03-02T00:00:00.000Z', statusId: 2, status: 'Resuelto', endDate: '2026-03-03T00:00:00.000Z' }),
];

describe('parseDashboardFilters', () => {
  it('reads company, year and month and ignores invalid values', () => {
    expect(parseDashboardFilters(new URLSearchParams('company=3&year=2026&month=2'))).toEqual({
      companyId: 3,
      year: 2026,
      month: 2,
    });
    expect(parseDashboardFilters(new URLSearchParams('company=abc&year=99&month=13'))).toEqual({});
    // A month without a year is ignored.
    expect(parseDashboardFilters(new URLSearchParams('month=5'))).toEqual({});
    expect(parseDashboardFilters(new URLSearchParams('company=0&year='))).toEqual({});
  });
});

describe('cleanLabel', () => {
  it('removes CR/LF and uses the fallback for empty values', () => {
    expect(cleanLabel('Hardware\r\n', 'x')).toBe('Hardware');
    expect(cleanLabel('  ', 'Sin categoría')).toBe('Sin categoría');
    expect(cleanLabel(null, 'Sin técnico')).toBe('Sin técnico');
  });
});

describe('filterCases', () => {
  it('filters by company, year and month (calendar date in UTC)', () => {
    expect(filterCases(rows, { companyId: 2 }).map((r) => r.id)).toEqual([3]);
    expect(filterCases(rows, { year: 2025 }).map((r) => r.id)).toEqual([1, 2]);
    expect(filterCases(rows, { year: 2026, month: 3 }).map((r) => r.id)).toEqual([4, 5]);
  });
});

describe('computeKpis', () => {
  it('averages resolution days only for resolved cases with end_date and reports the rest', () => {
    const kpis = computeKpis(rows);
    expect(kpis).toEqual({
      total: 5,
      resolved: 3,
      cancelled: 1,
      pending: 1,
      avgResolutionDays: 1.5,
      resolvedWithEndDate: 2,
      resolvedWithoutEndDate: 1,
    });
  });

  it('ignores an end_date earlier than the creation date and returns null without data', () => {
    const kpis = computeKpis([
      row({ statusId: 2, createdAt: '2026-03-05T00:00:00.000Z', endDate: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(kpis.avgResolutionDays).toBeNull();
    expect(kpis.resolvedWithoutEndDate).toBe(1);
  });
});

describe('buildMonthSeries', () => {
  it('fills every month from the first to the last case', () => {
    const series = buildMonthSeries(rows, {}, NOW);
    expect(series.map((m) => m.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
    expect(series.map((m) => m.total)).toEqual([2, 0, 1, 0, 2]);
    expect(series[0].label).toBe('nov 2025');
  });

  it('covers January to the current month for the current year, and one month when filtered', () => {
    expect(buildMonthSeries(filterCases(rows, { year: 2026 }), { year: 2026 }, NOW).map((m) => m.key)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(buildMonthSeries([], { year: 2025 }, NOW)).toHaveLength(12);
    expect(buildMonthSeries([], { year: 2026, month: 2 }, NOW)).toEqual([
      { key: '2026-02', label: 'feb 2026', total: 0 },
    ]);
    expect(buildMonthSeries([], {}, NOW)).toEqual([]);
  });
});

describe('aggregateHelpdeskDashboard', () => {
  it('returns whole-history options and filtered counts', () => {
    const data = aggregateHelpdeskDashboard(rows, { year: 2026 }, NOW);
    expect(data.firstCaseDate).toBe('2025-11-04');
    expect(data.lastCaseDate).toBe('2026-03-02');
    expect(data.filterOptions.years).toEqual([2026, 2025]);
    expect(data.filterOptions.companies).toEqual([
      { id: 1, name: 'FARMALOGICA S.A.', total: 4 },
      { id: 2, name: 'LABORATORIOS RYAN', total: 1 },
    ]);
    expect(data.kpis.total).toBe(3);
    expect(data.byCategory).toEqual([
      { name: 'Hardware', total: 2 },
      { name: 'Sin categoría', total: 1 },
    ]);
    expect(data.byTechnician).toEqual([
      { name: 'Rafael Solarte', total: 2 },
      { name: 'Sin técnico asignado', total: 1 },
    ]);
    expect(data.byType).toEqual([
      { name: 'Solicitud', total: 2 },
      { name: 'Incidente', total: 1 },
    ]);
    expect(data.byStatus.map((s) => s.name)).toEqual(['Abierto', 'Cancelado', 'Resuelto']);
  });

  it('handles an empty history', () => {
    const data = aggregateHelpdeskDashboard([], {}, NOW);
    expect(data.firstCaseDate).toBeNull();
    expect(data.kpis.total).toBe(0);
    expect(data.kpis.avgResolutionDays).toBeNull();
    expect(data.byMonth).toEqual([]);
  });
});
