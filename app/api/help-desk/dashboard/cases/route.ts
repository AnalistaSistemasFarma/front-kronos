import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { canViewHelpdeskDashboard } from '../../../../../lib/help-desk/dashboard/access';
import {
  buildCaseDetail,
  parseCaseBucket,
  parseDashboardFilters,
  parseDimensionFilter,
} from '../../../../../lib/help-desk/dashboard/aggregate';
import { loadHelpdeskCaseRows } from '../../../../../lib/help-desk/dashboard/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/help-desk/dashboard/cases?bucket=all|resolved|pending|measured&company=&year=&month=
 *     [&dimension=department&value=<label shown in the table>]
 * Dashboard Helpdesk: cases behind one KPI card (subject and classification, never the
 * description or resolution text). Requires the /process/help-desk/dashboard subprocess.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    if (!(await canViewHelpdeskDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard Helpdesk.' }, { status: 403 });
    }

    const params = new URL(req.url).searchParams;
    const bucket = parseCaseBucket(params.get('bucket'));
    if (!bucket) return NextResponse.json({ error: 'El indicador solicitado no es válido.' }, { status: 400 });

    const dimension = params.has('dimension') ? parseDimensionFilter(params) : null;
    if (params.has('dimension') && !dimension) {
      return NextResponse.json({ error: 'El filtro solicitado no es válido.' }, { status: 400 });
    }

    const rows = await loadHelpdeskCaseRows({ withSubject: true });
    const data = buildCaseDetail(rows, parseDashboardFilters(params), bucket, 1000, dimension);

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error /api/help-desk/dashboard/cases:', err);
    return NextResponse.json({ error: 'No se pudo cargar el detalle de los casos.' }, { status: 500 });
  }
}
