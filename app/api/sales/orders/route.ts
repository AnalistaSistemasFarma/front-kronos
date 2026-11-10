import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { ORDERS_PAGE, ordersPath, toOrderRow, type OrderFilters } from '../../../../lib/sales/orders';
import { OBJ, quotationOf, targetsPath, toDoc, uniqueDocs, type RelDoc } from '../../../../lib/sales/relations';
import { sapGet, sapGetAll, sapLogin, sapLogout, SapError, type SapSession } from '../../../../lib/sap/serviceLayer';

/**
 * Pedidos de venta en firme de SAP (panel «Pedidos de venta»), como «Órdenes de Venta» de SAPSEND.
 *  GET ?companyId&q&desde&hasta&estado&origen&page   -> { rows, hasMore }
 *  GET ?companyId&...&export=1                       -> { rows } (hasta 2000, para Excel)
 *  GET ?companyId&docEntry=N                         -> { order, lines, relations }
 * Requiere «Ventas · Ofertas» (lectura) en la empresa. Solo lectura.
 */
async function requestsByDraft(companyId: number, drafts: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(drafts.filter((n) => Number.isInteger(n) && n > 0))];
  const map = new Map<number, number>();
  if (!ids.length) return map;
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('c', sql.Int, companyId).query(
    `SELECT doc_entry, id_request_general FROM dbo.sales_authorization WHERE id_company = @c AND doc_entry IN (${ids.join(',')});`
  );
  for (const x of r.recordset) map.set(Number(x.doc_entry), Number(x.id_request_general));
  return map;
}

async function detail(sap: SapSession, companyId: number, docEntry: number) {
  const o = await sapGet<Record<string, unknown> & { DocumentLines?: Record<string, unknown>[] }>(sap, `Orders(${docEntry})`);
  const row = toOrderRow(o);
  const relations: RelDoc[] = [];
  const warnings: string[] = [];
  if (row.draftDocEntry) {
    const d = await sapGet<Record<string, unknown> & { DocumentLines?: Record<string, unknown>[] }>(sap, `Drafts(${row.draftDocEntry})`).catch(() => null);
    if (d) {
      const q = quotationOf(d);
      if (q) {
        const qd = await sapGet<Record<string, unknown>>(sap, `Quotations(${q})?$select=DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Cancelled,U_SEND_State`).catch(() => null);
        if (qd) relations.push(toDoc('quotation', qd));
      }
      relations.push(toDoc('draft', d));
    }
  } else {
    const q = quotationOf(o);
    if (q) {
      const qd = await sapGet<Record<string, unknown>>(sap, `Quotations(${q})?$select=DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Cancelled,U_SEND_State`).catch(() => null);
      if (qd) relations.push(toDoc('quotation', qd));
    }
  }
  relations.push(toDoc('order', o));
  try {
    const dp = targetsPath('DeliveryNotes', OBJ.order, [docEntry]);
    const dels = dp ? uniqueDocs('delivery', 'DeliveryNotes', (await sapGet<{ value?: Record<string, unknown>[] }>(sap, dp)).value ?? []) : [];
    relations.push(...dels);
    const a = targetsPath('Invoices', OBJ.order, [docEntry]);
    const b = targetsPath('Invoices', OBJ.delivery, dels.map((x) => x.docEntry));
    const inv = [
      ...(a ? (await sapGet<{ value?: Record<string, unknown>[] }>(sap, a)).value ?? [] : []),
      ...(b ? (await sapGet<{ value?: Record<string, unknown>[] }>(sap, b)).value ?? [] : []),
    ];
    relations.push(...uniqueDocs('invoice', 'Invoices', inv));
  } catch (e) {
    warnings.push(`No se pudieron leer entregas y facturas: ${e instanceof SapError ? e.friendly : (e as Error).message}`);
  }
  const req = row.draftDocEntry ? (await requestsByDraft(companyId, [row.draftDocEntry])).get(row.draftDocEntry) ?? null : null;
  return {
    order: { ...row, address: String(o.Address2 ?? ''), requestId: req },
    lines: (o.DocumentLines ?? []).map((l) => ({
      itemCode: String(l.ItemCode ?? ''),
      description: String(l.ItemDescription ?? ''),
      warehouse: String(l.WarehouseCode ?? ''),
      quantity: Number(l.Quantity ?? 0),
      open: Number(l.RemainingOpenQuantity ?? 0),
      price: Number(l.UnitPrice ?? l.Price ?? 0),
      total: Number(l.LineTotal ?? 0),
      status: String(l.LineStatus ?? '') === 'bost_Open' ? 'Abierta' : 'Cerrada',
    })),
    relations,
    warnings,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    const a = await salesEndpointForUser(session.user.email, companyId);
    if (!a?.endpoint) return NextResponse.json({ error: 'Sin acceso a Ventas en esta empresa («Ventas · Ofertas»).' }, { status: 403 });
    const sap = await sapLogin(a.endpoint);
    try {
      const docEntry = Number(sp.get('docEntry'));
      if (docEntry) return NextResponse.json(await detail(sap, companyId, docEntry), { headers: { 'Cache-Control': 'no-store' } });
      const f: OrderFilters = {
        q: (sp.get('q') ?? '').slice(0, 60),
        desde: sp.get('desde') ?? undefined,
        hasta: sp.get('hasta') ?? undefined,
        estado: (sp.get('estado') as OrderFilters['estado']) ?? 'todos',
        origen: (sp.get('origen') as OrderFilters['origen']) ?? 'todos',
        page: Number(sp.get('page') ?? 0) || 0,
      };
      let raw: Record<string, unknown>[];
      if (sp.get('export') === '1') {
        const path = ordersPath({ ...f, page: 0 }).replace(/&\$top=\d+&\$skip=\d+$/, '');
        raw = await sapGetAll<Record<string, unknown>>(sap, path, { cap: 2000 });
      } else {
        const d = await sapGet<{ value?: Record<string, unknown>[] }>(sap, ordersPath(f), { Prefer: `odata.maxpagesize=${ORDERS_PAGE}` });
        raw = d.value ?? [];
      }
      const rows = raw.map(toOrderRow);
      const reqs = await requestsByDraft(companyId, rows.map((r) => r.draftDocEntry ?? 0));
      const out = rows.map((r) => ({ ...r, requestId: r.draftDocEntry ? reqs.get(r.draftDocEntry) ?? null : null }));
      return NextResponse.json({ rows: out, hasMore: sp.get('export') !== '1' && rows.length >= ORDERS_PAGE }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando pedidos de venta:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
