import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { companySap } from '../../../../lib/purchases/authorization';
import { canReadLinkedSale } from '../../../../lib/sales/requestAccess';
import { orderLookupFilter } from '../../../../lib/sales/publish';
import { OBJ, quotationOf, targetsPath, toDoc, uniqueDocs, type RelDoc } from '../../../../lib/sales/relations';
import { sapGet, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Oferta de venta enlazada a una solicitud de «Mis solicitudes» y su mapa de relaciones
 * (cotización → borrador → pedido → entregas → facturas), para el detalle de la solicitud.
 * GET ?requestId=N -> { sale: null } si la solicitud no es de ventas. Solo lectura.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const requestId = Number(new URL(request.url).searchParams.get('requestId'));
    if (!requestId) return NextResponse.json({ sale: null });

    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('r', sql.Int, requestId).query(
      `SELECT TOP 1 id_company, doc_entry, status, order_doc_entry, error FROM dbo.sales_authorization WHERE id_request_general = @r
       IF @@ROWCOUNT = 0
         -- Oferta guardada en borrador (sin flujo todavía): su solicitud está «En Borrador».
         SELECT TOP 1 id_company, doc_entry, N'borrador' AS status, NULL AS order_doc_entry, NULL AS error FROM dbo.sales_offer_draft WHERE id_request_general = @r AND status = N'borrador';`
    );
    const sets = (r.recordsets as unknown as Record<string, unknown>[][]) ?? [];
    const link = (sets.find((x) => x.length) ?? [])[0] as { id_company: number; doc_entry: number; status: string; order_doc_entry: number | null; error: string | null } | undefined;
    if (!link) return NextResponse.json({ sale: null });
    // Tareas SAP del flujo que quedaron en error (para el botón «Reintentar»).
    const errs = await pool.request().input('r', sql.Int, requestId).query(`
      SELECT tpc.task, REPLACE(trg.resolution, N'[sap:error] ', N'') AS error
      FROM task_request_general trg INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @r AND trg.id_status = 4 AND trg.resolution LIKE N'[[]sap:error]%';`);
    const sapErrors = errs.recordset as { task: string; error: string }[];
    if (!(await canReadLinkedSale(session.user.email, requestId, link.id_company))) {
      return NextResponse.json({ error: 'Sin acceso a esta oferta de venta' }, { status: 403 });
    }

    const sap = await companySap(link.id_company);
    try {
      const draft = await sapGet<Record<string, unknown> & { DocumentLines?: Record<string, unknown>[] }>(sap, `Drafts(${link.doc_entry})`);
      const docs: RelDoc[] = [];
      const warnings: string[] = [];
      const qEntry = quotationOf(draft);
      if (qEntry) {
        const q = await sapGet<Record<string, unknown>>(sap, `Quotations(${qEntry})?$select=DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Cancelled,U_SEND_State`).catch(() => null);
        if (q) docs.push(toDoc('quotation', q));
      }
      docs.push(toDoc('draft', draft));
      let orderEntry: number | null = link.order_doc_entry ?? null;
      if (!orderEntry) {
        const f = await sapGet<{ value?: { DocEntry: number }[] }>(sap, `Orders?$select=DocEntry&$filter=${orderLookupFilter(link.doc_entry)}&$top=1`).catch(() => null);
        orderEntry = f?.value?.[0]?.DocEntry ?? null;
      }
      if (orderEntry) {
        const o = await sapGet<Record<string, unknown>>(sap, `Orders(${orderEntry})?$select=DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Cancelled,U_SEND_State`).catch(() => null);
        if (o) {
          docs.push(toDoc('order', o));
          try {
            const dp = targetsPath('DeliveryNotes', OBJ.order, [orderEntry]);
            const dels = dp ? uniqueDocs('delivery', 'DeliveryNotes', (await sapGet<{ value?: Record<string, unknown>[] }>(sap, dp)).value ?? []) : [];
            docs.push(...dels);
            const fromOrder = targetsPath('Invoices', OBJ.order, [orderEntry]);
            const fromDel = targetsPath('Invoices', OBJ.delivery, dels.map((d) => d.docEntry));
            const inv = [
              ...(fromOrder ? (await sapGet<{ value?: Record<string, unknown>[] }>(sap, fromOrder)).value ?? [] : []),
              ...(fromDel ? (await sapGet<{ value?: Record<string, unknown>[] }>(sap, fromDel)).value ?? [] : []),
            ];
            docs.push(...uniqueDocs('invoice', 'Invoices', inv));
          } catch (e) {
            warnings.push(`No se pudieron leer entregas y facturas: ${e instanceof SapError ? e.friendly : (e as Error).message}`);
          }
        }
      }
      return NextResponse.json(
        {
          sale: {
            companyId: link.id_company,
            docEntry: link.doc_entry,
            flowStatus: link.status,
            flowError: link.error,
            draft: {
              DocNum: draft.DocNum, CardCode: draft.CardCode, CardName: draft.CardName, NumAtCard: draft.NumAtCard,
              DocDate: draft.DocDate, DocDueDate: draft.DocDueDate, ShipToCode: draft.ShipToCode, Address2: draft.Address2,
              Comments: draft.Comments, DocTotal: draft.DocTotal, VatSum: draft.VatSum, DocCurrency: draft.DocCurrency,
              U_SEND_State: draft.U_SEND_State, DocumentStatus: draft.DocumentStatus,
              DocumentLines: (draft.DocumentLines ?? []).map((l) => ({
                ItemCode: l.ItemCode, ItemDescription: l.ItemDescription, Quantity: l.Quantity, UnitPrice: l.UnitPrice ?? l.Price,
                U_SEND_PriceLP: l.U_SEND_PriceLP, WarehouseCode: l.WarehouseCode, TaxCode: l.TaxCode, LineTotal: l.LineTotal,
              })),
            },
            relations: docs,
            warnings,
            sapErrors,
          },
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando la oferta de venta de la solicitud:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
