/**
 * Item prediction for purchase-order lines read from a customer PDF (Nicolás Rivera, 2026-11-27, SynerLink msg 41219).
 * Real customer POs (e.g. Coopidrogas) rarely carry OUR item code: they carry the EAN/GTIN, the customer's own
 * reference and a short description, and quantities are often in boxes while SAP sells by unit. This module ranks
 * the SAP items that a line may correspond to, using (in order of strength):
 *   1) exact SAP item code, 2) barcode (OITM.CodeBars + additional barcodes), 3) BP catalog number,
 *   4) the customer's own sales history (orders + invoices, last 12 months) and 5) item master description match.
 * PURE: no I/O. The server resolver (itemResolver.ts) gathers the data and calls rankLine.
 */
import { similarity } from './pdfOrder';
import { matchDescription, normalizeDescription, priceDistance, type DescriptionMatch, type SalesInfo } from './descriptionMatch';

export type { SalesInfo } from './descriptionMatch';

export type Confidence = 'alta' | 'media' | 'baja' | 'ninguna';

export interface ItemInfo {
  ItemCode: string;
  ItemName: string;
  /** Not frozen and a sales item: only these can go in the offer. */
  active: boolean;
  /** Units per sales package (SalesQtyPerPackUnit, or the «CAJA X N» of the name). */
  pack: number;
  /** Main barcode (OITM.CodeBars): links an inactive item to its active twin. */
  barcode?: string;
  /** Stock on hand (all warehouses); undefined when unknown. */
  stock?: number;
  /** Raw material / semi-finished / packaging (item group MP, PP…): not what a customer orders. */
  rawMaterial?: boolean;
}

export interface HistoryInfo {
  ItemCode: string;
  ItemName: string;
  lastDate: string;
  /** Highest unit price of the most recent document (lines at $1 are free goods). */
  lastPrice: number | null;
  /** Recent distinct unit prices, newest first (orders and invoices may differ: discounts, price changes). */
  prices?: number[];
  /** Number of distinct documents (orders + invoices) with the item. */
  times: number;
  /** Source of the most recent document. */
  source: 'pedido' | 'factura';
}

export interface LineSignals {
  /** SAP code written on the line that exists in SAP. */
  exact?: string;
  /** Items whose barcode (main or additional) is the line EAN. */
  barcode: string[];
  /** Items whose BP catalog number (for this customer) is the line reference/EAN. */
  catalog: string[];
  /** Item whose SAP code equals the customer reference printed on the PO. */
  clientRef?: string;
  /** Item master matches by description (active sales items). */
  master: string[];
}

export interface PredictionLine {
  Quantity: number;
  UnitPrice: number | null;
  ItemDescription: string;
}

export interface Candidate {
  ItemCode: string;
  ItemName: string;
  /** 0..1 for display. */
  score: number;
  reason: string;
  /** Units per PO unit: 1, or the pack size when the PO price is a box price. */
  factor: number;
}

export interface LinePrediction {
  confidence: Confidence;
  reason: string;
  /** Best first, at most 3. Only active sales items. */
  candidates: Candidate[];
  /** Selected automatically (high confidence): the user does not need to confirm it. */
  autoSelected: boolean;
}

export const EAN_RE = /^\d{8}$|^\d{12,14}$/;

/** Digits of a barcode («7707234231363», «770-7234-23136-3» → digits). Empty if it does not look like an EAN/GTIN. PURE. */
export function normalizeBarcode(v: unknown): string {
  const d = String(v ?? '').replace(/[\s.-]/g, '');
  return EAN_RE.test(d) ? d : '';
}

/** Pack size from the item name («... CAJA X 25» → 25). PURE. */
export function packFromName(name: string): number {
  const m = String(name ?? '').toUpperCase().match(/\b(?:CAJA|CJ|BOLSA|PAQUETE|PAQ|FRASCO)\s*X\s*(\d{1,4})\b/);
  return m ? Number(m[1]) : 1;
}

/** First factor that matches any of the reference prices (newest first). PURE. */
export function priceFactorAny(poPrice: number | null, refPrices: (number | null)[], pack: number): number | null {
  for (const r of refPrices) {
    const f = priceFactor(poPrice, r, pack);
    if (f != null) return f;
  }
  return null;
}

