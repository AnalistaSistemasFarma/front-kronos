import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canViewHelpdeskDashboard } from '../../../../lib/help-desk/dashboard/access';
import {
  aggregateHelpdeskDashboard,
  parseDashboardFilters,
} from '../../../../lib/help-desk/dashboard/aggregate';
import { loadHelpdeskCaseRows } from '../../../../lib/help-desk/dashboard/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/help-desk/dashboard?company=&year=&month=
 * Dashboard Helpdesk: aggregated help desk indicators (never the case text).
 * Requires the /process/help-desk/dashboard subprocess.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    if (!(await canViewHelpdeskDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard Helpdesk.' }, { status: 403 });
    }

    const filters = parseDashboardFilters(new URL(req.url).searchParams);
    const rows = await loadHelpdeskCaseRows();
    const data = aggregateHelpdeskDashboard(rows, filters);

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error /api/help-desk/dashboard:', err);
    return NextResponse.json(
      { error: 'No se pudieron calcular los indicadores de la mesa de ayuda.' },
      { status: 500 }
    );
  }
}
