import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/purchases/access';
import { LOOKUP_KINDS, lookupPath, toOptions, type LookupKind } from '../../../../lib/purchases/lookups';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Autocompletar de los campos de linea de la solicitud de compra contra SAP de la
 * empresa (articulo, proveedor, cuenta, IVA, norma de reparto, bodega), como SAPSEND.
 * GET ?companyId&kind&q -> { options: LookupOption[] }. Minimo 2 caracteres.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const kind = sp.get('kind') as LookupKind;
    const q = (sp.get('q') ?? '').slice(0, 60);
    if (!companyId || !LOOKUP_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Falta companyId o kind válido' }, { status: 400 });
    }
    if (q.trim().length < 2) return NextResponse.json({ options: [] });

    const company = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!company?.endpoint) return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });

    const sap = await sapLogin(company.endpoint);
    try {
      const data = await sapGet<{ value?: Record<string, unknown>[] }>(sap, lookupPath(kind, q));
      return NextResponse.json(
        { options: toOptions(kind, data.value ?? [], q) },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en búsqueda de SAP para compras:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
