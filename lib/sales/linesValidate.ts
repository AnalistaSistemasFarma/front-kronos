import { sapGet, type SapSession } from '../sap/serviceLayer';
import type { ImportLine } from './linesImport';
import { searchTerms } from './pdfOrder';
import { customerPriceList, pickPrice } from './pricing';

/**
 * Valida contra SAP líneas que vienen de un archivo (Excel o PDF leído con IA): el artículo existe, está activo
 * y es de venta; la bodega existe (si no viene: la del artículo o la de la empresa); precio de lista SIEMPRE de
 * SAP. Con matchByDescription, las líneas sin código válido traen candidatos de SAP por la descripción.
 */
export type ValidatedLine = Record<string, unknown>;
export type PendingLine = { row: number; input: ImportLine; candidates: { ItemCode: string; ItemName: string }[] };

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const CHUNK = 25;

export async function validateLines(
  sap: SapSession,
  a: { cardCode: string; input: ImportLine[]; matchByDescription: boolean; descripcionEditable?: boolean; priceListDefault?: number | null; defaultWarehouse?: string | null }
): Promise<{ lines: ValidatedLine[]; errors: { row: number; error: string }[]; pending: PendingLine[] }> {
  const { cardCode, input, matchByDescription } = a;
  const bpList = await customerPriceList(sap, cardCode);
    const codes = [...new Set(input.map((l) => String(l.ItemCode)).filter(Boolean))];
  const items = new Map<string, Record<string, unknown>>();
  const special = new Map<string, number>();
  for (let i = 0; i < codes.length; i += CHUNK) {
    const part = codes.slice(i, i + CHUNK);
    const or = part.map((c) => `ItemCode eq ${q(c)}`).join(' or ');
    const r = await sapGet<{ value?: Record<string, unknown>[] }>(sap, `Items?$select=ItemCode,ItemName,Frozen,SalesItem,DefaultWarehouse,ItemPrices&$filter=${or}`, { Prefer: `odata.maxpagesize=${CHUNK}` });
    for (const it of r.value ?? []) items.set(String(it.ItemCode), it);
    const s = await sapGet<{ value?: { ItemCode: string; Price: number }[] }>(sap, `SpecialPrices?$select=ItemCode,Price&$filter=CardCode eq ${q(cardCode)} and (${or})`, { Prefer: `odata.maxpagesize=${CHUNK}` }).catch(() => ({ value: [] }));
    for (const x of s.value ?? []) special.set(String(x.ItemCode), Number(x.Price));
  }
  const whs = [...new Set(input.map((l) => String(l.WarehouseCode ?? '').trim()).filter(Boolean))];
  const okWh = new Set<string>();
  for (let i = 0; i < whs.length; i += CHUNK) {
    const or = whs.slice(i, i + CHUNK).map((w) => `WarehouseCode eq ${q(w)}`).join(' or ');
    const r = await sapGet<{ value?: { WarehouseCode: string }[] }>(sap, `Warehouses?$select=WarehouseCode&$filter=${or}`, { Prefer: `odata.maxpagesize=${CHUNK}` });
    for (const w of r.value ?? []) okWh.add(String(w.WarehouseCode));
  }

  const lines: Record<string, unknown>[] = [];
  const errors: { row: number; error: string }[] = [];
  const pending: PendingLine[] = [];
  for (const l of input) {
    const it = l.ItemCode ? items.get(String(l.ItemCode)) : undefined;
    if (!it && matchByDescription && l.ItemDescription) {
      // Candidatos por descripción (todas las palabras útiles), solo artículos de venta activos.
      const terms = searchTerms(l.ItemDescription);
      let candidates: { ItemCode: string; ItemName: string }[] = [];
      if (terms.length) {
        const f = terms.map((t) => `contains(ItemName,${q(t)})`).join(' and ');
        const r = await sapGet<{ value?: { ItemCode: string; ItemName: string }[] }>(sap, `Items?$select=ItemCode,ItemName&$filter=${f} and Frozen eq 'tNO' and SalesItem eq 'tYES'&$top=12`, { Prefer: 'odata.maxpagesize=12' }).catch(() => ({ value: [] }));
        candidates = (r.value ?? []).map((x) => ({ ItemCode: String(x.ItemCode), ItemName: String(x.ItemName ?? '') }));
      }
      pending.push({ row: l.row, input: l, candidates });
      continue;
    }
    if (!it) { errors.push({ row: l.row, error: `${l.ItemCode || l.ItemDescription}: el artículo no existe en SAP.` }); continue; }
    if (it.Frozen === 'tYES' || it.SalesItem !== 'tYES') { errors.push({ row: l.row, error: `${l.ItemCode}: el artículo está inactivo o no es de venta.` }); continue; }
    const wh = String(l.WarehouseCode ?? '').trim() || String(it.DefaultWarehouse ?? '') || (a.defaultWarehouse ?? '');
    if (l.WarehouseCode && !okWh.has(String(l.WarehouseCode).trim())) { errors.push({ row: l.row, error: `${l.ItemCode}: la bodega ${l.WarehouseCode} no existe en SAP.` }); continue; }
    const lp = special.has(String(l.ItemCode))
      ? { price: special.get(String(l.ItemCode)) ?? null }
      : pickPrice(it.ItemPrices as { PriceList: number; Price: number }[] | undefined, bpList, a.priceListDefault ?? null);
    const listPrice = lp.price ?? 0;
    lines.push({
      ItemCode: String(it.ItemCode),
      // Del PDF la descripción es la del cliente: en la oferta va la de SAP (salvo Excel con descripción editable).
      ItemDescription: !matchByDescription && a.descripcionEditable && l.ItemDescription ? l.ItemDescription : String(it.ItemName ?? ''),
      Quantity: Number(l.Quantity),
      ListPrice: listPrice,
      UnitPrice: l.UnitPrice != null ? Number(l.UnitPrice) : listPrice,
      WarehouseCode: wh,
    });
  }
  return { lines, errors, pending };
}
