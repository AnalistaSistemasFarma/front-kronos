import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { createDraftOfferRequest, requestTexts, startOfferFlow } from '../../../../lib/sales/offerFlow';
import { buildDraftUpdate, buildQuotationUpdate, mapQuotationLines, sanitizeOfferLine, validateOffer, type EditLine, type OfferHeader } from '../../../../lib/sales/offer';
import { todayBogota } from '../../../../lib/purchases/drafts';
import { normalizeState } from '../../../../lib/sales/states';
import { sapGet, sapLogin, sapLogout, sapPatch, sapPost, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * «Mis ofertas en borrador»: ofertas que el usuario guardó sin enviarlas al flujo (interruptor
 * del formulario). Como en SAPSEND, quedan en SAP en estado borrador hasta que se envían.
 *  GET  ?companyId                                   -> { drafts }
 *  POST { companyId, docEntry, accion: 'enviar' }    -> pasa la oferta al flujo «Oferta de venta»
 *  POST { companyId, docEntry, accion: 'anular' }    -> cancela la cotización y cierra el borrador en SAP
 *  GET  ?companyId&docEntry                          -> borrador completo para editarlo
 *  POST { companyId, docEntry, accion: 'actualizar', header, lines } -> actualiza cotización y borrador
 * Solo sus propios borradores y con «Ventas · Gestionar ofertas».
 */
async function ctx(companyIdRaw: unknown) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const companyId = Number(companyIdRaw);
  if (!companyId) return { error: NextResponse.json({ error: 'Falta companyId' }, { status: 400 }) };
  const access = await salesEndpointForUser(email, companyId, 'write');
  if (!access?.endpoint) return { error: NextResponse.json({ error: 'Sin permiso «Ventas · Gestionar ofertas» en esta empresa.' }, { status: 403 }) };
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { error: NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 401 }) };
  return { companyId, endpoint: access.endpoint, userId: user.id };
}

