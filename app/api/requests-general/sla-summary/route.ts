import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { loadSlaScope } from '../../../../lib/requests-general/slaScope';

/**
 * SLA (ANS) summary of the open requests the session user manages (by process or category).
 * GET /api/requests-general/sla-summary[?company=ID]
 * → { available, counts: { overdue, near_due, on_time, no_sla, returned }, byRequest: { [id]: info } }
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const idUser = session?.user?.id ? String(session.user.id) : '';
    if (!session?.user?.email || !idUser) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const companyRaw = new URL(req.url).searchParams.get('company');
    const company = companyRaw ? Number.parseInt(companyRaw, 10) : null;
    const summary = await withMssqlPool((pool) =>
      loadSlaScope(pool, idUser, { company: Number.isInteger(company) ? company : null })
    );
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error sla-summary:', error);
    return NextResponse.json({ error: 'Error al calcular el ANS de las solicitudes' }, { status: 500 });
  }
}
