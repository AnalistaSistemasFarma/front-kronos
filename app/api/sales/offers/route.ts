import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { buildOfferDraftPayload, buildQuotationPayload, sanitizeOfferLine, validateOffer, type OfferHeader } from '../../../../lib/sales/offer';
import { todayBogota } from '../../../../lib/purchases/drafts';
import { createDraftOfferRequest, startOfferFlow } from '../../../../lib/sales/offerFlow';
import { sapLogin, sapLogout, sapPost, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Crea una oferta de venta desde «Mis solicitudes» y la manda por su flujo:
 *  1) POST Quotations (ER) y POST Drafts oOrders (B) en SAP, como SAPSEND;
 *  2) crea la solicitud del workflow con el proceso «Oferta de venta» de la empresa;
 *  3) enlaza solicitud <-> borrador (sales_authorization) y arranca las Tareas SAP
 *     (evaluar reglas -> autorizaciones -> pedido).
 * Body: { companyId, header: OfferHeader, lines: OfferLine[], enviar?: boolean }. Con enviar=false
 * la oferta queda en borrador (sales_offer_draft) y se envía después desde «Mis ofertas en borrador».
 * Requiere «Ventas · Gestionar ofertas» en la empresa.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    const header = (body.header ?? {}) as OfferHeader;
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l: Record<string, unknown>) => sanitizeOfferLine(l));
    const today = todayBogota();
    const errors = validateOffer(header, lines, today);
    if (errors.length) return NextResponse.json({ error: 'Datos inválidos', errors }, { status: 422 });

    const access = await salesEndpointForUser(email, companyId, 'write');
    if (!access?.endpoint) return NextResponse.json({ error: 'No tiene permiso para crear ofertas en esta empresa («Ventas · Gestionar ofertas»).' }, { status: 403 });

    // Antes de escribir en SAP: la empresa debe tener el flujo configurado (si se va a enviar).
    if (body.enviar !== false) {
      const pool0 = await sql.connect(sqlConfig);
      const cfg = await pool0.request().input('c', sql.Int, companyId).query(
        `SELECT TOP 1 id_process_category_oferta AS p FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
      );
      if (!Number(cfg.recordset[0]?.p ?? 0)) return NextResponse.json({ error: 'La empresa no tiene configurado el flujo de oferta de venta.' }, { status: 422 });
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 401 });

    const trace = `${new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())} | Oferta creada por ${user.name ?? email} en SynerLink`;
    const sap = await sapLogin(access.endpoint);
    let quotation: { DocEntry: number; DocNum?: number; DocumentLines?: { LineNum: number }[] };
    let draft: { DocEntry: number; DocTotal?: number; CardCode?: string; CardName?: string; DocumentLines?: { ItemDescription?: string; ItemCode?: string }[] };
    try {
      quotation = await sapPost(sap, 'Quotations', buildQuotationPayload(header, lines, today, trace));
      draft = await sapPost(sap, 'Drafts', buildOfferDraftPayload(header, lines, quotation, today, trace));
    } finally {
      await sapLogout(sap);
    }

    // Interruptor del formulario: «Enviar a autorización» (por defecto) o dejarla en borrador, como SAPSEND.
    if (body.enviar === false) {
      const pool = await sql.connect(sqlConfig);
      // La solicitud se crea en «En Borrador» para que aparezca en Mis solicitudes; el flujo no arranca.
      const idDraftRequest = await createDraftOfferRequest(companyId, user.id, { ...draft, Comments: header.Comments });
      await pool.request().input('c', sql.Int, companyId).input('d', sql.Int, draft.DocEntry).input('q', sql.Int, quotation.DocEntry).input('u', sql.NVarChar(50), user.id).input('r', sql.Int, idDraftRequest).query(
        `INSERT INTO dbo.sales_offer_draft (id_company, doc_entry, quotation_doc_entry, id_user, status, id_request_general) VALUES (@c, @d, @q, @u, N'borrador', @r);`
      );
      return NextResponse.json({ ok: true, saved: true, idRequest: idDraftRequest, docEntry: draft.DocEntry, quotationDocEntry: quotation.DocEntry }, { status: 201 });
    }
    const started = await startOfferFlow({ companyId, userId: user.id, draft: { ...draft, Comments: header.Comments }, quotationDocEntry: quotation.DocEntry, linesCount: lines.length });
    if (!started.ok) {
      return NextResponse.json({ error: `Se creó la oferta #${draft.DocEntry} en SAP, pero no se pudo enviar al flujo: ${started.error}`, docEntry: draft.DocEntry }, { status: started.status });
    }
    const idRequest = started.idRequest;
    return NextResponse.json({ ok: true, idRequest, docEntry: draft.DocEntry, quotationDocEntry: quotation.DocEntry }, { status: 201 });
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error creando la oferta de venta:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
