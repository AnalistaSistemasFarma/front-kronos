import { describe, expect, it, vi } from 'vitest';
import { fillMissingPrices, groupBulkRows, parseAmount, toIsoDate, type PriceLookups } from './bulk';

const row = (over: Record<string, unknown> = {}) => ({
  CardCode: 'P1',
  CardName: 'PROV UNO',
  Comments: 'compra mensual',
  ItemCode: 'A1',
  Quantity: '2',
  TaxCode: 'IVA19',
  AccountCode: '5135',
  CostingCode: 'ADM',
  ...over,
});

describe('parseAmount y toIsoDate', () => {
  it('tolera miles con coma', () => {
    expect(parseAmount('1,500.5')).toBe(1500.5);
    expect(parseAmount('')).toBe(0);
  });
  it('acepta Date, serial de Excel y texto', () => {
    expect(toIsoDate(new Date('2026-10-21T00:00:00Z'))).toBe('2026-10-21');
    expect(toIsoDate(46316)).toBe('2026-10-21');
    expect(toIsoDate('2026-10-21')).toBe('2026-10-21');
    expect(toIsoDate('no es fecha')).toBe('');
  });
});

describe('groupBulkRows', () => {
  it('descarta filas sin obligatorios con su motivo y numero de fila', () => {
    const { invalid } = groupBulkRows([row(), row({ ItemCode: '' }), row({ CardCode: null, Quantity: '' })]);
    expect(invalid).toEqual([
      { row: 2, reason: 'Datos faltantes: ItemCode', CardCode: 'P1', ItemCode: '' },
      { row: 3, reason: 'Datos faltantes: CardCode, Quantity', CardCode: '(sin socio)', ItemCode: 'A1' },
    ]);
  });

  it('agrupa por proveedor con la cabecera de la primera fila', () => {
    const { groups } = groupBulkRows([row(), row({ CardCode: 'P2', Comments: 'otra' }), row({ ItemCode: 'A2', Comments: 'ignorado' })]);
    expect(groups.map((g) => [g.cardCode, g.rows])).toEqual([
      ['P1', [1, 3]],
      ['P2', [2]],
    ]);
    expect(groups[0].header.Comments).toBe('COMPRA MENSUAL');
    expect(groups[0].lines[0]).toMatchObject({ ItemCode: 'A1', Quantity: 2, LineVendor: 'P1', U_NombreProveedor: 'PROV UNO' });
  });

  it('aplica moneda y bodega por defecto de la empresa solo si la fila no las trae', () => {
    const { groups } = groupBulkRows([row(), row({ ItemCode: 'A2', Currency: 'USD', WarehouseCode: 'B2' })], {
      currency: 'COP',
      warehouse: 'MPR01',
    });
    expect(groups[0].lines[0]).toMatchObject({ Currency: 'COP', WarehouseCode: 'MPR01' });
    expect(groups[0].lines[1]).toMatchObject({ Currency: 'USD', WarehouseCode: 'B2' });
  });

  it('usa un comentario fijo si el Excel no lo trae', () => {
    expect(groupBulkRows([row({ Comments: '' })]).groups[0].header.Comments).toBe('CARGUE MASIVO');
  });
});

describe('fillMissingPrices', () => {
  const sap = (over: Partial<PriceLookups> = {}): PriceLookups => ({
    priceListOf: vi.fn().mockResolvedValue(3),
    itemPrices: vi.fn().mockResolvedValue([{ PriceList: 3, Price: 1200 }]),
    ...over,
  });

  it('toma el precio de la lista del proveedor y respeta el precio del Excel', async () => {
    const { groups } = groupBulkRows([row(), row({ ItemCode: 'A2', UnitPrice: '50' })]);
    const lookups = sap();
    expect(await fillMissingPrices(groups, lookups)).toEqual([]);
    expect(groups[0].lines.map((l) => l.UnitPrice)).toEqual([1200, 50]);
    expect(lookups.itemPrices).toHaveBeenCalledTimes(1);
  });

  it('deja 0 y avisa si no hay lista o precio', async () => {
    const { groups } = groupBulkRows([row()]);
    const warnings = await fillMissingPrices(groups, sap({ priceListOf: vi.fn().mockResolvedValue(null) }));
    expect(groups[0].lines[0].UnitPrice).toBe(0);
    expect(warnings[0].reason).toContain('no tiene lista');
  });
});
