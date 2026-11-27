import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLUMN_FILTERS,
  EMPTY_OPTION,
  columnOptions,
  filterAssetRows,
  hasActiveFilters,
  MONTH_OPTIONS,
  purchaseYearOptions,
  type AssetListRowLike,
} from '../listFilters';

const row = (over: Partial<AssetListRowLike>): AssetListRowLike => ({
  name: 'PC-01',
  label: 'TI-0001',
  serial: 'ABC123',
  model: 'Latitude',
  subtype: 'PORTÁTIL',
  user: 'Ana Pérez',
  department: 'FINANZAS',
  company: 'GSS',
  status: 'En uso',
  ...over,
});

const rows = [
  row({}),
  row({ name: 'PC-02', subtype: 'EQUIPO ESCRITORIO', status: 'Stock', user: 'Luis', department: 'TI' }),
  row({ name: 'PC-03', subtype: null, status: 'En prestamo', company: 'KELAB ' }),
];

describe('filterAssetRows', () => {
  it('no filters keeps every row', () => {
    expect(filterAssetRows(rows, EMPTY_COLUMN_FILTERS)).toHaveLength(3);
    expect(hasActiveFilters(EMPTY_COLUMN_FILTERS)).toBe(false);
  });

  it('text filters ignore case and accents; user also matches the department', () => {
    expect(filterAssetRows(rows, { ...EMPTY_COLUMN_FILTERS, user: 'perez' }).map((r) => r.name)).toEqual([
      'PC-01',
      'PC-03',
    ]);
    expect(filterAssetRows(rows, { ...EMPTY_COLUMN_FILTERS, user: 'ti' }).map((r) => r.name)).toEqual(['PC-02']);
    expect(filterAssetRows(rows, { ...EMPTY_COLUMN_FILTERS, company: 'kelab' }).map((r) => r.name)).toEqual([
      'PC-03',
    ]);
  });

  it('category and status are exact; EMPTY_OPTION picks rows without value', () => {
    expect(filterAssetRows(rows, { ...EMPTY_COLUMN_FILTERS, category: 'PORTÁTIL' }).map((r) => r.name)).toEqual([
      'PC-01',
    ]);
    expect(filterAssetRows(rows, { ...EMPTY_COLUMN_FILTERS, category: EMPTY_OPTION }).map((r) => r.name)).toEqual([
      'PC-03',
    ]);
    expect(
      filterAssetRows(rows, { ...EMPTY_COLUMN_FILTERS, status: 'Stock', category: 'EQUIPO ESCRITORIO' }).map(
        (r) => r.name
      )
    ).toEqual(['PC-02']);
  });
});

describe('purchase date filter', () => {
  const dated = [
    row({ name: 'A', purchaseDate: '2025-05-27T00:00:00.000Z' }),
    row({ name: 'B', purchaseDate: new Date('2025-09-28T00:00:00Z') }),
    row({ name: 'C', purchaseDate: '2023-04-02T00:00:00.000Z' }),
    row({ name: 'D', purchaseDate: null }),
  ];
  const names = (f: Partial<typeof EMPTY_COLUMN_FILTERS>) =>
    filterAssetRows(dated, { ...EMPTY_COLUMN_FILTERS, ...f }).map((r) => r.name);

  it('filters by year, month, both, and without date', () => {
    expect(names({ purchaseYear: '2025' })).toEqual(['A', 'B']);
    expect(names({ purchaseMonth: '4' })).toEqual(['C']);
    expect(names({ purchaseYear: '2025', purchaseMonth: '9' })).toEqual(['B']);
    expect(names({ purchaseYear: EMPTY_OPTION })).toEqual(['D']);
  });

  it('year options newest first plus «Sin fecha»', () => {
    expect(purchaseYearOptions(dated)).toEqual([
      { value: '2025', label: '2025' },
      { value: '2023', label: '2023' },
      { value: EMPTY_OPTION, label: 'Sin fecha' },
    ]);
    expect(MONTH_OPTIONS[0]).toEqual({ value: '1', label: 'Enero' });
  });
});

describe('columnOptions', () => {
  it('distinct sorted values plus «Sin dato»', () => {
    expect(columnOptions(rows, 'subtype')).toEqual([
      { value: 'EQUIPO ESCRITORIO', label: 'EQUIPO ESCRITORIO' },
      { value: 'PORTÁTIL', label: 'PORTÁTIL' },
      { value: EMPTY_OPTION, label: 'Sin dato' },
    ]);
    expect(columnOptions(rows, 'status').map((o) => o.value)).toEqual(['En prestamo', 'En uso', 'Stock']);
  });
});
