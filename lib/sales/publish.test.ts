import { describe, expect, it } from 'vitest';
import { buildOrderPayload, orderLookupFilter, orderMarker, parseOrderMarker } from './publish';

describe('marca del pedido', () => {
  it('V<DocEntry> ida y vuelta', () => {
    expect(orderMarker(123)).toBe('V123');
    expect(parseOrderMarker('V123')).toBe(123);
    expect(parseOrderMarker(' V7 ')).toBe(7);
  });
  it('no confunde la marca de Compras ni valores vacios', () => {
    expect(parseOrderMarker('D123')).toBeNull();
    expect(parseOrderMarker(null)).toBeNull();
    expect(parseOrderMarker('V12a')).toBeNull();
  });
  it('filtro OData del pedido de un borrador', () => {
    expect(orderLookupFilter(55)).toBe("U_SEND_SolCom eq 'V55'");
  });
});

describe('buildOrderPayload', () => {
  const base = {
    DocEntry: 900,
    CardCode: 'C001',
    DocDueDate: '2026-11-05',
    Comments: 'Pedido',
    NumAtCard: 'OC-1',
    U_SEND_State: 'AEDA',
    Ignorado: 'x',
  };
  it('pedido en A, con la marca y la fecha de hoy', () => {
    const p = buildOrderPayload({ ...base, DocumentLines: [] }, '2026-10-30');
    expect(p).toMatchObject({
      CardCode: 'C001',
      DocDate: '2026-10-30',
      DocDueDate: '2026-11-05',
      DocObjectCode: 'oOrders',
      U_SEND_State: 'A',
      U_SEND_SolCom: 'V900',
      NumAtCard: 'OC-1',
    });
    expect(p).not.toHaveProperty('Ignorado');
  });
  it('lineas de Salesforce sin cotizacion: no inventa la base', () => {
    const p = buildOrderPayload(
      { ...base, DocumentLines: [{ ItemCode: 'A', Quantity: 2, UnitPrice: 10, WarehouseCode: 'B1101' }] },
      '2026-10-30'
    );
    expect(p.DocumentLines[0]).toEqual({ ItemCode: 'A', Quantity: 2, WarehouseCode: 'B1101', TaxCode: undefined, UnitPrice: 10 });
  });
  it('lineas con cotizacion conservan su propia base', () => {
    const p = buildOrderPayload(
      {
        ...base,
        DocumentLines: [
          { ItemCode: 'A', Quantity: 1, Price: 5, BaseType: 23, BaseEntry: 40, BaseLine: 0 },
          { ItemCode: 'B', Quantity: 1, UnitPrice: 6, BaseType: 23, BaseEntry: 40, BaseLine: 3 },
        ],
      },
      '2026-10-30'
    );
    expect(p.DocumentLines.map((l) => [l.UnitPrice, l.BaseEntry, l.BaseLine])).toEqual([
      [5, 40, 0],
      [6, 40, 3],
    ]);
  });
});
