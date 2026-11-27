import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLUMN_FILTERS,
  EMPTY_OPTION,
  columnOptions,
  filterAssetRows,
  hasActiveFilters,
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