const refPricesOf = (h: HistoryInfo | undefined): (number | null)[] => (h ? (h.prices?.length ? h.prices : [h.lastPrice]) : []);

/** Tolerance between the PO price and the reference price (gross vs net, customer discounts of 12-14 % seen on Coopidrogas invoices). Pack factors are 2x apart or more, so this never confuses unit and box prices. */
export const PRICE_TOLERANCE = 0.15;

/**
 * Does the PO price match the reference unit price, directly (factor 1) or as a box price (factor = pack)?
 * Returns the factor or null. PURE.
 */
export function priceFactor(poPrice: number | null, refPrice: number | null, pack: number): number | null {
  if (!poPrice || !refPrice || poPrice <= 0 || refPrice <= 0) return null;
  const ratio = poPrice / refPrice;
  if (Math.abs(ratio - 1) <= PRICE_TOLERANCE) return 1;
  if (pack > 1 && Math.abs(ratio / pack - 1) <= PRICE_TOLERANCE) return pack;
  return null;
}

const W = { exact: 1.0, barcode: 0.9, catalog: 0.9, clientRef: 0.5, history: 0.3, historyFrequent: 0.05, desc: 0.4, price: 0.15 };
/** Description model (lines without a strong key): ingredient, strength, presentation, company sales, price, penalties. */
export const WD = { ingredient: 0.3, strength: 0.2, strengthClash: -0.15, form: 0.03, sold: 0.15, priceClose: 0.15, priceNear: 0.07, exportVariant: -0.3, rawMaterial: -0.4, noStock: -0.1 };
/** Months of company-wide sales read for the description model. */
export const SALES_MONTHS = 6;
/** Score that maps to 100 % on screen. */
const FULL = 1.6;
/** History match by description needs at least this similarity to count as «alta». */
export const HISTORY_STRICT_SIM = 0.75;

type Scored = Candidate & { raw: number; strong: boolean; inHistory: boolean; descSim: number; priceOk: boolean; dm?: DescriptionMatch; sold: number };

/**
 * Ranks the SAP items for one PO line. `items` must include every code referenced by the signals and by the
 * history. Returns top 3 with confidence:
 *  - alta: exact code, or a barcode/catalog match that is unique among active items (ties broken by the customer
 *    history), or a strict history match (description + price); never when the customer bought a now-inactive
 *    item with the same barcode/reference (the active twin must be confirmed);
 *  - media: best score ≥ 0.5 (raw); baja: anything weaker that still has evidence.
 */
