import { sapGet, type SapSession } from '../sap/serviceLayer';

/**
 * Precio de lista de artículos para un cliente, como SAPSEND: precio especial del cliente o, si no hay, el de
 * la lista de precios del cliente (PriceListNum → Items.ItemPrices). Si el cliente no tiene precio en su lista
 * (OLP: todos en «SIN ASIGNAR») y la empresa configuró una lista por defecto, se usa esa.
 */
export type PriceSource = 'especial' | 'lista' | 'lista_defecto' | 'sin_precio';
export interface ItemPrice { price: number | null; source: PriceSource; priceList: number | null }

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Elige el precio entre la lista del cliente y la de defecto. PURA. */
export function pickPrice(itemPrices: { PriceList: number; Price: number }[] | undefined, bpList: number | null, defaultList: number | null): ItemPrice {
  const find = (list: number | null) => (list == null ? undefined : itemPrices?.find((x) => Number(x.PriceList) === Number(list)));
  const own = find(bpList);
  if (own && Number(own.Price) > 0) return { price: Number(own.Price), source: 'lista', priceList: Number(bpList) };
  const def = find(defaultList);
  if (def && Number(def.Price) > 0) return { price: Number(def.Price), source: 'lista_defecto', priceList: Number(defaultList) };
  if (own) return { price: Number(own.Price), source: 'lista', priceList: Number(bpList) };
  return { price: null, source: 'sin_precio', priceList: null };
}

export async function customerPriceList(sap: SapSession, cardCode: string): Promise<number | null> {
  const bp = await sapGet<{ PriceListNum?: number }>(sap, `BusinessPartners(${q(cardCode)})?$select=PriceListNum`);
  return bp.PriceListNum == null ? null : Number(bp.PriceListNum);
}

export async function itemPriceFor(sap: SapSession, cardCode: string, itemCode: string, bpList: number | null, defaultList: number | null): Promise<ItemPrice> {
  try {
    const spc = await sapGet<{ Price?: number }>(sap, `SpecialPrices(CardCode=${q(cardCode)},ItemCode=${q(itemCode)})?$select=Price`);
    if (spc?.Price != null) return { price: Number(spc.Price), source: 'especial', priceList: null };
  } catch {
    /* sin precio especial */
  }
  const item = await sapGet<{ ItemPrices?: { PriceList: number; Price: number }[] }>(sap, `Items(${q(itemCode)})?$select=ItemPrices`);
  return pickPrice(item.ItemPrices, bpList, defaultList);
}
