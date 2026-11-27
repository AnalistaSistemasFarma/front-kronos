import { sapGet, sapGetAll, type SapSession } from '../sap/serviceLayer';
import type { ImportLine } from './linesImport';
import { normalizeBarcode, packFromName, rankLine, SALES_MONTHS, type HistoryInfo, type ItemInfo, type LinePrediction, type LineSignals, type SalesInfo } from './itemPrediction';
import { normalizeDescription, searchTokens } from './descriptionMatch';
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

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

type RawItem = {
  ItemCode: string; ItemName?: string; Frozen?: string; SalesItem?: string; SalesQtyPerPackUnit?: number; BarCode?: string;
  ItemsGroupCode?: number; QuantityOnStock?: number;
};
const ITEM_FIELDS = 'ItemCode,ItemName,Frozen,SalesItem,SalesQtyPerPackUnit,BarCode,ItemsGroupCode,QuantityOnStock';

/** Item groups that hold raw materials, semi-finished goods or packaging (by name: «MP Cefalosporinas», «PP Penicilinas»…). PURE. */
export const RAW_GROUP_RE = /^(MP|PP)\b|MATERIA[S]? PRIMA|MATERIAL DE EMPAQUE|INSUMO|ETIQUETA|PLEGADIZA|MANO DE OBRA|^CIF$/i;

export function toItemInfo(r: RawItem, rawGroups: Set<number> = new Set()): ItemInfo {
  const name = String(r.ItemName ?? '');
  const pack = Number(r.SalesQtyPerPackUnit) > 1 ? Number(r.SalesQtyPerPackUnit) : packFromName(name);
  const rawMaterial = /^MP/i.test(String(r.ItemCode)) || (r.ItemsGroupCode != null && rawGroups.has(Number(r.ItemsGroupCode)));
  return {
    ItemCode: String(r.ItemCode), ItemName: name, active: r.Frozen !== 'tYES' && r.SalesItem === 'tYES', pack,
    ...(r.BarCode ? { barcode: String(r.BarCode) } : {}),
    ...(r.QuantityOnStock != null ? { stock: Number(r.QuantityOnStock) } : {}),
    ...(rawMaterial ? { rawMaterial } : {}),
  };
}

/** Small per-company cache (item master by ingredient, company sales, item groups): the same PO is often loaded twice. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
/** For tests. */
export function clearResolverCache() { cache.clear(); }

const companyKey = (sap: SapSession) => `${sap.baseUrl ?? ''}|${sap.companyDB ?? ''}`;

async function rawItemGroups(sap: SapSession): Promise<Set<number>> {
  return cached(`groups|${companyKey(sap)}`, async () => {
    const r = await sapGetAll<{ Number: number; GroupName: string }>(sap, 'ItemGroups?$select=Number,GroupName', { pageSize: 200, cap: 1000 }).catch(() => []);
    return new Set(r.filter((g) => RAW_GROUP_RE.test(String(g.GroupName ?? '').trim())).map((g) => Number(g.Number)));
  });
}

/** Master items cap per ingredient query chunk. */
export const MASTER_CAP = 400;
/** Company-wide sales lines read per chunk of item codes (newest first). */
export const SALES_CAP = 1000;

/** Active sales items whose name contains any of the ingredient tokens. One query per chunk of 10 tokens, cached. */
async function masterByIngredients(sap: SapSession, tokens: string[]): Promise<RawItem[]> {
  const out: RawItem[] = [];
  for (const part of chunks([...new Set(tokens)].sort(), 10)) {
    const f = part.map((t) => `contains(ItemName,${q(t.toUpperCase())})`).join(' or ');
    const rows = await cached(`master|${companyKey(sap)}|${part.join(',')}`, () =>
      sapGetAll<RawItem>(sap, `Items?$select=${ITEM_FIELDS}&$filter=(${f}) and Frozen eq 'tNO' and SalesItem eq 'tYES'`, { pageSize: 200, cap: MASTER_CAP }).catch(() => [] as RawItem[]));
    out.push(...rows);
  }
  return out;
}

/** Company-wide sales (any customer) of the given items in the last SALES_MONTHS months. PURE merge. */
export function mergeSales(rows: Record<string, unknown>[]): Map<string, SalesInfo> {
  const acc = new Map<string, SalesInfo & { docs_: Set<string> }>();
  for (const row of rows) {
    const h = (row.Invoices ?? {}) as Record<string, unknown>;
    const l = (row['Invoices/DocumentLines'] ?? {}) as Record<string, unknown>;
    const code = String(l.ItemCode ?? '');
    if (!code) continue;
    const price = Number(l.UnitPrice);
    const date = String(h.DocDate ?? '').slice(0, 10);
    const s = acc.get(code) ?? { docs: 0, prices: [], lastDate: date, docs_: new Set<string>() };
    s.docs_.add(String(h.DocEntry));
    s.docs = s.docs_.size;
    if (price > 1 && !s.prices.includes(price) && s.prices.length < MAX_PRICES) s.prices.push(price);
    if (date > s.lastDate) s.lastDate = date;
    acc.set(code, s);
  }
  return new Map([...acc].map(([k, { docs_: _d, ...v }]) => [k, v]));
}

