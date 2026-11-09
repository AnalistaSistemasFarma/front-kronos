import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
vi.mock('../../dbconfig.js', () => ({ default: {} }));
vi.mock('../purchases/authorization', () => ({ companySap: vi.fn() }));
vi.mock('./offerFlow', () => ({ createDraftOfferRequest: vi.fn() }));
import { headerField, rowsToLines } from './linesImport';

describe('cargue de líneas desde Excel', () => {
  it('reconoce encabezados con variantes', () => {
    expect(headerField('Código artículo')).toBe('ItemCode');
    expect(headerField('ItemCode')).toBe('ItemCode');
    expect(headerField('Precio unitario')).toBe('UnitPrice');
    expect(headerField('Bodega')).toBe('WarehouseCode');
    expect(headerField('Otra')).toBeNull();
  });
  it('convierte filas y valida cantidad y precio', () => {
    const r = rowsToLines([
      { row: 2, values: { 'Codigo articulo': 'A1', Cantidad: '1.234,5', Precio: 1000 } },
      { row: 3, values: { 'Codigo articulo': 'A2', Cantidad: -1 } },
      { row: 4, values: { Cantidad: 2 } },
      { row: 5, values: {} },
      { row: 6, values: { 'Codigo articulo': 'A3', Cantidad: 3, Bodega: 'B1101' } },
    ]);
    expect(r.lines).toEqual([
      { row: 2, ItemCode: 'A1', Quantity: 1234.5, UnitPrice: 1000, WarehouseCode: '', ItemDescription: '' },
      { row: 6, ItemCode: 'A3', Quantity: 3, UnitPrice: null, WarehouseCode: 'B1101', ItemDescription: '' },
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
  });
});

import { quotationOf } from './rejection';
describe('retomar oferta', () => {
  it('encuentra la cotización de origen por las líneas del borrador', () => {
    expect(quotationOf([{ BaseType: -1, BaseEntry: null }, { BaseType: 23, BaseEntry: 77 }])).toBe(77);
    expect(quotationOf([])).toBeNull();
  });
});
