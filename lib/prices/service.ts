import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { companySap } from '../purchases/authorization';
import { sapGet, sapLogout, sapPatch, sapPost, SapError, type SapSession } from '../sap/serviceLayer';
import { withStep, type TriggeredBy } from '../workflow-sap/executionLog';
import { decideMode, type PriceLineInput, type PriceMode } from './rules';

/**
 * Datos de SAP del módulo de listas de precios por socio de negocio: contexto del cliente (su lista y si es
 * compartida), precio actual de cada artículo y la Tarea SAP que aplica lo autorizado.
 */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const CHUNK = 25;
const pool = () => sql.connect(sqlConfig);
const friendly = (e: unknown) => (e instanceof SapError ? e.friendly : e instanceof Error ? e.message : String(e));

export interface CustomerPriceContext {
  cardCode: string;
  cardName: string;
  priceListNum: number | null;
  priceListName: string | null;
  /** Clientes (activos o no) que usan esa lista. */
  customersOnList: number;
  mode: PriceMode;
}

export async function customerContext(sap: SapSession, cardCode: string): Promise<CustomerPriceContext> {
  const bp = await sapGet<{ CardCode: string; CardName: string; PriceListNum?: number | null; CardType?: string }>(
    sap,
    `BusinessPartners(${q(cardCode)})?$select=CardCode,CardName,PriceListNum,CardType`
  );
  const list = bp.PriceListNum == null ? null : Number(bp.PriceListNum);
  let name: string | null = null;
  let count = 0;
  if (list != null) {
    const pl = await sapGet<{ PriceListName?: string }>(sap, `PriceLists(${list})?$select=PriceListName`).catch(() => ({ PriceListName: undefined }));
    name = pl.PriceListName ?? null;
    const c = await sapGet<Record<string, unknown>>(sap, `BusinessPartners?$select=CardCode&$filter=CardType eq 'cCustomer' and PriceListNum eq ${list}&$top=2`, { Prefer: 'odata.maxpagesize=2' });
    count = ((c.value as unknown[]) ?? []).length;
  }
  const sinAsignar = /SIN\s+ASIGNAR/i.test(name ?? '');
  return { cardCode: bp.CardCode, cardName: bp.CardName, priceListNum: list, priceListName: name, customersOnList: count, mode: decideMode(list, count, sinAsignar) };
}

export interface CurrentPrice {
  itemCode: string;
  itemName: string | null;
  exists: boolean;
  salesItem: boolean;
  /** Precio que hoy le aplica al cliente (especial si existe; si no, el de su lista). */
  current: number | null;
  currency: string | null;
  special: boolean;
}

/** Precio actual de varios artículos para el cliente (lista y precios especiales), en pocas consultas. */
export async function currentPrices(sap: SapSession, ctx: CustomerPriceContext, codes: string[]): Promise<Map<string, CurrentPrice>> {
  const out = new Map<string, CurrentPrice>();
  for (let i = 0; i < codes.length; i += CHUNK) {
    const part = codes.slice(i, i + CHUNK);
    const or = part.map((c) => `ItemCode eq ${q(c)}`).join(' or ');
    const items = await sapGet<{ value?: Record<string, unknown>[] }>(sap, `Items?$select=ItemCode,ItemName,SalesItem,Frozen,ItemPrices&$filter=${or}`, { Prefer: `odata.maxpagesize=${CHUNK}` });
    const specials = await sapGet<{ value?: { ItemCode: string; Price: number; Currency?: string }[] }>(
      sap,
      `SpecialPrices?$select=ItemCode,Price,Currency&$filter=CardCode eq ${q(ctx.cardCode)} and (${or})`,
      { Prefer: `odata.maxpagesize=${CHUNK}` }
    ).catch(() => ({ value: [] }));
    const sp = new Map((specials.value ?? []).map((x) => [String(x.ItemCode), x]));
    for (const it of items.value ?? []) {
      const code = String(it.ItemCode);
      const prices = (it.ItemPrices as { PriceList: number; Price: number; Currency?: string | null }[] | undefined) ?? [];
      const own = ctx.priceListNum == null ? undefined : prices.find((p) => Number(p.PriceList) === ctx.priceListNum);
      const s = sp.get(code);
      out.set(code, {
        itemCode: code,
        itemName: it.ItemName == null ? null : String(it.ItemName),
        exists: true,
        salesItem: it.SalesItem === 'tYES' && it.Frozen !== 'tYES',
        current: s ? Number(s.Price) : own?.Price != null ? Number(own.Price) : null,
        currency: (s?.Currency || own?.Currency || null) as string | null,
        special: Boolean(s),
      });
    }
    for (const c of part) if (!out.has(c)) out.set(c, { itemCode: c, itemName: null, exists: false, salesItem: false, current: null, currency: null, special: false });
  }
  return out;
}

export type ExecResult = { ok: true; detail: string } | { ok: false; wait?: boolean; error: string };

