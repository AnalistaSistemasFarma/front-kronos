import { describe, expect, it } from 'vitest';
import type { HelpdeskCaseDetail } from '../aggregate';
import {
  countActiveFilters,
  distinctValues,
  EMPTY_CASE_FILTERS,
  filterCaseDetails,
  normalizeText,
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

  it('counts the active filters and lists distinct values', () => {
    expect(countActiveFilters({ ...EMPTY_CASE_FILTERS, status: ['Abierto'], createdFrom: '2026-01-01', createdTo: '2026-01-31', closed: 'with' })).toBe(3);
    expect(distinctValues(cases, (c) => c.company)).toEqual(['FARMALOGICA S.A.', 'LABORATORIOS RYAN']);
  });
});
