import { sapGet, sapGetAll, type SapSession } from '../sap/serviceLayer';
import type { ImportLine } from './linesImport';
import { normalizeBarcode, packFromName, rankLine, type HistoryInfo, type ItemInfo, type LinePrediction, type LineSignals } from './itemPrediction';
import { searchTerms } from './pdfOrder';

/**
 * Server side of the item prediction (see itemPrediction.ts). READ ONLY against SAP. All lookups are bulk:
 * barcodes, catalog numbers and item codes go in chunks of 25 codes, the customer history is two queries
 * (orders and invoices of the last 12 months, paged) and the item master search is one query per distinct
 * description key. Nothing is queried per line.
 */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const CHUNK = 25;
/** History lines read per document type (orders, invoices): enough for a big customer in 12 months. */
export const HISTORY_CAP = 3000;
export const HISTORY_MONTHS = 12;

const chunks = <T,>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

type RawItem = { ItemCode: string; ItemName?: string; Frozen?: string; SalesItem?: string; SalesQtyPerPackUnit?: number; BarCode?: string };
const ITEM_FIELDS = 'ItemCode,ItemName,Frozen,SalesItem,SalesQtyPerPackUnit,BarCode';

export function toItemInfo(r: RawItem): ItemInfo {
  const name = String(r.ItemName ?? '');
  const pack = Number(r.SalesQtyPerPackUnit) > 1 ? Number(r.SalesQtyPerPackUnit) : packFromName(name);
  return { ItemCode: String(r.ItemCode), ItemName: name, active: r.Frozen !== 'tYES' && r.SalesItem === 'tYES', pack, ...(r.BarCode ? { barcode: String(r.BarCode) } : {}) };
}

