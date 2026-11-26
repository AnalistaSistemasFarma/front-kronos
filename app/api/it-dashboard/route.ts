import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../lib/it-dashboard/access';
import { aggregateItDashboard, parseItDashboardFilters } from '../../../lib/it-dashboard/aggregate';
import { loadItAssetRows, loadItCatalog } from '../../../lib/it-dashboard/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/it-dashboard?company=&includeRetired=
 * Dashboard TI: asset counts per company, per asset type and per status.
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

    const filters = parseItDashboardFilters(new URL(req.url).searchParams);
    const [rows, catalog] = await Promise.all([loadItAssetRows(), loadItCatalog()]);
    const data = aggregateItDashboard(rows, catalog, filters);

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error /api/it-dashboard:', err);
    return NextResponse.json(
      { error: 'No se pudieron calcular los indicadores del inventario de TI.' },
      { status: 500 }
    );
  }
}
