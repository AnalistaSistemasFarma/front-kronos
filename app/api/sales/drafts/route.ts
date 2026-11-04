import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { startOfferFlow } from '../../../../lib/sales/offerFlow';
import { normalizeState } from '../../../../lib/sales/states';
import { sapGet, sapLogin, sapLogout, sapPost, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * «Mis ofertas en borrador»: ofertas que el usuario guardó sin enviarlas al flujo (interruptor
 * del formulario). Como en SAPSEND, quedan en SAP en estado borrador hasta que se envían.
 *  GET  ?companyId                                   -> { drafts }
 *  POST { companyId, docEntry, accion: 'enviar' }    -> pasa la oferta al flujo «Oferta de venta»
 *  POST { companyId, docEntry, accion: 'anular' }    -> cancela la cotización y cierra el borrador en SAP
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
    const r = await pool.request().input('c', sql.Int, c.companyId).input('u', sql.NVarChar(50), c.userId).query(
      `SELECT TOP 100 id, doc_entry, quotation_doc_entry, created_at FROM dbo.sales_offer_draft
       WHERE id_company = @c AND id_user = @u AND status = N'borrador' ORDER BY id DESC;`
    );
    const rows = r.recordset as { id: number; doc_entry: number; quotation_doc_entry: number | null; created_at: string }[];
    if (!rows.length) return NextResponse.json({ drafts: [] });
    const sap = await sapLogin(c.endpoint);
    try {
      const ors = rows.map((x) => `DocEntry eq ${x.doc_entry}`).join(' or ');
      const d = await sapGet<{ value?: Record<string, unknown>[] }>(
        sap,
        `Drafts?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,U_SEND_State,DocumentStatus,Comments&$filter=${ors}`,
        { Prefer: 'odata.maxpagesize=100' }
      );
      const byEntry = new Map((d.value ?? []).map((x) => [Number(x.DocEntry), x]));
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
    if (!docEntry || (accion !== 'enviar' && accion !== 'anular')) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    const pool = await sql.connect(sqlConfig);
    const own = await pool.request().input('c', sql.Int, c.companyId).input('d', sql.Int, docEntry).input('u', sql.NVarChar(50), c.userId).query(
      `SELECT TOP 1 id, quotation_doc_entry FROM dbo.sales_offer_draft WHERE id_company = @c AND doc_entry = @d AND id_user = @u AND status = N'borrador';`
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
      if (accion === 'anular') {
        const motivo = String(body.motivo ?? '').trim().slice(0, 200);
        if (row.quotation_doc_entry) await sapPost(sap, `Quotations(${row.quotation_doc_entry})/Cancel`, {}).catch(() => undefined);
        await sapPost(sap, `Drafts(${docEntry})/Close`, {});
        await pool.request().input('id', sql.Int, row.id).query(`UPDATE dbo.sales_offer_draft SET status = N'anulado', updated_at = sysutcdatetime() WHERE id = @id;`);
        return NextResponse.json({ ok: true, anulado: true, motivo });
      }
      const started = await startOfferFlow({
        companyId: c.companyId,
        userId: c.userId,
        draft: draft as never,
        quotationDocEntry: row.quotation_doc_entry,
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