/** Solicitud de precios enlazada a una solicitud del workflow. */
export async function priceUpdateOf(idRequest: number) {
  const p = await pool();
  const r = await p.request().input('r', sql.Int, idRequest).query(`SELECT TOP 1 * FROM dbo.price_update WHERE id_request_general = @r;`);
  return r.recordset[0] as
    | { id: number; id_company: number; card_code: string; card_name: string | null; price_list_num: number | null; lista_compartida: boolean; status: string }
    | undefined;
}

/**
 * ⚙ Tarea SAP «Aplicar precios» (al autorizar): por cada línea pendiente, cambia el precio en la lista del cliente
 * (Items.ItemPrices) o crea/actualiza su precio especial (SpecialPrices). Idempotente: las aplicadas no se repiten.
 */
export async function applyPrices(idRequest: number, triggeredBy: TriggeredBy): Promise<ExecResult> {
  const head = await priceUpdateOf(idRequest);
  if (!head) return { ok: false, error: 'La solicitud no está enlazada a una actualización de precios.' };
  if (head.status === 'applied') return { ok: true, detail: 'Precios ya aplicados en SAP' };
  const p = await pool();
  const lines = (await p.request().input('id', sql.Int, head.id).query(
    `SELECT id, item_code, new_price, currency, modo FROM dbo.price_update_line WHERE id_price_update = @id AND status <> N'applied' ORDER BY line_num;`
  )).recordset as { id: number; item_code: string; new_price: number; currency: string | null; modo: PriceMode }[];
  await p.request().input('id', sql.Int, head.id).query(`UPDATE dbo.price_update SET status = N'applying', error = NULL WHERE id = @id;`);
  let sap: SapSession | null = null;
  let ok = 0;
  const errs: string[] = [];
  try {
    sap = await companySap(head.id_company);
    const s = sap;
    for (const l of lines) {
      try {
        await withStep(
          { idRequest, stepKind: 'sap', stepName: `Precio ${l.item_code}`, actionKey: 'prices.apply', triggerEvent: 'on_execute', triggeredBy, idCompany: head.id_company, sapEntity: l.modo === 'lista' ? 'Items' : 'SpecialPrices', requestSummary: { cliente: head.card_code, articulo: l.item_code, precio: Number(l.new_price), modo: l.modo } },
          async () => {
            if (l.modo === 'lista') {
              if (head.price_list_num == null) throw new Error('El cliente no tiene lista de precios.');
              const it = await sapGet<{ ItemPrices?: { PriceList: number; Currency?: string | null }[] }>(s, `Items(${q(l.item_code)})?$select=ItemPrices`);
              const cur = it.ItemPrices?.find((x) => Number(x.PriceList) === head.price_list_num);
              if (!cur) throw new Error(`La lista ${head.price_list_num} no existe para el artículo.`);
              const body: Record<string, unknown> = { PriceList: head.price_list_num, Price: Number(l.new_price) };
              if (cur.Currency || l.currency) body.Currency = cur.Currency || l.currency;
              await sapPatch(s, `Items(${q(l.item_code)})`, { ItemPrices: [body] });
            } else {
              const key = `SpecialPrices(CardCode=${q(head.card_code)},ItemCode=${q(l.item_code)})`;
              const existing = await sapGet<{ Price?: number }>(s, `${key}?$select=Price`).catch(() => null);
              if (existing) await sapPatch(s, key, { Price: Number(l.new_price) });
              else {
                const body: Record<string, unknown> = { CardCode: head.card_code, ItemCode: l.item_code, Price: Number(l.new_price), PriceListNum: head.price_list_num ?? 1 };
                if (l.currency) body.Currency = l.currency;
                await sapPost(s, 'SpecialPrices', body);
              }
            }
          },
          () => ({ status: 'ok' })
        );
        await p.request().input('id', sql.Int, l.id).query(`UPDATE dbo.price_update_line SET status = N'applied', error = NULL, applied_at = sysutcdatetime() WHERE id = @id;`);
        ok++;
      } catch (e) {
        const msg = friendly(e).slice(0, 480);
        errs.push(`${l.item_code}: ${msg}`);
        await p.request().input('id', sql.Int, l.id).input('e', sql.NVarChar(500), msg).query(`UPDATE dbo.price_update_line SET status = N'error', error = @e WHERE id = @id;`);
      }
    }
  } catch (e) {
    errs.push(friendly(e));
  } finally {
    if (sap) await sapLogout(sap);
  }
  const final = errs.length === 0 ? 'applied' : ok > 0 ? 'partial' : 'error';
  await p.request().input('id', sql.Int, head.id).input('s', sql.NVarChar(20), final).input('e', sql.NVarChar(1000), errs.join(' · ').slice(0, 1000) || null)
    .query(`UPDATE dbo.price_update SET status = @s, error = @e, applied_at = CASE WHEN @s = N'applied' THEN sysutcdatetime() ELSE applied_at END WHERE id = @id;`);
  if (errs.length) return { ok: false, error: `${ok} de ${ok + errs.length} precios aplicados. ${errs.slice(0, 3).join(' · ')}` };
  return { ok: true, detail: `${ok} precio(s) actualizados en SAP para ${head.card_name ?? head.card_code}` };
}

export type { PriceLineInput };
