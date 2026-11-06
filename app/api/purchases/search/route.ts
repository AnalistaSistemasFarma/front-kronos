import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/purchases/access';
import { LOOKUP_KINDS, type LookupKind } from '../../../../lib/purchases/lookups';
import { PAGE_SIZE, searchPath, searchRows } from '../../../../lib/purchases/search';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Búsqueda ampliada (lupa) de la solicitud de compra contra SAP de la empresa.
 * GET ?companyId&kind&q&page -> { rows, page, hasMore }. Mismo acceso que el autocompletar.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const kind = sp.get('kind') as LookupKind;
    if (!companyId || !LOOKUP_KINDS.includes(kind)) return NextResponse.json({ error: 'Falta companyId o kind válido' }, { status: 400 });
    const page = Math.min(200, Math.max(0, Number(sp.get('page') ?? 0) || 0));
    const q = (sp.get('q') ?? '').slice(0, 60);

    const company = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!company?.endpoint) return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    const sap = await sapLogin(company.endpoint);
    try {
      // SAP pagina a 20 por defecto e ignora un $top mayor: se pide el tamaño de página explícito.
      const data = await sapGet<{ value?: Record<string, unknown>[] }>(sap, searchPath(kind, q, page), {
        Prefer: `odata.maxpagesize=${kind === 'costing' ? 5000 : PAGE_SIZE}`,
      });
      const r = searchRows(kind, data.value ?? [], q, page);
      return NextResponse.json({ rows: r.rows, page, hasMore: r.hasMore }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en la búsqueda ampliada de compras:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
