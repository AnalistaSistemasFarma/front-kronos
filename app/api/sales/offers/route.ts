import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { buildOfferDraftPayload, buildQuotationPayload, sanitizeOfferLine, validateOffer, type OfferHeader } from '../../../../lib/sales/offer';
import { todayBogota } from '../../../../lib/purchases/drafts';
import { createGeneralRequest } from '../../../../lib/requests-general/createGeneralRequest';
import { fireAndForgetNotification } from '../../../../lib/notificationEvents';
import { runSapExecutors } from '../../../../lib/workflow-sap/engine';
import { withStep } from '../../../../lib/workflow-sap/executionLog';
import { sapLogin, sapLogout, sapPost, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Crea una oferta de venta desde «Mis solicitudes» y la manda por su flujo:
 *  1) POST Quotations (ER) y POST Drafts oOrders (B) en SAP, como SAPSEND;
 *  2) crea la solicitud del workflow con el proceso «Oferta de venta» de la empresa;
 *  3) enlaza solicitud <-> borrador (sales_authorization) y arranca las Tareas SAP
 *     (evaluar reglas -> autorizaciones -> pedido).
 * Body: { companyId, subject, header: OfferHeader, lines: OfferLine[] }.
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

    const pool = await sql.connect(sqlConfig);
    const cfg = await pool.request().input('c', sql.Int, companyId).query(
      `SELECT TOP 1 id_process_category_oferta AS p FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
    );
    const processId = Number(cfg.recordset[0]?.p ?? 0);
    if (!processId) return NextResponse.json({ error: 'La empresa no tiene configurado el flujo de oferta de venta.' }, { status: 422 });

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 401 });

    const trace = `${new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())} | Oferta creada por ${user.name ?? email} en SynerLink`;
    const sap = await sapLogin(access.endpoint);
    let quotation: { DocEntry: number; DocNum?: number; DocumentLines?: { LineNum: number }[] };
    let draft: { DocEntry: number; DocTotal?: number };
    try {
      quotation = await sapPost(sap, 'Quotations', buildQuotationPayload(header, lines, today, trace));
      draft = await sapPost(sap, 'Drafts', buildOfferDraftPayload(header, lines, quotation, today, trace));
    } finally {
      await sapLogout(sap);
    }

    const userSubject = String(body.subject ?? '').trim().slice(0, 200);
    const subject = `${userSubject ? `${userSubject} · ` : ''}Oferta de venta #${draft.DocEntry} · ${header.CardCode}`;
    const { id_request: idRequest } = await createGeneralRequest({
      company: companyId,
      subject,
      descripcion: `${String(header.Comments ?? '').slice(0, 800)}${draft.DocTotal != null ? ` · Total ${Number(draft.DocTotal).toLocaleString('es-CO')}` : ''}`.trim(),
      process: processId,
      createdby: user.id,
      url: `/process/sales?companyId=${companyId}&docEntry=${draft.DocEntry}`,
      formValues: [],
    });

    await pool
      .request()
      .input('c', sql.Int, companyId)
      .input('d', sql.Int, draft.DocEntry)
      .input('r', sql.Int, idRequest)
      .input('u', sql.NVarChar(50), user.id)
      .query(`INSERT INTO dbo.sales_authorization (id_company, doc_entry, id_request_general, etapa, status, created_by)
              VALUES (@c, @d, @r, N'oferta', N'pending', @u);`);

    await withStep(
      { idRequest, stepKind: 'sap', stepName: 'Crear oferta en SAP', actionKey: 'sales.create_offer', triggerEvent: 'on_execute', triggeredBy: 'user', idUser: user.id, idCompany: companyId, sapEntity: 'Quotations/Drafts', requestSummary: { cliente: header.CardCode, lineas: lines.length } },
      async () => draft,
      () => ({ status: 'ok', sapDocEntry: draft.DocEntry, responseSummary: { cotizacion: quotation.DocEntry, borrador: draft.DocEntry } })
    );

    // Tareas SAP del flujo (evaluar reglas, etc.). No bloquea la respuesta.
    fireAndForgetNotification(runSapExecutors(idRequest, 'user'));
    return NextResponse.json({ ok: true, idRequest, docEntry: draft.DocEntry, quotationDocEntry: quotation.DocEntry }, { status: 201 });
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error creando la oferta de venta:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
