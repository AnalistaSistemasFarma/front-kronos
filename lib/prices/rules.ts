/**
 * Actualización de listas de precios por socio de negocio (Nicolás Rivera, 2026-11-27, tras la reunión con
 * Farmalógica: «queremos un módulo para actualizar listas de precio por socio de negocio»). PURO.
 *
 * Cómo se aplica en SAP cada línea autorizada:
 *  - 'lista'    → el cliente tiene lista PROPIA (en Farmalógica casi cada cliente tiene la suya): se cambia el precio
 *                 del artículo en esa lista (Items.ItemPrices).
 *  - 'especial' → la lista la comparten otros clientes (COMERCIALIZADOR, DISTRIBUIDOR…) o no tiene lista útil
 *                 («SIN ASIGNAR»): se crea/actualiza un PRECIO ESPECIAL solo para ese cliente (SpecialPrices), así
 *                 no se le cambia el precio a nadie más.
 */
export type PriceMode = 'lista' | 'especial';

export const MAX_PRICE_LINES = 300;

/** Modo de aplicación según cuántos clientes usan la lista del cliente. PURA. */
export function decideMode(priceListNum: number | null, customersOnList: number, sinAsignar = false): PriceMode {
  if (priceListNum == null || sinAsignar) return 'especial';
  return customersOnList > 1 ? 'especial' : 'lista';
}

/** Variación porcentual del precio nuevo frente al actual (null si no hay actual). PURA. */
export function pctChange(current: number | null | undefined, next: number): number | null {
  if (current == null || !Number.isFinite(current) || current <= 0) return null;
  return Math.round(((next - current) / current) * 10000) / 100;
}

export interface PriceLineInput {
  itemCode: string;
  newPrice: number;
}

/** Limpia y valida las líneas pedidas (artículo, precio > 0, sin repetidos: gana la última). PURA. */
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

/** Asunto de la solicitud. PURA. */
export function priceRequestSubject(cardName: string, cardCode: string, n: number): string {
  return ['LP', cardName.replace(/\s+/g, ' ').trim(), cardCode.trim(), `${n} artículo${n === 1 ? '' : 's'}`].filter(Boolean).join(' - ').slice(0, 250);
}