/** Date YYYY-MM-DD `months` before `today`. PURE. */
export function monthsBefore(today: string, months: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Customer history from crossjoin rows (Orders or Invoices × lines). Merges into `acc`. PURE. */
/** Distinct recent prices kept per item. */
const MAX_PRICES = 6;

export function mergeHistory(acc: Map<string, HistoryInfo & { docs: Set<string> }>, rows: Record<string, unknown>[], doc: 'Orders' | 'Invoices') {
  const source = doc === 'Orders' ? 'pedido' : 'factura';
  for (const row of rows) {
    const h = (row[doc] ?? {}) as Record<string, unknown>;
    const l = (row[`${doc}/DocumentLines`] ?? {}) as Record<string, unknown>;
    const code = String(l.ItemCode ?? '');
    if (!code) continue;
    const date = String(h.DocDate ?? '').slice(0, 10);
    const docKey = `${doc}:${h.DocEntry}`;
    const price = l.UnitPrice == null ? null : Number(l.UnitPrice);
    const prev = acc.get(code);
    // Lines at $0/$1 are free goods: they say nothing about the price.
    const realPrice = price != null && price > 1 ? price : null;
    if (!prev) {
      acc.set(code, { ItemCode: code, ItemName: String(l.ItemDescription ?? ''), lastDate: date, lastPrice: price, prices: realPrice ? [realPrice] : [], times: 1, source, docs: new Set([docKey]) });
      continue;
    }
    if (realPrice && !prev.prices!.includes(realPrice) && prev.prices!.length < MAX_PRICES) prev.prices!.push(realPrice);
    if (date > prev.lastDate || (date === prev.lastDate && price != null && (prev.lastPrice == null || price > prev.lastPrice))) {
      prev.lastDate = date;
      prev.lastPrice = price;
      prev.source = source;
    }
    prev.docs.add(docKey);
    prev.times = prev.docs.size;
  }
}

/** Customer history of the last 12 months (orders + invoices, not cancelled). Errors → empty (the rest still works). */
export async function customerHistory(sap: SapSession, cardCode: string, today: string): Promise<Map<string, HistoryInfo>> {
  const from = monthsBefore(today, HISTORY_MONTHS);
  const acc = new Map<string, HistoryInfo & { docs: Set<string> }>();
  for (const doc of ['Orders', 'Invoices'] as const) {
    const path =
      `$crossjoin(${doc},${doc}/DocumentLines)?$expand=${doc}($select=DocEntry,DocDate),${doc}/DocumentLines($select=ItemCode,ItemDescription,UnitPrice)` +
      `&$filter=${doc}/DocEntry eq ${doc}/DocumentLines/DocEntry and ${doc}/CardCode eq ${q(cardCode)} and ${doc}/Cancelled eq 'tNO' and ${doc}/DocDate ge ${q(from)}` +
      `&$orderby=${doc}/DocEntry desc`;
    const rows = await sapGetAll<Record<string, unknown>>(sap, path, { pageSize: 500, cap: HISTORY_CAP }).catch(() => []);
    mergeHistory(acc, rows, doc);
  }
  return new Map([...acc].map(([k, { docs: _d, ...v }]) => [k, v]));
}

export interface ResolvedLine {
  input: ImportLine;
  prediction: LinePrediction;
}

/**
 * Predicts the SAP item of every line. `input` lines may carry ItemCode (SAP code), Barcode (EAN) and
 * ClientCode (customer reference). Returns one prediction per line, in the same order.
 */
export async function resolveItems(sap: SapSession, a: { cardCode: string; input: ImportLine[]; today: string }): Promise<ResolvedLine[]> {
  const { cardCode, input } = a;
  const items = new Map<string, ItemInfo>();
  const loadItems = async (filters: string[]) => {
    for (const part of chunks(filters)) {
      const r = await sapGet<{ value?: RawItem[] }>(sap, `Items?$select=${ITEM_FIELDS}&$filter=${part.join(' or ')}`, { Prefer: `odata.maxpagesize=${CHUNK * 4}` }).catch(() => ({ value: [] }));
      for (const it of r.value ?? []) items.set(String(it.ItemCode), toItemInfo(it));
    }
  };

  // Line keys. A long numeric «code» is an EAN, not a SAP code.
  const keys = input.map((l) => {
    const rawCode = String(l.ItemCode ?? '').trim();
    const barcode = normalizeBarcode(l.Barcode) || normalizeBarcode(rawCode) || normalizeBarcode(l.ClientCode);
    const code = normalizeBarcode(rawCode) ? '' : rawCode;
    const clientRef = String(l.ClientCode ?? '').trim();
    return { code, barcode, clientRef: normalizeBarcode(clientRef) ? '' : clientRef };
  });

  // 1) Codes written on the PO (ours or the customer's reference), and the items with those barcodes.
  const codes = [...new Set(keys.flatMap((k) => [k.code, k.clientRef]).filter(Boolean))];
  await loadItems(codes.map((c) => `ItemCode eq ${q(c)}`));
  // An inactive code written on the PO: its barcode finds the active twin (e.g. 10005 → 11117).
  const twinBarcode = (code: string) => {
    const it = code ? items.get(code) : undefined;
    return it && !it.active && it.barcode ? it.barcode : '';
  };
  const barcodes = [...new Set(keys.flatMap((k) => [k.barcode, twinBarcode(k.code), twinBarcode(k.clientRef)]).filter(Boolean))];
  const byBarcode = new Map<string, Set<string>>();
  const addBc = (bc: string, code: string) => byBarcode.set(bc, new Set([...(byBarcode.get(bc) ?? []), code]));
  // Main barcode (OITM.CodeBars) is in the item; additional barcodes (OBCD) in the BarCodes entity.
  for (const part of chunks(barcodes)) {
    const r = await sapGet<{ value?: RawItem[] }>(sap, `Items?$select=${ITEM_FIELDS}&$filter=${part.map((b) => `BarCode eq ${q(b)}`).join(' or ')}`, { Prefer: `odata.maxpagesize=${CHUNK * 4}` }).catch(() => ({ value: [] }));
    for (const it of r.value ?? []) {
      items.set(String(it.ItemCode), toItemInfo(it));
      if (it.BarCode) addBc(String(it.BarCode), String(it.ItemCode));
    }
    const extra = await sapGet<{ value?: { ItemNo: string; Barcode: string }[] }>(sap, `BarCodes?$select=ItemNo,Barcode&$filter=${part.map((b) => `Barcode eq ${q(b)}`).join(' or ')}`, { Prefer: `odata.maxpagesize=${CHUNK * 4}` }).catch(() => ({ value: [] }));
    for (const x of extra.value ?? []) addBc(String(x.Barcode), String(x.ItemNo));
  }

  // 2) BP catalog numbers of this customer (reference or EAN as written by the customer).
  const byCatalog = new Map<string, Set<string>>();
  const catKeys = [...new Set(keys.flatMap((k) => [k.clientRef, k.barcode, k.code]).filter(Boolean))];
  for (const part of chunks(catKeys)) {
    const r = await sapGet<{ value?: { ItemCode: string; Substitute: string }[] }>(
      sap, `AlternateCatNum?$select=ItemCode,Substitute&$filter=CardCode eq ${q(cardCode)} and (${part.map((c) => `Substitute eq ${q(c)}`).join(' or ')})`,
      { Prefer: `odata.maxpagesize=${CHUNK * 4}` }
    ).catch(() => ({ value: [] }));
    for (const x of r.value ?? []) byCatalog.set(String(x.Substitute), new Set([...(byCatalog.get(String(x.Substitute)) ?? []), String(x.ItemCode)]));
  }

  // 3) Customer history (one bulk read, shared by all lines).
  const history = await customerHistory(sap, cardCode, a.today);

  // 4) Item master by description, only for lines without a strong key (one query per distinct search key).
  const masterByKey = new Map<string, string[]>();
  const strongOf = (i: number) => {
    const k = keys[i];
    return Boolean((k.code && items.has(k.code)) || (k.barcode && byBarcode.get(k.barcode)?.size) || [k.clientRef, k.barcode, k.code].some((c) => c && byCatalog.get(c)?.size));
  };
  for (let i = 0; i < input.length; i++) {
    if (strongOf(i) || !input[i].ItemDescription) continue;
    const terms = searchTerms(input[i].ItemDescription);
    const key = terms.join('|');
    if (!terms.length || masterByKey.has(key)) continue;
    const f = terms.map((t) => `contains(ItemName,${q(t)})`).join(' and ');
    const r = await sapGet<{ value?: RawItem[] }>(sap, `Items?$select=${ITEM_FIELDS}&$filter=${f} and Frozen eq 'tNO' and SalesItem eq 'tYES'&$top=12`, { Prefer: 'odata.maxpagesize=12' }).catch(() => ({ value: [] }));
    for (const it of r.value ?? []) items.set(String(it.ItemCode), toItemInfo(it));
    masterByKey.set(key, (r.value ?? []).map((x) => String(x.ItemCode)));
  }

  // Items referenced by barcode, catalog or history that are not loaded yet (status and pack size).
  const missing = new Set<string>();
  for (const s of [...byBarcode.values(), ...byCatalog.values()]) for (const c of s) if (!items.has(c)) missing.add(c);
  for (const c of history.keys()) if (!items.has(c)) missing.add(c);
  await loadItems([...missing].map((c) => `ItemCode eq ${q(c)}`));

  return input.map((l, i) => {
    const k = keys[i];
    const signals: LineSignals = {
      exact: k.code && items.has(k.code) ? k.code : undefined,
      barcode: [...new Set([k.barcode, twinBarcode(k.code), twinBarcode(k.clientRef)].filter(Boolean).flatMap((b) => [...(byBarcode.get(b) ?? [])]))],
      catalog: [...new Set([k.clientRef, k.barcode, k.code].filter(Boolean).flatMap((c) => [...(byCatalog.get(c) ?? [])]))],
      clientRef: k.clientRef && items.has(k.clientRef) ? k.clientRef : undefined,
      master: l.ItemDescription ? masterByKey.get(searchTerms(l.ItemDescription).join('|')) ?? [] : [],
    };
    return { input: { ...l, Barcode: k.barcode, ClientCode: k.clientRef }, prediction: rankLine(l, signals, items, history) };
  });
}
