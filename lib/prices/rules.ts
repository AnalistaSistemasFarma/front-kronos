/**
 * Customer price list updates (Nicolás Rivera, 2026-11-27, after the Farmalógica meeting: a module to update price
 * lists per business partner). PURE.
 *
 * How each approved line is applied in SAP:
 *  - 'list'    → the customer has its OWN price list (in Farmalógica almost every customer has one): the item's
 *                price in that list is changed (Items.ItemPrices).
 *  - 'special' → the list is shared with other customers (COMERCIALIZADOR, DISTRIBUIDOR…) or is not usable
 *                ("SIN ASIGNAR"): a SPECIAL price is created/updated for that customer only (SpecialPrices), so
 *                nobody else's price changes.
 */
export type PriceMode = 'list' | 'special';

export const MAX_PRICE_LINES = 300;

/** Application mode from how many customers use the customer's list. PURE. */
export function decideMode(priceListNum: number | null, customersOnList: number, unassigned = false): PriceMode {
  if (priceListNum == null || unassigned) return 'special';
  return customersOnList > 1 ? 'special' : 'list';
}

/** Percentage change of the new price versus the current one (null when there is no current price). PURE. */
export function pctChange(current: number | null | undefined, next: number): number | null {
  if (current == null || !Number.isFinite(current) || current <= 0) return null;
  return Math.round(((next - current) / current) * 10000) / 100;
}

export interface PriceLineInput {
  itemCode: string;
  newPrice: number;
}

/** Cleans and validates the requested lines (item, price > 0, no duplicates: the last one wins). PURE. */
export function sanitizePriceLines(raw: unknown): { lines: PriceLineInput[]; errors: string[] } {
  const errors: string[] = [];
  const byCode = new Map<string, PriceLineInput>();
  (Array.isArray(raw) ? raw : []).slice(0, MAX_PRICE_LINES * 2).forEach((r, i) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const code = String(x.itemCode ?? x.ItemCode ?? '').trim().slice(0, 50);
    const price = typeof x.newPrice === 'number' ? x.newPrice : Number(String(x.newPrice ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!code && (x.newPrice == null || x.newPrice === '')) return;
    if (!code) errors.push(`Línea ${i + 1}: falta el artículo.`);
    else if (!Number.isFinite(price) || price <= 0) errors.push(`${code}: el precio nuevo debe ser mayor que 0.`);
    else byCode.set(code, { itemCode: code, newPrice: Math.round(price * 1e6) / 1e6 });
  });
  const lines = [...byCode.values()];
  if (lines.length > MAX_PRICE_LINES) errors.push(`Máximo ${MAX_PRICE_LINES} artículos por solicitud.`);
  if (!lines.length && !errors.length) errors.push('Agregue al menos un artículo con su precio nuevo.');
  return { lines: lines.slice(0, MAX_PRICE_LINES), errors };
}

/** Request subject (shown to users). PURE. */
export function priceRequestSubject(cardName: string, cardCode: string, n: number): string {
  return ['LP', cardName.replace(/\s+/g, ' ').trim(), cardCode.trim(), `${n} artículo${n === 1 ? '' : 's'}`].filter(Boolean).join(' - ').slice(0, 250);
}
