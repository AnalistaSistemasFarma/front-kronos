import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { companySap } from '../purchases/authorization';
import { todayBogota } from '../purchases/drafts';
import { sapGet, sapGetAll, sapLogout, sapPatch, sapPost, SapError, type SapSession } from '../sap/serviceLayer';
import { withStep, type TriggeredBy } from '../workflow-sap/executionLog';
import { EVAL_FIELD_LABEL, optionsForCreditRecheck, optionsForSend, rejectedStateFor, traceFieldFor } from './flowOptions';
import { buildOrderPayload, orderLookupFilter, type SalesDraft } from './publish';
import {
  DEFAULT_RULES,
  destinoTrasAprobarPrecios,
  evaluarEnvio,
  type CupoInput,
  type SalesLine,
  type SalesRulesConfig,
} from './rules';
import { normalizeState } from './states';

/**
 * Ejecutores de las Tareas SAP del flujo «Oferta de venta» (dominio Ventas del
 * catalogo de lib/workflow-sap). Cada funcion es idempotente y devuelve el mismo
 * contrato que runAction del motor: { ok, detail } o { ok:false, error, wait? }.
 *
 * El enlace solicitud <-> borrador vive en dbo.sales_authorization (una fila por
 * solicitud). La configuracion por empresa, en dbo.sales_company_config.
 * Se usa mssql directo (no Prisma) para no depender de regenerar el cliente.
 */

export type ExecResult = { ok: true; detail: string } | { ok: false; wait?: boolean; error: string };

interface SalesLink {
  id: number;
  id_company: number;
  doc_entry: number;
  status: string;
  order_doc_entry: number | null;
}

const friendly = (e: unknown) => (e instanceof SapError ? e.friendly : e instanceof Error ? e.message : String(e));

async function pool() {
  return sql.connect(sqlConfig);
}

/** Enlace de la solicitud con su borrador de venta, o null si la solicitud no es de ventas. */
export async function salesLinkOf(idRequest: number): Promise<SalesLink | null> {
  const p = await pool();
  const r = await p.request().input('req', sql.Int, idRequest).query<SalesLink>(`
    SELECT TOP 1 id, id_company, doc_entry, status, order_doc_entry
    FROM dbo.sales_authorization WHERE id_request_general = @req;`);
  return r.recordset[0] ?? null;
}

async function updateLink(id: number, data: { status?: string; order_doc_entry?: number | null; error?: string | null; evaluacion?: unknown }) {
  const p = await pool();
  await p
    .request()
    .input('id', sql.Int, id)
    .input('status', sql.NVarChar(20), data.status ?? null)
    .input('order', sql.Int, data.order_doc_entry ?? null)
    .input('error', sql.NVarChar(500), data.error === undefined ? null : (data.error ?? '').slice(0, 500))
    .input('setError', sql.Bit, data.error !== undefined ? 1 : 0)
    .input('eval', sql.NVarChar(sql.MAX), data.evaluacion === undefined ? null : JSON.stringify(data.evaluacion))
    .query(`UPDATE dbo.sales_authorization SET
              status = COALESCE(@status, status),
              order_doc_entry = COALESCE(@order, order_doc_entry),
              error = CASE WHEN @setError = 1 THEN NULLIF(@error, N'') ELSE error END,
              evaluacion = COALESCE(@eval, evaluacion),
              updated_at = sysutcdatetime()
            WHERE id = @id;`);
}

/** Reglas de la empresa. Sin fila de configuracion: valores por defecto (precio + cupo, 20 %). */
export async function rulesFor(idCompany: number): Promise<SalesRulesConfig & { estadosSumaCupo: string[] }> {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).query(`
    SELECT valida_precio, precio_solo_si_menor, tolerancia_precio, pct_tolerancia_cupo, estados_suma_cupo
    FROM dbo.sales_company_config WHERE id_company = @c;`);
  const row = r.recordset[0];
  if (!row) return { ...DEFAULT_RULES, estadosSumaCupo: ['AE', 'AEDA'] };
  return {
    ...DEFAULT_RULES,
    validaPrecio: Boolean(row.valida_precio),
    precioSoloSiMenor: Boolean(row.precio_solo_si_menor),
    toleranciaPrecio: Number(row.tolerancia_precio ?? 0),
    pctToleranciaCupo: Number(row.pct_tolerancia_cupo ?? 20),
    estadosSumaCupo: String(row.estados_suma_cupo ?? 'AE,AEDA')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{1,6}$/.test(s)),
  };
}