async function companySales(sap: SapSession, codes: string[], today: string): Promise<Map<string, SalesInfo>> {
  const from = monthsBefore(today, SALES_MONTHS);
  const out = new Map<string, SalesInfo>();
  for (const part of chunks([...new Set(codes)].sort(), 20)) {
    const f = part.map((c) => `Invoices/DocumentLines/ItemCode eq ${q(c)}`).join(' or ');
    const path =
      `$crossjoin(Invoices,Invoices/DocumentLines)?$expand=Invoices($select=DocEntry,DocDate),Invoices/DocumentLines($select=ItemCode,UnitPrice)` +
      `&$filter=Invoices/DocEntry eq Invoices/DocumentLines/DocEntry and Invoices/Cancelled eq 'tNO' and Invoices/DocDate ge ${q(from)} and (${f})` +
      `&$orderby=Invoices/DocEntry desc`;
    const m = await cached(`sales|${companyKey(sap)}|${from}|${part.join(',')}`, async () =>
      mergeSales(await sapGetAll<Record<string, unknown>>(sap, path, { pageSize: 500, cap: SALES_CAP }).catch(() => [])));
    for (const [k, v] of m) out.set(k, v);
  }
  return out;
}

/** Date YYYY-MM-DD `months` before `today`. PURE. */
export function monthsBefore(today: string, months: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Distinct recent prices kept per item. */
const MAX_PRICES = 6;

/** Customer history from crossjoin rows (Orders or Invoices × lines). Merges into `acc`. PURE. */
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

  // 4) Item master by description, only for lines without a strong key. Lines with an active ingredient: ONE bulk
  //    query by ingredient tokens (all lines), cached. Lines without one: the previous search by description words.
  const masterByKey = new Map<string, string[]>();
  const masterOf = new Map<number, string[]>();
  const strongOf = (i: number) => {
    const k = keys[i];
    return Boolean((k.code && items.has(k.code)) || (k.barcode && byBarcode.get(k.barcode)?.size) || [k.clientRef, k.barcode, k.code].some((c) => c && byCatalog.get(c)?.size));
  };
  const descLines = input.map((l, i) => ({ i, l })).filter(({ i, l }) => !strongOf(i) && l.ItemDescription);
  const tokensOf = new Map(descLines.map(({ i, l }) => [i, searchTokens(normalizeDescription(String(l.ItemDescription)))]));
  const allTokens = [...new Set([...tokensOf.values()].flat())];
  let rawGroups = new Set<number>();
  if (allTokens.length) {
    rawGroups = await rawItemGroups(sap);
    const found = await masterByIngredients(sap, allTokens);
    for (const it of found) items.set(String(it.ItemCode), toItemInfo(it, rawGroups));
    const norm = new Map(found.map((it) => [String(it.ItemCode), normalizeDescription(String(it.ItemName ?? '')).text]));
    for (const [i, toks] of tokensOf) {
      if (!toks.length) continue;
      masterOf.set(i, [...norm].filter(([, n]) => toks.every((t) => n.includes(t))).map(([c]) => c));
    }
  }
  for (const { i, l } of descLines) {
    if (tokensOf.get(i)?.length) continue;
    const terms = searchTerms(String(l.ItemDescription));
    const key = terms.join('|');
    if (!terms.length) continue;
    if (!masterByKey.has(key)) {
      const f = terms.map((t) => `contains(ItemName,${q(t)})`).join(' and ');
      const r = await sapGet<{ value?: RawItem[] }>(sap, `Items?$select=${ITEM_FIELDS}&$filter=${f} and Frozen eq 'tNO' and SalesItem eq 'tYES'&$top=12`, { Prefer: 'odata.maxpagesize=12' }).catch(() => ({ value: [] }));
      for (const it of r.value ?? []) items.set(String(it.ItemCode), toItemInfo(it, rawGroups));
      masterByKey.set(key, (r.value ?? []).map((x) => String(x.ItemCode)));
    }
    masterOf.set(i, masterByKey.get(key) ?? []);
  }

  // 5) Company-wide sales of the description candidates (any customer, last months): one bulk read, cached.
  const salesCodes = [...new Set([...masterOf.values()].flat())].filter((c) => items.get(c)?.active).slice(0, 100);
  const sales = salesCodes.length ? await companySales(sap, salesCodes, a.today) : new Map<string, SalesInfo>();

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
      master: masterOf.get(i) ?? [],
    };
    return { input: { ...l, Barcode: k.barcode, ClientCode: k.clientRef }, prediction: rankLine(l, signals, items, history, sales) };
  });
}
