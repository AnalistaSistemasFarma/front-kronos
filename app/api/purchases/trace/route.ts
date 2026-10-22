import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/purchases/access';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Trazabilidad de una solicitud: borrador -> solicitud en firme -> orden de compra
 * -> factura. Usa la misma vista que SAPSEND (ModalViewTransabilityPurchaseRequest.jsx,
 * view.svc/Farma_SolicitudB1SLQuery), filtrada por el DocEntry de la firme
 * (U_SEND_SolCom del borrador). Verificada en Farmalogica y OLP (2026-10-21); si
 * la empresa no tiene la vista, se informa sin romper.
 *
 * GET ?companyId&docEntry (DocEntry del BORRADOR). Permiso de lectura.
 */
const TRACE_VIEW = 'Farma_SolicitudB1SLQuery';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const docEntry = Number(searchParams.get('docEntry'));
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!company?.endpoint) return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });

    const sap = await sapLogin(company.endpoint);
    try {
      const draft = await sapGet<Record<string, unknown>>(
        sap,
        `Drafts(${docEntry})?$select=DocEntry,U_SEND_State,U_SEND_SolCom,CreationDate`
      );
      const solCom = String(draft.U_SEND_SolCom ?? '').trim();
      const base = { draftDocEntry: docEntry, state: draft.U_SEND_State ?? null, createdAt: draft.CreationDate ?? null };
      // Sin firme (o con la marca temporal 'D<n>' de una publicacion en curso): no hay cadena aun.
      if (!/^\d+$/.test(solCom)) return NextResponse.json({ ...base, firmDocEntry: null, steps: [] });

      const firmDocEntry = Number(solCom);
      try {
        const page = await sapGet<{ value?: Array<Record<string, unknown>> }>(
          sap,
          `view.svc/${TRACE_VIEW}?$filter=DocEntry eq ${firmDocEntry}`
        );
        const steps = (page.value ?? []).map((r) => ({
          firmDocNum: r.DocNum ?? null,
          firmDate: r.CreateDateSolicitud ?? null,
          orderDocEntry: r.DocEntryOC ?? null,
          orderDocNum: r.DocNumOC ?? null,
          orderDate: r.CreateDateOC ?? null,
          invoiceDocNum: r.DocNumFactura ?? null,
          invoiceDate: r.CreateDateFactura ?? null,
        }));
        return NextResponse.json({ ...base, firmDocEntry, steps });
      } catch (e) {
        if (e instanceof SapError && (e.status === 400 || e.status === 404)) {
          return NextResponse.json({
            ...base,
            firmDocEntry,
            steps: [],
            warning: 'Esta empresa no tiene la vista de trazabilidad de compras.',
          });
        }
        throw e;
      }
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando trazabilidad de compra:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