/** Marca una opcion del campo de evaluacion en la solicitud (idempotente, locked). */
async function markOption(idRequest: number, optionLabel: string): Promise<void> {
  const p = await pool();
  const r = await p
    .request()
    .input('req', sql.Int, idRequest)
    .input('field', sql.NVarChar(200), EVAL_FIELD_LABEL)
    .input('opt', sql.NVarChar(200), optionLabel).query(`
      SELECT TOP 1 f.id AS id_field, o.id AS id_option
      FROM process_category_request_general pcr
      INNER JOIN process_form_field f ON f.id_process_category = pcr.id_process_category AND f.field_label = @field
      INNER JOIN process_form_field_option o ON o.id_form_field = f.id AND o.option_label = @opt AND ISNULL(o.active, 1) = 1
      WHERE pcr.id_request_general = @req;`);
  const hit = r.recordset[0];
  if (!hit) {
    throw new Error(`El flujo no tiene el campo «${EVAL_FIELD_LABEL}» con la opción «${optionLabel}». Revise la configuración del proceso.`);
  }
  await p
    .request()
    .input('req', sql.Int, idRequest)
    .input('f', sql.Int, hit.id_field)
    .input('o', sql.Int, hit.id_option).query(`
      IF NOT EXISTS (SELECT 1 FROM request_form_value WHERE id_request_general = @req AND id_option = @o)
        INSERT INTO request_form_value (id_request_general, id_form_field, id_option, value_text, locked)
        VALUES (@req, @f, @o, NULL, 1);`);
}

function lineOf(l: Record<string, unknown>): SalesLine {
  const lp = l.U_SEND_PriceLP;
  return {
    itemCode: String(l.ItemCode ?? ''),
    unitPrice: Number(l.UnitPrice ?? l.Price ?? 0),
    listPrice: lp == null || lp === '' ? null : Number(lp),
  };
}

