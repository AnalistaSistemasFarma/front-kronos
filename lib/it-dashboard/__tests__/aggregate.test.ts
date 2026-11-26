import { describe, expect, it } from 'vitest';
import {
  aggregateItDashboard,
  cleanLabel,
  formatTypeName,
  parseItDashboardFilters,
  parseTypeFilter,
  statusKey,
  type ItAssetRow,
} from '../aggregate';

const catalog = {
  companies: [
    { id: 1, name: 'FARMALOGICA S.A.' },
    { id: 2, name: 'LABORATORIOS RYAN ' },
    { id: 8, name: 'GSS' },
  ],
  types: [
    { id: 1, name: 'COMPUTADORES' },
    { id: 2, name: 'IMPRESORAS' },
    { id: 4, name: 'ACCESS_POINT' },
  ],
};

const row = (over: Partial<ItAssetRow>): ItAssetRow => ({
  id: 1,
  companyId: 8,
  company: 'GSS',
  typeId: 1,
  type: 'COMPUTADORES',
  statusId: 1,
  status: 'En uso',
  cost: 1000,
  ...over,
});

const rows: ItAssetRow[] = [
  row({ id: 1 }),
  row({ id: 2, status: 'Stock', cost: '2500.5' }),
  row({ id: 3, typeId: 2, type: 'IMPRESORAS', status: 'En prestamo', cost: null }),
  row({ id: 4, companyId: 1, company: 'FARMALOGICA S.A.', status: 'Baja', cost: 300 }),
  row({ id: 5, companyId: 1, company: 'FARMALOGICA S.A.' }),
  row({ id: 6, companyId: null, company: null, typeId: null, type: null }),
];

describe('statusKey', () => {
  it('maps the status_asset catalogue, ignoring case and accents', () => {
    expect(statusKey('En uso')).toBe('inUse');
    expect(statusKey(' STOCK ')).toBe('stock');
    expect(statusKey('En préstamo')).toBe('onLoan');
    expect(statusKey('Baja')).toBe('retired');
    expect(statusKey(null)).toBe('other');
  });
});

describe('parse filters', () => {
  it('reads company, includeRetired and type; rejects junk', () => {
    expect(parseItDashboardFilters(new URLSearchParams('company=8&includeRetired=1'))).toEqual({
      companyId: 8,
      includeRetired: true,
    });
    expect(parseItDashboardFilters(new URLSearchParams('company=abc'))).toEqual({
      companyId: null,
      includeRetired: false,
    });
    expect(parseItDashboardFilters(new URLSearchParams('company=0')).companyId).toBe(0);
    expect(parseTypeFilter(new URLSearchParams('type=4'))).toBe(4);
    expect(parseTypeFilter(new URLSearchParams('type=-1'))).toBeNull();
    expect(parseTypeFilter(new URLSearchParams(''))).toBeNull();
  });
});

describe('aggregateItDashboard', () => {
  it('without filters: every company and type, retired assets left out', () => {
    const data = aggregateItDashboard(rows, catalog, { companyId: null, includeRetired: false });

    expect(data.allCompaniesTotal).toBe(5);
    expect(data.kpis).toEqual({
      total: 5,
      inUse: 3,
      stock: 1,
      onLoan: 1,
      retired: 0,
      otherStatus: 0,
      totalCost: 1000 + 2500.5 + 1000 + 1000,
    });
    // Companies: catalogue rows (even with zero) plus «Sin empresa», by count.
    expect(data.companies).toEqual([
      { id: 8, name: 'GSS', total: 3 },
      { id: 1, name: 'FARMALOGICA S.A.', total: 1 },
      { id: 0, name: 'Sin empresa', total: 1 },
      { id: 2, name: 'LABORATORIOS RYAN', total: 0 },
    ]);
    // Types: every catalogue type (zero included) plus «Sin tipo».
    expect(data.types).toEqual([
      { id: 1, name: 'COMPUTADORES', total: 3 },
      { id: 2, name: 'IMPRESORAS', total: 1 },
      { id: 0, name: 'Sin tipo', total: 1 },
      { id: 4, name: 'ACCESS_POINT', total: 0 },
    ]);
  });

  it('a selected company scopes types, status and KPIs but not the company panel', () => {
    const data = aggregateItDashboard(rows, catalog, { companyId: 1, includeRetired: true });

    expect(data.kpis.total).toBe(2);
    expect(data.kpis.retired).toBe(1);
    expect(data.kpis.totalCost).toBe(1300);
    expect(data.types.find((t) => t.id === 1)?.total).toBe(2);
    expect(data.types.some((t) => t.id === 0)).toBe(false);
    expect(data.byStatus).toEqual([
      { name: 'Baja', total: 1 },
      { name: 'En uso', total: 1 },
    ]);
    expect(data.allCompaniesTotal).toBe(6);
    expect(data.companies.find((c) => c.id === 8)?.total).toBe(3);
  });
});

describe('excluded companies', () => {
  it('UNIDOSSIS, ONELATAMONCO and PRUEBAS leave the panel and every count', () => {
    const withExcluded = {
      companies: [
        ...catalog.companies,
        { id: 4, name: 'PRUEBAS' },
        { id: 5, name: 'UNIDOSSIS' },
        { id: 10, name: ' onelatamonco ' },
      ],
      types: catalog.types,
    };
    const extra: ItAssetRow[] = [
      row({ id: 50, companyId: 5, company: 'UNIDOSSIS', cost: 999 }),
      row({ id: 51, companyId: 4, company: 'PRUEBAS' }),
    ];
    const data = aggregateItDashboard([...rows, ...extra], withExcluded, {
      companyId: null,
      includeRetired: false,
    });
    expect(data.companies.some((c) => [4, 5, 10].includes(c.id))).toBe(false);
    expect(data.allCompaniesTotal).toBe(5);
    expect(data.kpis.totalCost).toBe(1000 + 2500.5 + 1000 + 1000);
  });
});

describe('labels', () => {
  it('cleans and formats catalogue names', () => {
    expect(cleanLabel('  Hardware\r\n', 'x')).toBe('Hardware');
    expect(cleanLabel(null, 'Sin estado')).toBe('Sin estado');
    expect(formatTypeName('ACCESS_POINT')).toBe('Access point');
    expect(formatTypeName('COMPUTADORES')).toBe('Computadores');
    expect(formatTypeName('Video Beam')).toBe('Video Beam');
  });
});