export function rankLine(
  line: PredictionLine, signals: LineSignals, items: Map<string, ItemInfo>, history: Map<string, HistoryInfo>, sales: Map<string, SalesInfo> = new Map()
): LinePrediction {
  const desc = String(line.ItemDescription ?? '').trim();
  const po = desc ? normalizeDescription(desc) : null;
  const codes = new Set<string>([
    ...(signals.exact ? [signals.exact] : []),
    ...signals.barcode,
    ...signals.catalog,
    ...(signals.clientRef ? [signals.clientRef] : []),
    ...signals.master,
  ]);
  // Customer history: by description (or, without description, by price only when nothing else matched).
  for (const h of history.values()) {
    if (codes.has(h.ItemCode)) continue;
    const it = items.get(h.ItemCode);
    if (desc) {
      if (similarity(desc, h.ItemName) >= 0.34 || (po?.ingredients.length && matchDescription(po, h.ItemName, h.ItemCode).ingredientOk)) codes.add(h.ItemCode);
    } else if (!codes.size && it && priceFactorAny(line.UnitPrice, refPricesOf(h), it.pack) != null) {
      codes.add(h.ItemCode);
    }
  }

  // Items the customer bought that are now inactive and share the barcode/reference: their last price still tells
  // whether the PO price is per unit or per box for the active twin.
  const isStrongKey = (c: string) => signals.exact === c || signals.barcode.includes(c) || signals.catalog.includes(c) || signals.clientRef === c;
  const replacedHist = [...codes].filter((c) => items.get(c) && !items.get(c)!.active && history.has(c) && isStrongKey(c)).map((c) => history.get(c)!);
  const replacedPrices = replacedHist.flatMap(refPricesOf);

  const all: Scored[] = [];
  for (const code of codes) {
    const it = items.get(code);
    if (!it) continue;
    const h = history.get(code);
    const reasons: string[] = [];
    let raw = 0;
    const isExact = signals.exact === code;
    const isBarcode = signals.barcode.includes(code);
    const isCatalog = signals.catalog.includes(code);
    if (isExact) { raw += W.exact; reasons.push('Código del artículo en SAP'); }
    if (isBarcode) { raw += W.barcode; reasons.push('Coincide con el código de barras'); }
    if (isCatalog) { raw += W.catalog; reasons.push('Número de catálogo del cliente'); }
    if (signals.clientRef === code && !isExact) { raw += W.clientRef; reasons.push('La referencia del cliente es el código del artículo'); }
    if (h) {
      raw += W.history + (h.times >= 3 ? W.historyFrequent : 0);
      reasons.push(`${h.source === 'pedido' ? 'Pedido anterior' : 'Factura anterior'} del cliente ${h.lastDate}`);
    }
    const descSim = desc ? Math.max(similarity(desc, it.ItemName), h ? similarity(desc, h.ItemName) : 0) : 0;
    if (descSim > 0) raw += W.desc * descSim;
    const strong = isExact || isBarcode || isCatalog;
    // Description model: candidates found by description, and the customer's own history (ingredient and strength
    // only, so that what the customer already buys stays ahead of a best seller found by description).
    const byDescription = !strong && !h && signals.clientRef !== code;
    let dm: DescriptionMatch | undefined;
    let sold = 0;
    let salesFactor: number | null = null;
    if (!strong && signals.clientRef !== code && po?.ingredients.length) {
      dm = matchDescription(po, it.ItemName, it.ItemCode);
      if (byDescription && !dm.ingredientOk) continue; // the active ingredient is required
      if (dm.ingredientOk) {
        raw += WD.ingredient * dm.ingredientShare;
        if (dm.strengthOk) { raw += WD.strength; reasons.push('Coincide principio activo y concentración'); }
        else { reasons.push('Coincide principio activo'); if (dm.strengthClash) { raw += WD.strengthClash; reasons.push('Concentración distinta'); } }
        if (dm.formOk) raw += WD.form;
      }
      if (byDescription) {
        if (dm.exportVariant) { raw += WD.exportVariant; reasons.push('Variante de exportación'); }
        if (it.rawMaterial) { raw += WD.rawMaterial; reasons.push('Materia prima o insumo'); }
        if (it.stock != null && it.stock <= 0) { raw += WD.noStock; reasons.push('Sin existencias'); }
      }
      const s = sales.get(code);
      sold = s?.docs ?? 0;
      if (byDescription && s && sold > 0) {
        const pd = priceDistance(line.UnitPrice, s.prices, it.pack);
        if (pd && pd.diff <= PRICE_TOLERANCE) { raw += WD.priceClose; reasons.push('Precio cercano'); salesFactor = pd.factor; }
        else if (pd && pd.diff <= 0.35) { raw += WD.priceNear; reasons.push('Precio parecido'); salesFactor = pd.factor; }
      }
    } else if (!strong && !h && descSim >= 0.34) reasons.push('Parecido por descripción');
    const refs = h ? refPricesOf(h) : isExact || isBarcode || isCatalog ? replacedPrices : [];
    const factor = priceFactorAny(line.UnitPrice, refs, it.pack) ?? (salesFactor && salesFactor > 1 ? salesFactor : null);
    if (factor != null && salesFactor == null) {
      raw += W.price;
      reasons.push(factor === 1 ? 'Precio igual al anterior' : `Precio por caja x ${factor}`);
      if (!h) raw -= W.price; // price taken from the inactive twin: informative, it does not add confidence
    }
    all.push({
      ItemCode: it.ItemCode, ItemName: it.ItemName, raw, score: 0, reason: reasons.join(' · '), factor: factor ?? 1,
      strong, inHistory: Boolean(h), descSim, priceOk: factor != null, dm, sold,
    });
  }
  // Company-wide sales: relative to the best seller among this line's candidates (log scale, explainable).
  const maxSold = Math.max(0, ...all.map((c) => c.sold));
  for (const c of all) {
    if (!c.sold) continue;
    c.raw += WD.sold * (Math.log1p(c.sold) / Math.log1p(maxSold));
    c.reason += c.sold === maxSold ? ' · Más vendido' : ` · Vendido en ${c.sold} factura(s) recientes`;
  }

  const inactive = all.filter((c) => !items.get(c.ItemCode)?.active);
  // Ties (same name, same evidence): the one sold more, then the one with more stock, then the code (deterministic).
  const stockOf = (c: Scored) => items.get(c.ItemCode)?.stock ?? 0;
  const active = all
    .filter((c) => items.get(c.ItemCode)?.active)
    .sort((a, b) => b.raw - a.raw || Number(b.inHistory) - Number(a.inHistory) || b.sold - a.sold || stockOf(b) - stockOf(a) || a.ItemCode.localeCompare(b.ItemCode));
  // The customer bought an item that is now inactive and shares the barcode/reference: point to it.
  // Inactive item the customer bought, or the inactive code written on the PO itself.
  const replaced = inactive.filter((c) => (c.inHistory && (c.strong || signals.clientRef === c.ItemCode)) || signals.exact === c.ItemCode || signals.clientRef === c.ItemCode);
  for (const c of active) {
    if (c.strong && replaced.length) {
      const bought = replaced.filter((r) => r.inHistory).map((r) => r.ItemCode);
      const written = replaced.filter((r) => !r.inHistory).map((r) => r.ItemCode);
      if (bought.length) c.reason += ` · El cliente compraba ${bought.join(', ')} (inactivo)`;
      if (written.length) c.reason += ` · La OC trae ${written.join(', ')} (inactivo)`;
    }
    c.score = Math.min(1, Math.round((c.raw / FULL) * 100) / 100);
  }
  const top = active[0];
  // Description fallback: never empty when the master has plausible items (same active ingredient).
  const plausible = active.filter((c) => c.dm?.ingredientOk);
  if ((!top || top.raw < 0.2) && plausible.length) {
    const candidates = plausible.slice(0, 3).map(({ ItemCode, ItemName, score, reason, factor }) => ({ ItemCode, ItemName, score, reason, factor }));
    return { confidence: 'baja', reason: `Coincidencia aproximada por descripción: ${candidates[0].reason}`, candidates, autoSelected: false };
  }
  if (!top || top.raw < 0.2) {
    const why = replaced.length
      ? `${replaced.map((r) => `${r.ItemCode} ${r.ItemName}`).join(', ')} está inactivo; elija el artículo.`
      : 'No se encontró en SAP; búsquelo.';
    return { confidence: 'ninguna', reason: why, candidates: [], autoSelected: false };
  }
  const second = active[1];
  const strongActive = active.filter((c) => c.strong);
  let confidence: Confidence;
  const uniqueStrong = top.strong && (strongActive.length === 1 || (top.inHistory && strongActive.filter((c) => c.inHistory).length === 1));
  const strictHistory = top.inHistory && top.descSim >= HISTORY_STRICT_SIM && top.priceOk && (!second || top.raw - second.raw >= 0.25);
  if (signals.exact === top.ItemCode || ((uniqueStrong || strictHistory) && !replaced.length)) confidence = 'alta';
  else if (top.dm && !top.inHistory) {
    // Found by description only: at most «media», and only with ingredient + strength + market evidence and a clear lead.
    const evidence = top.sold > 0 || top.reason.includes('Precio cercano');
    const clean = top.dm.strengthOk && !top.dm.exportVariant && !items.get(top.ItemCode)?.rawMaterial;
    confidence = clean && evidence && (!second || top.raw - second.raw >= 0.1) ? 'media' : 'baja';
  } else if (top.raw >= 0.5) confidence = 'media';
  else confidence = 'baja';
  const candidates = active.slice(0, 3).map(({ ItemCode, ItemName, score, reason, factor }) => ({ ItemCode, ItemName, score, reason, factor }));
  return { confidence, reason: top.reason, candidates, autoSelected: confidence === 'alta' };
}

/** Unit quantity and price for a PO line given the candidate factor (box → units). PURE. */
export function convertLine(qty: number, price: number | null, factor: number): { Quantity: number; UnitPrice: number | null } {
  if (!factor || factor === 1) return { Quantity: qty, UnitPrice: price };
  return { Quantity: qty * factor, UnitPrice: price == null ? null : Math.round((price / factor) * 10000) / 10000 };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'Alta', media: 'Media', baja: 'Baja', ninguna: 'Sin artículo' };
