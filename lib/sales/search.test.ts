import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, searchPath, searchRows } from './search';

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