/** Precio de lista del cliente para un articulo: precio especial o lista del cliente. */
async function listPrice(sap: SapSession, cardCode: string, priceList: number | null, itemCode: string): Promise<number | null> {
  const esc = (v: string) => v.replace(/'/g, "''");
  try {
    const sp = await sapGet<{ Price?: number }>(sap, `SpecialPrices(CardCode='${esc(cardCode)}',ItemCode='${esc(itemCode)}')?$select=Price`);
    if (sp?.Price != null) return Number(sp.Price);
  } catch {
    /* sin precio especial */
  }
  if (priceList == null) return null;
  const item = await sapGet<{ ItemPrices?: { PriceList: number; Price: number }[] }>(
    sap,
    `Items('${esc(itemCode)}')?$select=ItemPrices`
  );
  const p = item.ItemPrices?.find((x) => Number(x.PriceList) === Number(priceList));
  return p ? Number(p.Price) : null;
}

/** Datos de SAP para el motor: borrador, cupo del cliente y suma de sus otras ofertas en autorizacion de cupo. */
async function loadEvaluationInput(sap: SapSession, docEntry: number, estadosSuma: string[], needPrices: boolean) {
  const draft = await sapGet<SalesDraft & Record<string, unknown>>(sap, `Drafts(${docEntry})`);
  if (draft.DocObjectCode !== 'oOrders') throw new Error(`El borrador ${docEntry} no es una oferta de venta.`);
  const cardCode = String(draft.CardCode).replace(/'/g, "''");
  const bp = await sapGet<{ CreditLimit?: number; CurrentAccountBalance?: number; OpenDeliveryNotesBalance?: number; OpenOrdersBalance?: number; PriceListNum?: number }>(
    sap,
    `BusinessPartners('${cardCode}')?$select=CreditLimit,CurrentAccountBalance,OpenDeliveryNotesBalance,OpenOrdersBalance,PriceListNum`
  );
  let otras = 0;
  if (estadosSuma.length) {
    const states = estadosSuma.map((s) => `U_SEND_State eq '${s}'`).join(' or ');
    const rows = await sapGetAll<{ DocEntry: number; DocTotal: number }>(
      sap,
      `Drafts?$select=DocEntry,DocTotal&$filter=CardCode eq '${cardCode}' and DocObjectCode eq 'oOrders' and DocumentStatus eq 'bost_Open' and (${states})`,
      { cap: 2000 }
    );
    otras = rows.filter((r) => Number(r.DocEntry) !== docEntry).reduce((a, r) => a + Number(r.DocTotal ?? 0), 0);
  }
  const lines = (draft.DocumentLines ?? []).map((l) => lineOf(l as Record<string, unknown>));
  if (needPrices) {
    for (const l of lines) {
      if (l.listPrice == null && l.itemCode) l.listPrice = await listPrice(sap, String(draft.CardCode), bp.PriceListNum ?? null, l.itemCode);
    }
  }
  const cupo: CupoInput = {
    client: {
      creditLimit: Number(bp.CreditLimit ?? 0),
      currentAccountBalance: Number(bp.CurrentAccountBalance ?? 0),
      openDeliveryNotesBalance: Number(bp.OpenDeliveryNotesBalance ?? 0),
      openOrdersBalance: Number(bp.OpenOrdersBalance ?? 0),
    },
    otrasOfertasEnCupo: otras,
    docTotal: Number(draft.DocTotal ?? 0),
  };
  return { draft, lines, cupo };
}

const money = (n: number) => Math.round(n).toLocaleString('es-CO');

/** ⚡ Evaluar reglas de venta: decide la rama del flujo y la marca en la solicitud. */
export async function evaluateRules(idRequest: number, triggeredBy: TriggeredBy): Promise<ExecResult> {
  const link = await salesLinkOf(idRequest);
  if (!link) return { ok: false, error: 'La solicitud no está enlazada a una oferta de venta.' };
  const rules = await rulesFor(link.id_company);
  let sap: SapSession | null = null;
  try {
    sap = await companySap(link.id_company);
    const s = sap;
    const { draft, lines, cupo } = await loadEvaluationInput(s, link.doc_entry, rules.estadosSumaCupo, rules.validaPrecio);
    const state = normalizeState(draft.U_SEND_State);
    if (state !== 'B') return { ok: false, error: `La oferta debe estar en borrador para evaluarla (estado actual: ${state ?? 'sin estado'}).` };
    const ev = await withStep(
      { idRequest, stepKind: 'sap', stepName: 'Evaluar reglas de venta', actionKey: 'sales.evaluate_rules', triggerEvent: 'on_execute', triggeredBy, idCompany: link.id_company, sapEntity: 'Drafts', requestSummary: { docEntry: link.doc_entry } },
      async () => evaluarEnvio(lines, cupo, rules),
      (r) => ({ status: 'ok', sapDocEntry: link.doc_entry, responseSummary: { destino: r.destino, cupo: r.cupo, lineasConPrecio: r.lineasConPrecio.length } })
    );
    for (const opt of optionsForSend(ev)) await markOption(idRequest, opt);
    await updateLink(link.id, { evaluacion: ev });
    const cupoTxt = `cupo ${money(ev.cupo.comprometido)} de ${money(ev.cupo.limite)}`;
    if (ev.destino === 'AP') return { ok: true, detail: `Requiere autorización de precio (${ev.lineasConPrecio.length} línea(s)); ${cupoTxt}` };
    if (ev.destino === 'AE') return { ok: true, detail: `Excede el cupo: ${cupoTxt}` };
    return { ok: true, detail: `Sin autorizaciones: ${cupoTxt}` };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  } finally {
    if (sap) await sapLogout(sap);
  }
}

/** ⚡ Revaluar cupo (despues de aprobar precios), como SAPSEND. */
export async function reevaluateCredit(idRequest: number, triggeredBy: TriggeredBy): Promise<ExecResult> {
  const link = await salesLinkOf(idRequest);
  if (!link) return { ok: false, error: 'La solicitud no está enlazada a una oferta de venta.' };
  const rules = await rulesFor(link.id_company);
  let sap: SapSession | null = null;
  try {
    sap = await companySap(link.id_company);
    const { cupo } = await loadEvaluationInput(sap, link.doc_entry, rules.estadosSumaCupo, false);
    const r = destinoTrasAprobarPrecios(cupo, rules);
    await withStep(
      { idRequest, stepKind: 'sap', stepName: 'Revaluar cupo', actionKey: 'sales.reevaluate_credit', triggerEvent: 'on_execute', triggeredBy, idCompany: link.id_company, sapEntity: 'BusinessPartners' },
      async () => r,
      () => ({ status: 'ok', sapDocEntry: link.doc_entry, responseSummary: r })
    );
    for (const opt of optionsForCreditRecheck(r.destino)) await markOption(idRequest, opt);
    return { ok: true, detail: r.destino === 'AE' ? `Excede el cupo (${money(r.cupo.comprometido)} de ${money(r.cupo.limite)})` : 'Dentro del cupo' };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  } finally {
    if (sap) await sapLogout(sap);
  }
}

const STATE_LABEL: Record<string, string> = {
  AP: 'En autorización de precios',
  AE: 'En autorización de extracupo (dirección comercial)',
  AEDA: 'En autorización por dirección administrativa',
};

/** Estados desde los que se puede llegar a cada etapa. */
const FROM: Record<'AP' | 'AE' | 'AEDA', string[]> = { AP: ['B', 'NAP'], AE: ['B', 'AP'], AEDA: ['AE'] };

function nowTrace(): string {
  const d = new Date();
  const f = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' });
  return f.format(d);
}

/** ⚡ Pasar el borrador a una etapa de autorizacion (AP, AE, AEDA). Idempotente. */
export async function moveToStage(idRequest: number, target: 'AP' | 'AE' | 'AEDA', triggeredBy: TriggeredBy): Promise<ExecResult> {
  const link = await salesLinkOf(idRequest);
  if (!link) return { ok: false, error: 'La solicitud no está enlazada a una oferta de venta.' };
  let sap: SapSession | null = null;
  try {
    sap = await companySap(link.id_company);
    const s = sap;
    const draft = await sapGet<Record<string, unknown>>(s, `Drafts(${link.doc_entry})?$select=DocEntry,U_SEND_State`);
    const state = normalizeState(draft.U_SEND_State);
    if (state === target) return { ok: true, detail: `Oferta ya en «${STATE_LABEL[target]}»` };
    if (!state || !FROM[target].includes(state)) {
      return { ok: false, error: `No se puede pasar a ${target} desde ${state ?? 'sin estado'}.` };
    }
    const extra: Record<string, string> =
      target === 'AE'
        ? { U_SEND_TraStateAE: 'SI', U_SEND_TraStateAETime: nowTrace() }
        : target === 'AEDA'
          ? { U_SEND_TraStateAEDA: 'SI', U_SEND_TraStateAEDATime: nowTrace() }
          : {};
    await withStep(
      { idRequest, stepKind: 'sap', stepName: `Pasar a «${STATE_LABEL[target]}»`, actionKey: `sales.state_${target.toLowerCase()}`, triggerEvent: 'on_execute', triggeredBy, idCompany: link.id_company, sapEntity: 'Drafts', requestSummary: { docEntry: link.doc_entry, de: state, a: target } },
      () => sapPatch(s, `Drafts(${link.doc_entry})`, { U_SEND_State: target, ...extra }, false, { ifMatch: draft['odata.etag'] as string | undefined }),
      () => ({ status: 'ok', sapDocEntry: link.doc_entry })
    );
    return { ok: true, detail: `Oferta pasó a «${STATE_LABEL[target]}»` };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  } finally {
    if (sap) await sapLogout(sap);
  }
}

/** ⚡ Crear pedido: POST Orders en A con la marca V<borrador>; borrador a A y cerrado. Idempotente. */
export async function createOrder(idRequest: number, triggeredBy: TriggeredBy): Promise<ExecResult> {
  const link = await salesLinkOf(idRequest);
  if (!link) return { ok: false, error: 'La solicitud no está enlazada a una oferta de venta.' };
  let sap: SapSession | null = null;
  try {
    sap = await companySap(link.id_company);
    const s = sap;
    const found = await sapGet<{ value?: { DocEntry: number; DocNum?: number }[] }>(
      s,
      `Orders?$select=DocEntry,DocNum&$filter=${orderLookupFilter(link.doc_entry)}&$top=1`
    );
    let order = found.value?.[0] ?? null;
    const draft = await sapGet<SalesDraft & Record<string, unknown>>(s, `Drafts(${link.doc_entry})`);
    const state = normalizeState(draft.U_SEND_State);
    if (!order) {
      if (state == null || !['B', 'AP', 'AE', 'AEDA'].includes(state)) {
        return { ok: false, error: `La oferta no está en un estado que permita crear el pedido (estado: ${String(draft.U_SEND_State ?? 'sin estado')}).` };
      }
      const payload = buildOrderPayload(draft, todayBogota());
      order = await withStep(
        { idRequest, stepKind: 'sap', stepName: 'Crear pedido de venta', actionKey: 'sales.create_order', triggerEvent: 'on_execute', triggeredBy, idCompany: link.id_company, sapEntity: 'Orders', requestSummary: { borrador: link.doc_entry, lineas: payload.DocumentLines.length } },
        () => sapPost<{ DocEntry: number; DocNum?: number }>(s, 'Orders', payload),
        (o) => ({ status: 'ok', sapDocEntry: o.DocEntry, sapDocNum: o.DocNum ?? null })
      );
    }
    if (state !== 'A') {
      await sapPatch(s, `Drafts(${link.doc_entry})`, {
        U_SEND_State: 'A',
        U_SEND_TraOrdCre: `${nowTrace()} | Orden de Venta creada desde SynerLink (pedido ${order.DocNum ?? order.DocEntry})`,
      });
    }
    await sapPost(s, `Drafts(${link.doc_entry})/Close`, {}).catch(() => undefined);
    await updateLink(link.id, { status: 'approved', order_doc_entry: order.DocEntry, error: null });
    return { ok: true, detail: `Pedido ${order.DocNum ?? order.DocEntry} creado en SAP` };
  } catch (e) {
    const msg = friendly(e);
    await updateLink(link.id, { status: 'publish_error', error: msg }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    if (sap) await sapLogout(sap);
  }
}

/**
 * Decision del autorizador (lo llama update-activities, sin bloquear). Al RECHAZAR
 * deja el borrador en NAP, NADC o NADA segun la etapa, con el motivo en la traza.
 * Al aprobar solo registra la traza: el siguiente paso lo hace la Tarea SAP del flujo.
 */
export async function onSalesAuthorizationDecision(
  idRequest: number | null | undefined,
  approved: boolean,
  reason: string | null | undefined
): Promise<void> {
  if (!idRequest) return;
  const link = await salesLinkOf(Number(idRequest)).catch(() => null);
  if (!link) return;
  let sap: SapSession | null = null;
  try {
    sap = await companySap(link.id_company);
    const s = sap;
    const draft = await sapGet<Record<string, unknown>>(s, `Drafts(${link.doc_entry})?$select=DocEntry,U_SEND_State`);
    const state = normalizeState(draft.U_SEND_State);
    if (state !== 'AP' && state !== 'AE' && state !== 'AEDA') return;
    const motivo = (reason ?? '').toString().trim().slice(0, 200);
    const trace = `${nowTrace()} | ${approved ? 'Autorizado' : 'Rechazado'} en SynerLink${motivo ? `: ${motivo}` : ''}`;
    const body: Record<string, string> = { [traceFieldFor(state, approved)]: trace };
    if (!approved) body.U_SEND_State = rejectedStateFor(state) as string;
    await withStep(
      { idRequest: Number(idRequest), stepKind: 'sap', stepName: approved ? 'Registrar autorización en SAP' : 'Aplicar rechazo en SAP', actionKey: approved ? null : 'sales.state_rejected', triggerEvent: approved ? 'on_approve' : 'on_reject', triggeredBy: 'user', idCompany: link.id_company, sapEntity: 'Drafts', requestSummary: { docEntry: link.doc_entry, de: state, a: body.U_SEND_State ?? state } },
      () => sapPatch(s, `Drafts(${link.doc_entry})`, body, false, { ifMatch: draft['odata.etag'] as string | undefined }),
      () => ({ status: 'ok', sapDocEntry: link.doc_entry })
    );
    if (!approved) await updateLink(link.id, { status: 'rejected', error: null });
  } catch (e) {
    console.error(`[sales] no se pudo aplicar la decisión de la solicitud ${idRequest} en SAP:`, e);
    if (!approved) await updateLink(link.id, { status: 'reject_error', error: friendly(e) }).catch(() => undefined);
  } finally {
    if (sap) await sapLogout(sap);
  }
}