export async function GET(request: NextRequest) {
  try {
    const c = await ctx(new URL(request.url).searchParams.get('companyId'));
    if ('error' in c) return c.error;
    const pool = await sql.connect(sqlConfig);
    const one = Number(new URL(request.url).searchParams.get('docEntry'));
    if (one) {
      const own = await pool.request().input('c', sql.Int, c.companyId).input('d', sql.Int, one).input('u', sql.NVarChar(50), c.userId).query(
        `SELECT TOP 1 quotation_doc_entry FROM dbo.sales_offer_draft WHERE id_company = @c AND doc_entry = @d AND id_user = @u AND status = N'borrador';`
      );
      if (!own.recordset[0]) return NextResponse.json({ error: 'No es un borrador suyo pendiente de enviar.' }, { status: 404 });
      const sap1 = await sapLogin(c.endpoint);
      try {
        const d = await sapGet<Record<string, unknown> & { DocumentLines?: Record<string, unknown>[] }>(sap1, `Drafts(${one})`);
        return NextResponse.json({
          draft: {
            docEntry: one, docNum: d.DocNum, cardCode: d.CardCode, cardName: d.CardName, dueDate: String(d.DocDueDate ?? '').slice(0, 10),
            numAtCard: d.NumAtCard ?? '', comments: d.Comments ?? '', shipTo: d.ShipToCode ?? '', payTo: d.PayToCode ?? '',
            state: d.U_SEND_State, open: d.DocumentStatus === 'bost_Open',
            lines: (d.DocumentLines ?? []).map((l) => ({
              ItemCode: l.ItemCode, ItemDescription: l.ItemDescription, Quantity: l.Quantity, UnitPrice: l.UnitPrice ?? l.Price,
              ListPrice: l.U_SEND_PriceLP ?? null, WarehouseCode: l.WarehouseCode, TaxCode: l.TaxCode, BaseLine: l.BaseLine ?? null,
            })),
          },
        }, { headers: { 'Cache-Control': 'no-store' } });
      } finally {
        await sapLogout(sap1);
      }
    }
    const r = await pool.request().input('c', sql.Int, c.companyId).input('u', sql.NVarChar(50), c.userId).query(
      `SELECT TOP 100 id, doc_entry, quotation_doc_entry, created_at, id_request_general FROM dbo.sales_offer_draft
       WHERE id_company = @c AND id_user = @u AND status = N'borrador' ORDER BY id DESC;`
    );
    const rows = r.recordset as { id: number; doc_entry: number; quotation_doc_entry: number | null; created_at: string; id_request_general: number | null }[];
    if (!rows.length) return NextResponse.json({ drafts: [] });
    const sap = await sapLogin(c.endpoint);
    try {
      const ors = rows.map((x) => `DocEntry eq ${x.doc_entry}`).join(' or ');
      const d = await sapGet<{ value?: Record<string, unknown>[] }>(
        sap,
        `Drafts?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,U_SEND_State,DocumentStatus,Comments,DocumentLines&$filter=${ors}`,
        { Prefer: 'odata.maxpagesize=100' }
      );
      const byEntry = new Map((d.value ?? []).map((x) => [Number(x.DocEntry), x]));
      // Borradores guardados antes de que existiera su solicitud «En Borrador»: se crea una sola vez.
      for (const x of rows) {
        const sd = byEntry.get(x.doc_entry);
        if (x.id_request_general || !sd || sd.DocumentStatus !== 'bost_Open') continue;
        const idReq = await createDraftOfferRequest(c.companyId, c.userId, { ...(sd as Record<string, unknown>), DocEntry: x.doc_entry } as never).catch(() => null);
        if (idReq) {
          await pool.request().input('id', sql.Int, x.id).input('r', sql.Int, idReq).query(`UPDATE dbo.sales_offer_draft SET id_request_general = @r WHERE id = @id AND id_request_general IS NULL;`);
          x.id_request_general = idReq;
        }
      }
      return NextResponse.json({
        drafts: rows.map((x) => {
          const s = byEntry.get(x.doc_entry);
          return {
            docEntry: x.doc_entry,
            quotationDocEntry: x.quotation_doc_entry,
            createdAt: x.created_at,
            docNum: s?.DocNum ?? null,
            docDate: s ? String(s.DocDate ?? '').slice(0, 10) : null,
            dueDate: s ? String(s.DocDueDate ?? '').slice(0, 10) : null,
            cardCode: s?.CardCode ?? null,
            cardName: s?.CardName ?? null,
            total: s?.DocTotal ?? null,
            comments: s?.Comments ?? null,
            sendState: s?.U_SEND_State ?? null,
            open: s ? s.DocumentStatus === 'bost_Open' : false,
            missing: !s,
            requestId: x.id_request_general,
          };
        }),
      }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error listando ofertas en borrador:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const c = await ctx(body.companyId);
    if ('error' in c) return c.error;
    const docEntry = Number(body.docEntry);
    const accion = String(body.accion ?? '');
    if (!docEntry || (accion !== 'enviar' && accion !== 'anular' && accion !== 'actualizar')) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    const pool = await sql.connect(sqlConfig);
    const own = await pool.request().input('c', sql.Int, c.companyId).input('d', sql.Int, docEntry).input('u', sql.NVarChar(50), c.userId).query(
      `SELECT TOP 1 id, quotation_doc_entry, id_request_general FROM dbo.sales_offer_draft WHERE id_company = @c AND doc_entry = @d AND id_user = @u AND status = N'borrador';`
    );
    const row = own.recordset[0];
    if (!row) return NextResponse.json({ error: 'No es un borrador suyo pendiente de enviar.' }, { status: 404 });

    const sap = await sapLogin(c.endpoint);
    try {
      const draft = await sapGet<Record<string, unknown> & { DocEntry: number; DocumentLines?: { ItemDescription?: string; ItemCode?: string }[] }>(sap, `Drafts(${docEntry})`);
      const state = normalizeState(draft.U_SEND_State);
      if (draft.DocumentStatus !== 'bost_Open' || state !== 'B') {
        return NextResponse.json({ error: `La oferta ya no está en borrador en SAP (estado ${state ?? String(draft.U_SEND_State ?? 'sin estado')}).` }, { status: 409 });
      }
      if (accion === 'actualizar') {
        if (!row.quotation_doc_entry) return NextResponse.json({ error: 'El borrador no tiene cotización enlazada; no se puede editar.' }, { status: 409 });
        const h = { ...(body.header ?? {}), CardCode: String(draft.CardCode ?? '') } as OfferHeader;
        const raw = (Array.isArray(body.lines) ? body.lines : []) as Record<string, unknown>[];
        const lines: EditLine[] = raw.map((l) => ({ ...sanitizeOfferLine(l), BaseLine: l.BaseLine == null || l.BaseLine === '' ? null : Number(l.BaseLine) }));
        const errors = validateOffer(h, lines, todayBogota());
        if (errors.length) return NextResponse.json({ error: 'Datos inválidos', errors }, { status: 422 });
        const q = Number(row.quotation_doc_entry);
        const qBefore = await sapGet<{ DocumentLines?: { LineNum: number }[]; DocumentStatus?: string }>(sap, `Quotations(${q})?$select=DocumentStatus,DocumentLines`);
        if (qBefore.DocumentStatus !== 'bost_Open') return NextResponse.json({ error: 'La cotización de esta oferta ya no está abierta en SAP.' }, { status: 409 });
        const before = (qBefore.DocumentLines ?? []).map((x) => Number(x.LineNum));
        // 1) Cotización con todas las líneas (reemplaza la colección). Sin If-Match (etag fijo en el SL).
        await sapPatch(sap, `Quotations(${q})`, buildQuotationUpdate(h, lines), true);
        // 2) LineNum reales de la cotización ya actualizada.
        const qAfter = await sapGet<{ DocumentLines?: { LineNum: number }[] }>(sap, `Quotations(${q})?$select=DocumentLines`);
        const baseLines = mapQuotationLines(lines, before, (qAfter.DocumentLines ?? []).map((x) => Number(x.LineNum)));
        if (baseLines.some((n) => n < 0)) {
          return NextResponse.json({ error: 'Se actualizó la cotización pero no se pudo enlazar una línea nueva; vuelva a abrir el borrador y guarde de nuevo.' }, { status: 500 });
        }
        // 3) Borrador con las mismas líneas enlazadas a la cotización.
        await sapPatch(sap, `Drafts(${docEntry})`, buildDraftUpdate(h, lines, q, baseLines), true);
        // Verificación: la cotización y el borrador deben quedar con las mismas líneas (artículo, cantidad, precio).
        const [qv, dv] = await Promise.all([
          sapGet<{ DocumentLines?: Record<string, unknown>[] }>(sap, `Quotations(${q})?$select=DocumentLines`),
          sapGet<{ DocumentLines?: Record<string, unknown>[] }>(sap, `Drafts(${docEntry})?$select=DocumentLines`),
        ]);
        const sig = (ls?: Record<string, unknown>[]) => (ls ?? []).map((l) => `${l.ItemCode}|${Number(l.Quantity)}|${Number(l.UnitPrice ?? l.Price)}`).join(';');
        if (sig(qv.DocumentLines) !== sig(dv.DocumentLines)) {
          return NextResponse.json({ error: 'Se guardó, pero la cotización y el borrador quedaron distintos en SAP. Vuelva a abrir la oferta y guarde de nuevo; si persiste, avise a soporte.' }, { status: 500 });
        }
        if (row.id_request_general) {
          const fresh = await sapGet<Record<string, unknown> & { DocEntry: number; DocumentLines?: { ItemDescription?: string; ItemCode?: string }[] }>(sap, `Drafts(${docEntry})?$select=DocEntry,CardCode,CardName,DocTotal,Comments,DocumentLines`);
          const t = requestTexts(fresh as never);
          await pool.request().input('r', sql.Int, row.id_request_general).input('s', sql.NVarChar(254), t.subject).input('d', sql.NVarChar(sql.MAX), t.descripcion)
            .query(`UPDATE requests_general SET subject_request = @s, description = @d WHERE id = @r;`);
        }
        return NextResponse.json({ ok: true, actualizado: true });
      }
      if (accion === 'anular') {
        const motivo = String(body.motivo ?? '').trim().slice(0, 200);
        if (row.quotation_doc_entry) await sapPost(sap, `Quotations(${row.quotation_doc_entry})/Cancel`, {}).catch(() => undefined);
        await sapPost(sap, `Drafts(${docEntry})/Close`, {});
        await pool.request().input('id', sql.Int, row.id).query(`UPDATE dbo.sales_offer_draft SET status = N'anulado', updated_at = sysutcdatetime() WHERE id = @id;`);
        if (row.id_request_general) {
          await pool.request().input('r', sql.Int, row.id_request_general).input('m', sql.NVarChar(sql.MAX), `Oferta anulada en borrador${motivo ? `: ${motivo}` : ''}.`).query(
            `UPDATE requests_general SET status_req = 3, resolution = @m, date_resolution = GETDATE() WHERE id = @r;
             UPDATE task_request_general SET id_status = 3 WHERE id_request_general = @r AND id_status = 4;`
          );
        }
        return NextResponse.json({ ok: true, anulado: true, motivo });
      }
      const started = await startOfferFlow({
        companyId: c.companyId,
        userId: c.userId,
        draft: draft as never,
        quotationDocEntry: row.quotation_doc_entry,
        existingRequestId: row.id_request_general ?? null,
      });
      if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
      return NextResponse.json({ ok: true, idRequest: started.idRequest });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en la oferta en borrador:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
