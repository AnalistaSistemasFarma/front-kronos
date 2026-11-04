import { odataString } from '../purchases/drafts';

/**
 * Búsqueda ampliada de la oferta de venta (como «*» + Enter de SAP y los modales de
 * SAPSEND: ModalClients, ModalListOfArticles, ModalWarehouses, ModalBatchDetails y
 * ModalViewRecentOrders). PURA: arma la ruta OData y proyecta filas. Diferencias con
 * SAPSEND: el texto se escapa, se pagina (SAPSEND traía todo) y se busca por código
 * O por nombre en la misma caja.
 */

export type SearchKind = 'customer' | 'item' | 'warehouse_stock' | 'batches' | 'recent_orders' | 'customer_detail' | 'recent_items';
export const SEARCH_KINDS: SearchKind[] = ['customer', 'item', 'warehouse_stock', 'batches', 'recent_orders', 'customer_detail', 'recent_items'];
/** Líneas de factura del cliente que se revisan para «artículos vendidos recientemente». */
export const RECENT_LINES = 200;
export const PAGE_SIZE = 50;

const key = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function searchPath(kind: SearchKind, p: { q?: string; page?: number; itemCode?: string; cardCode?: string; today?: string }): string {
  const q = (p.q ?? '').trim();
  const t = odataString(q);
  const skip = Math.max(0, Math.trunc(p.page ?? 0)) * PAGE_SIZE;
  const page = `&$top=${PAGE_SIZE}&$skip=${skip}`;
  switch (kind) {
    case 'customer': {
      const f = ["CardType eq 'cCustomer'", "Valid eq 'tYES'"];
      if (q) f.unshift(`(contains(CardCode,${t}) or contains(CardName,${t}))`);
      return `BusinessPartners?$select=CardCode,CardName,CreditLimit,CurrentAccountBalance,OpenDeliveryNotesBalance,OpenOrdersBalance,City,Phone1,Frozen&$filter=${f.join(' and ')}&$orderby=CardName${page}`;
    }
    case 'item': {
      const f = ["Frozen eq 'tNO'", "SalesItem eq 'tYES'"];
      if (q) f.unshift(`(contains(ItemCode,${t}) or contains(ItemName,${t}))`);
      return `Items?$select=ItemCode,ItemName,QuantityOnStock,QuantityOrderedByCustomers,DefaultWarehouse,SalesUnit&$filter=${f.join(' and ')}&$orderby=ItemCode${page}`;
    }
    case 'warehouse_stock':
      return `Items(${key(p.itemCode ?? '')})?$select=ItemCode,ItemName,ItemWarehouseInfoCollection`;
    case 'batches': {
      const today = p.today ?? new Date().toISOString().slice(0, 10);
      return `BatchNumberDetails?$select=Batch,ItemCode,ItemDescription,ExpirationDate,ManufacturingDate,Status&$filter=ItemCode eq ${key(p.itemCode ?? '')} and ExpirationDate ge '${today}'&$orderby=ExpirationDate${page}`;
    }
    case 'customer_detail':
      return `BusinessPartners(${key(p.cardCode ?? '')})?$select=CardCode,CardName,ShipToDefault,BilltoDefault,BPAddresses`;
    case 'recent_items':
      // Líneas de las facturas del cliente, de la más reciente hacia atrás (solo los campos necesarios, vía $crossjoin).
      return `$crossjoin(Invoices,Invoices/DocumentLines)?$expand=Invoices($select=DocEntry,DocDate),Invoices/DocumentLines($select=ItemCode,ItemDescription,UnitPrice)&$filter=Invoices/DocEntry eq Invoices/DocumentLines/DocEntry and Invoices/CardCode eq ${key(p.cardCode ?? '')} and Invoices/Cancelled eq 'tNO'&$orderby=Invoices/DocEntry desc&$top=${RECENT_LINES}`;
    case 'recent_orders':
      return `Orders?$select=DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,NumAtCard&$filter=CardCode eq ${key(p.cardCode ?? '')}&$orderby=DocEntry desc&$top=20`;
  }
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
const s = (v: unknown) => (v == null ? '' : String(v));

/** Filas para la ventana (columnas ya calculadas). */
export function searchRows(kind: SearchKind, data: Record<string, unknown>): Record<string, unknown>[] {
  if (kind === 'customer_detail') {
    // Puntos de entrega (direcciones de envío) del cliente, como ModalLogistic de SAPSEND.
    const addrs = ((data.BPAddresses as Record<string, unknown>[] | undefined) ?? []).filter((a) => s(a.AddressType) === 'bo_ShipTo');
    return addrs.map((a) => ({
      AddressName: s(a.AddressName), Street: s(a.Street), Block: s(a.Block), City: s(a.City), County: s(a.County), Country: s(a.Country), ZipCode: s(a.ZipCode),
      isDefault: s(a.AddressName) === s(data.ShipToDefault), BilltoDefault: s(data.BilltoDefault),
    }));
  }
  if (kind === 'warehouse_stock') {
    const rows = (data.ItemWarehouseInfoCollection as Record<string, unknown>[] | undefined) ?? [];
    return rows
      .map((w) => {
        const inStock = n(w.InStock) ?? 0;
        const committed = n(w.Committed) ?? 0;
        const ordered = n(w.Ordered) ?? 0;
        return { WarehouseCode: s(w.WarehouseCode), InStock: inStock, Committed: committed, Ordered: ordered, Available: inStock - committed, Locked: s(w.Locked) === 'tYES' };
      })
      .filter((w) => w.InStock !== 0 || w.Committed !== 0 || w.Ordered !== 0);
  }
  const value = (data.value as Record<string, unknown>[] | undefined) ?? [];
  if (kind === 'customer') {
    return value.map((r) => {
      const limit = n(r.CreditLimit) ?? 0;
      const used = (n(r.CurrentAccountBalance) ?? 0) + (n(r.OpenDeliveryNotesBalance) ?? 0) + (n(r.OpenOrdersBalance) ?? 0);
      return {
        CardCode: s(r.CardCode), CardName: s(r.CardName), City: s(r.City), Phone1: s(r.Phone1),
        CreditLimit: limit, CurrentAccountBalance: n(r.CurrentAccountBalance), OpenDeliveryNotesBalance: n(r.OpenDeliveryNotesBalance),
        OpenOrdersBalance: n(r.OpenOrdersBalance), Disponible: limit * 1.2 - used, Frozen: s(r.Frozen) === 'tYES',
      };
    });
  }
  if (kind === 'item') {
    return value.map((r) => ({
      ItemCode: s(r.ItemCode), ItemName: s(r.ItemName), QuantityOnStock: n(r.QuantityOnStock), Committed: n(r.QuantityOrderedByCustomers),
      Available: (n(r.QuantityOnStock) ?? 0) - (n(r.QuantityOrderedByCustomers) ?? 0), DefaultWarehouse: s(r.DefaultWarehouse), SalesUnit: s(r.SalesUnit),
    }));
  }
  if (kind === 'batches') {
    return value.map((r) => ({ Batch: s(r.Batch), ExpirationDate: s(r.ExpirationDate).slice(0, 10), ManufacturingDate: s(r.ManufacturingDate).slice(0, 10), Status: s(r.Status) }));
  }
  return value.map((r) => ({ DocNum: n(r.DocNum), DocDate: s(r.DocDate).slice(0, 10), DocTotal: n(r.DocTotal), DocumentStatus: s(r.DocumentStatus) === 'bost_Open' ? 'Abierto' : 'Cerrado', NumAtCard: s(r.NumAtCard) }));
}

export interface RecentItem { ItemCode: string; ItemName: string; LastDate: string; LastPrice: number | null; Times: number }

/** Artículos de las últimas facturas del cliente, del más reciente al más antiguo (uno por artículo).
 *  Recibe las filas del $crossjoin Invoices × líneas. Precio = el mayor de la última factura (las líneas en $1 son obsequios). PURA. */
export function recentItems(data: Record<string, unknown>, max = 30): RecentItem[] {
  const out = new Map<string, RecentItem & { docs: Set<number>; lastDoc: number }>();
  for (const row of (data.value as Record<string, unknown>[] | undefined) ?? []) {
    const inv = (row.Invoices ?? {}) as Record<string, unknown>;
    const l = (row['Invoices/DocumentLines'] ?? {}) as Record<string, unknown>;
    const code = s(l.ItemCode);
    if (!code) continue;
    const doc = Number(inv.DocEntry);
    const price = n(l.UnitPrice);
    const prev = out.get(code);
    if (!prev) {
      out.set(code, { ItemCode: code, ItemName: s(l.ItemDescription), LastDate: s(inv.DocDate).slice(0, 10), LastPrice: price, Times: 1, docs: new Set([doc]), lastDoc: doc });
      continue;
    }
    if (doc === prev.lastDoc && price != null && (prev.LastPrice == null || price > prev.LastPrice)) prev.LastPrice = price;
    if (!prev.docs.has(doc)) {
      prev.docs.add(doc);
      prev.Times = prev.docs.size;
    }
  }
  return [...out.values()].slice(0, max).map(({ docs: _d, lastDoc: _l, ...r }) => r);
}

/** Stock de una lista de artículos (los recientes), con los mismos campos de la búsqueda de artículos. PURA. */
export function itemsByCodesPath(codes: string[]): string {
  const f = codes.map((c) => `ItemCode eq ${key(c)}`).join(' or ');
  return `Items?$select=ItemCode,ItemName,QuantityOnStock,QuantityOrderedByCustomers,DefaultWarehouse,SalesUnit,Frozen,SalesItem&$filter=${f}`;
}
