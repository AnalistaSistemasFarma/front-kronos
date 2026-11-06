import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../../lib/purchases/access';
import { resolveRequester } from '../../../../../lib/purchases/requester';
import { checkTransition } from '../../../../../lib/purchases/states';
import { sapGet, sapLogin, sapLogout, sapPatch, SapError } from '../../../../../lib/sap/serviceLayer';

/**
 * Acciones del SOLICITANTE sobre su borrador (ModalViewPurchaseRequest.jsx de SAPSEND):
 *   retomar: NAD -> B   (boton «Retomar» de una solicitud no aprobada, l.215-235)
 *   anular:  B -> null  (boton «Eliminar», borrado logico con motivo, l.274-298)
 * Body: { companyId, docEntry, action: 'retomar' | 'anular', reason? }.
 * Solo el solicitante del borrador (U_SEND_UserId = su perfil SAPSEND en la empresa),
 * con permiso de escritura. Transicion condicionada al estado leido (If-Match).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const docEntry = Number(body.docEntry);
    const action = body.action;
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0 || (action !== 'retomar' && action !== 'anular')) {
      return NextResponse.json({ error: 'Falta companyId, docEntry o una accion valida' }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 254) : '';

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company?.endpoint) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }
    const who = await resolveRequester(session.user.email, companyId);
    if (!who.ok) return NextResponse.json({ error: who.error }, { status: 422 });

    const sap = await sapLogin(company.endpoint);
    try {
      const draft = await sapGet<Record<string, unknown>>(
        sap,
        `Drafts(${docEntry})?$select=DocEntry,DocObjectCode,U_SEND_State,U_SEND_UserId`
      );
      if (draft.DocObjectCode !== 'oPurchaseRequest') {
        return NextResponse.json({ error: 'El documento no es una solicitud de compra' }, { status: 404 });
      }
      if (String(draft.U_SEND_UserId ?? '') !== String(who.requester.sapsendUserId)) {
        return NextResponse.json({ error: 'Solo el solicitante puede hacer esta accion.' }, { status: 403 });
      }

      const check = checkTransition(draft.U_SEND_State, action);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 });
      if (check.requiresReason && !reason) {
        return NextResponse.json({ error: 'El motivo es obligatorio.', field: 'reason' }, { status: 422 });
      }

      const patch: Record<string, unknown> = { U_SEND_State: check.to };
      if (check.requiresReason) patch.U_Motivo_Can_Solicitud = reason;
      await sapPatch(sap, `Drafts(${docEntry})`, patch, false, { ifMatch: draft['odata.etag'] as string | undefined });
      return NextResponse.json({ ok: true, state: check.to });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      if (error.isPreconditionFailed) {
        return NextResponse.json(
          { error: 'La solicitud cambio mientras tanto (posiblemente en SAPSEND). Recargue e intente de nuevo.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.friendly }, { status: error.status });
    }
    console.error('Error cambiando estado de solicitud de compra:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
