import { describe, expect, it } from 'vitest';
import { itemsByCodesPath, PAGE_SIZE, recentItems, searchPath, searchRows } from './search';

describe('búsqueda ampliada · rutas', () => {
  it('clientes: código o nombre, solo clientes válidos, paginado', () => {
    const p = searchPath('customer', { q: "o'neil", page: 2 });
    expect(p).toContain("(contains(CardCode,'o''neil') or contains(CardName,'o''neil')) and CardType eq 'cCustomer' and Valid eq 'tYES'");
    expect(p).toContain(`$top=${PAGE_SIZE}&$skip=${2 * PAGE_SIZE}`);
  });
  it('sin texto trae todo (como «*» + Enter)', () => {
    expect(searchPath('item', {})).toContain("$filter=Frozen eq 'tNO' and SalesItem eq 'tYES'");
  });
  it('stock por bodega, lotes vigentes y pedidos recientes', () => {
    expect(searchPath('warehouse_stock', { itemCode: "A'1" })).toBe("Items('A''1')?$select=ItemCode,ItemName,ItemWarehouseInfoCollection");
    expect(searchPath('batches', { itemCode: 'A1', today: '2026-11-03' })).toContain("ItemCode eq 'A1' and ExpirationDate ge '2026-11-03'");
    expect(searchPath('recent_orders', { cardCode: 'C1' })).toContain("CardCode eq 'C1'");
  });
});

describe('búsqueda ampliada · filas', () => {
  it('cliente con cupo disponible (límite +20 % menos lo comprometido)', () => {
    const [r] = searchRows('customer', { value: [{ CardCode: 'C', CardName: 'N', CreditLimit: 1000, CurrentAccountBalance: 500, OpenDeliveryNotesBalance: 100, OpenOrdersBalance: 100 }] });
    expect(r.Disponible).toBe(500);
  });
  it('bodegas: disponible = stock − comprometido y omite bodegas vacías', () => {
    const rows = searchRows('warehouse_stock', { ItemWarehouseInfoCollection: [
      { WarehouseCode: 'B1', InStock: 10, Committed: 3, Ordered: 0, Locked: 'tNO' },
      { WarehouseCode: 'B2', InStock: 0, Committed: 0, Ordered: 0 },
    ] });
    expect(rows).toEqual([{ WarehouseCode: 'B1', InStock: 10, Committed: 3, Ordered: 0, Available: 7, Locked: false }]);
  });
});

describe('búsqueda ampliada · artículos vendidos recientemente al cliente', () => {
  const row = (doc: number, date: string, code: string, price: number) => ({
    Invoices: { DocEntry: doc, DocDate: date },
    'Invoices/DocumentLines': { ItemCode: code, ItemDescription: `Art ${code}`, UnitPrice: price },
  });
  it('ruta: $crossjoin de facturas del cliente, más recientes primero, código escapado', () => {
    const p = searchPath('recent_items', { cardCode: "90'1" });
    expect(p).toContain('$crossjoin(Invoices,Invoices/DocumentLines)');
    expect(p).toContain("Invoices/CardCode eq '90''1'");
    expect(p).toContain('$orderby=Invoices/DocEntry desc');
  });
  it('un artículo por fila, del más reciente; precio mayor de la última factura; veces = facturas', () => {
    const r = recentItems({ value: [row(9, '2026-10-28', 'A', 104060), row(9, '2026-10-28', 'A', 1), row(9, '2026-10-28', 'B', 1), row(5, '2026-07-23', 'A', 99000)] });
    expect(r).toEqual([
      { ItemCode: 'A', ItemName: 'Art A', LastDate: '2026-10-28', LastPrice: 104060, Times: 2 },
      { ItemCode: 'B', ItemName: 'Art B', LastDate: '2026-10-28', LastPrice: 1, Times: 1 },
    ]);
  });
  it('stock de los recientes por código', () => {
    expect(itemsByCodesPath(['A', "B'"])).toContain("ItemCode eq 'A' or ItemCode eq 'B'''");
  });
});
