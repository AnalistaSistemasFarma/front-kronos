import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../lib/it-dashboard/access';
import { parseItDashboardFilters, parseTypeFilter } from '../../../../lib/it-dashboard/aggregate';
import { IT_DASHBOARD_LIST_LIMIT } from '../../../../lib/it-dashboard/constants';
import { loadItAssetList } from '../../../../lib/it-dashboard/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/it-dashboard/assets?company=&type=&includeRetired=
 * Dashboard TI drill-down: the assets behind a company / asset type tile.
 * Requires the /process/help-desk/it-dashboard subprocess.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    if (!(await canViewItDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
    }

    const params = new URL(req.url).searchParams;
    const { companyId, includeRetired } = parseItDashboardFilters(params);
    const typeId = parseTypeFilter(params);

    const assets = await loadItAssetList({ companyId, typeId, includeRetired });
    return NextResponse.json(
      { assets, limit: IT_DASHBOARD_LIST_LIMIT, truncated: assets.length >= IT_DASHBOARD_LIST_LIMIT },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Error /api/it-dashboard/assets:', err);
    return NextResponse.json({ error: 'No se pudo cargar el listado de activos.' }, { status: 500 });
  }
}
