/**
 * Customer's previous documents (quotations, orders and invoices of the last months) for the «Montar oferta desde
 * PDF» review: the user sees what was mounted before for that customer and can reuse the item on a PO line
 * (Nicolás Rivera, 2026-11-27, SynerLink msg 41343). READ ONLY. One bulk read per document type, cached.
 */
import { sapGetAll, type SapSession } from '../sap/serviceLayer';
import { monthsBefore } from './itemResolver';

export type CustomerDocType = 'Quotations' | 'Orders' | 'Invoices';
export const CUSTOMER_DOC_LABEL: Record<CustomerDocType, string> = { Quotations: 'Oferta', Orders: 'Pedido', Invoices: 'Factura' };
export const CUSTOMER_ORDERS_MONTHS = 6;
/** Lines read per document type (newest first). */
export const CUSTOMER_ORDERS_CAP = 1500;

export interface CustomerOrderLine {
  type: CustomerDocType;
  docEntry: number;
  docNum: number;
  docDate: string;
  /** Customer PO reference (OC del cliente). */
  numAtCard: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Service Layer path of the customer's document lines. PURE. */
export function customerOrdersPath(doc: CustomerDocType, cardCode: string, from: string): string {
  return (
    `$crossjoin(${doc},${doc}/DocumentLines)?$expand=${doc}($select=DocEntry,DocNum,DocDate,NumAtCard),${doc}/DocumentLines($select=ItemCode,ItemDescription,Quantity,UnitPrice)` +
    `&$filter=${doc}/DocEntry eq ${doc}/DocumentLines/DocEntry and ${doc}/CardCode eq ${q(cardCode)} and ${doc}/Cancelled eq 'tNO' and ${doc}/DocDate ge ${q(from)}` +
    `&$orderby=${doc}/DocEntry desc`
  );
}

/** Crossjoin rows → lines, newest first. PURE. */
export function toCustomerOrderLines(doc: CustomerDocType, rows: Record<string, unknown>[]): CustomerOrderLine[] {
  return rows
    .map((row) => {
      const h = (row[doc] ?? {}) as Record<string, unknown>;
      const l = (row[`${doc}/DocumentLines`] ?? {}) as Record<string, unknown>;
      return {
        type: doc, docEntry: Number(h.DocEntry), docNum: Number(h.DocNum ?? h.DocEntry), docDate: String(h.DocDate ?? '').slice(0, 10),
        numAtCard: String(h.NumAtCard ?? ''), itemCode: String(l.ItemCode ?? ''), itemName: String(l.ItemDescription ?? ''),
        quantity: Number(l.Quantity ?? 0), unitPrice: Number(l.UnitPrice ?? 0),
      };
    })
    .filter((x) => x.itemCode);
}

/** Merges the three document types, newest first (date, then document). PURE. */
export function sortCustomerOrderLines(lines: CustomerOrderLine[]): CustomerOrderLine[] {
  return [...lines].sort((a, b) => b.docDate.localeCompare(a.docDate) || b.docEntry - a.docEntry);
}

/** Lines of the given items only (empty set = all). PURE. */
export function filterByItems(lines: CustomerOrderLine[], codes: string[]): CustomerOrderLine[] {
  if (!codes.length) return lines;
  const set = new Set(codes);
  return lines.filter((l) => set.has(l.itemCode));
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; lines: CustomerOrderLine[] }>();

export async function customerOrders(sap: SapSession, cardCode: string, today: string): Promise<CustomerOrderLine[]> {
  const from = monthsBefore(today, CUSTOMER_ORDERS_MONTHS);
  const key = `${sap.baseUrl ?? ''}|${sap.companyDB ?? ''}|${cardCode}|${from}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lines;
  const parts = await Promise.all((['Quotations', 'Orders', 'Invoices'] as const).map(async (doc) =>
    toCustomerOrderLines(doc, await sapGetAll<Record<string, unknown>>(sap, customerOrdersPath(doc, cardCode, from), { pageSize: 500, cap: CUSTOMER_ORDERS_CAP }).catch(() => []))));
  const lines = sortCustomerOrderLines(parts.flat());
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), lines });
  return lines;
}
