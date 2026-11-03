import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { PAGE_SIZE, SEARCH_KINDS, searchPath, searchRows, type SearchKind } from '../../../../lib/sales/search';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Búsqueda ampliada de la oferta de venta contra SAP de la empresa («*» + Enter).
 * GET ?companyId&kind&q&page&itemCode&cardCode -> { rows, page, hasMore }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const kind = sp.get('kind') as SearchKind;
    if (!companyId || !SEARCH_KINDS.includes(kind)) return NextResponse.json({ error: 'Falta companyId o kind válido' }, { status: 400 });
    const page = Math.min(200, Math.max(0, Number(sp.get('page') ?? 0) || 0));
    const itemCode = (sp.get('itemCode') ?? '').slice(0, 50);
    const cardCode = (sp.get('cardCode') ?? '').slice(0, 50);
    if ((kind === 'warehouse_stock' || kind === 'batches') && !itemCode) return NextResponse.json({ rows: [], page, hasMore: false });
    if (kind === 'recent_orders' && !cardCode) return NextResponse.json({ rows: [], page, hasMore: false });
    const a = await salesEndpointForUser(session.user.email, companyId);
    if (!a?.endpoint) return NextResponse.json({ error: 'Sin acceso a ventas en esta empresa' }, { status: 403 });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const sap = await sapLogin(a.endpoint);
    try {
      // SAP pagina a 20 por defecto e ignora $top mayor: se pide el tamaño de página explícito.
      const data = await sapGet<Record<string, unknown>>(sap, searchPath(kind, { q: (sp.get('q') ?? '').slice(0, 60), page, itemCode, cardCode, today }), { Prefer: `odata.maxpagesize=${PAGE_SIZE}` });
      const rows = searchRows(kind, data);
      const paged = kind === 'customer' || kind === 'item' || kind === 'batches';
      return NextResponse.json({ rows, page, hasMore: paged && rows.length >= PAGE_SIZE }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en la búsqueda ampliada de ventas:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
