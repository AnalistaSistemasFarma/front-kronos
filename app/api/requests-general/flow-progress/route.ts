import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { FLOW_MAX_IDS, loadRequestFlows } from '@/lib/requests-general/flowProgressQuery';

/**
 * GET /api/requests-general/flow-progress?ids=1,2,3
 * Flujo completo (pasos, en cuál va y avance) de cada solicitud que el usuario puede ver.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id != null ? String(session.user.id) : '';
    if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const ids = String(new URL(req.url).searchParams.get('ids') || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length > FLOW_MAX_IDS) {
      return NextResponse.json({ error: `Máximo ${FLOW_MAX_IDS} solicitudes por consulta` }, { status: 400 });
    }

    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
    const flows = await withMssqlPool((pool) => loadRequestFlows(pool, ids, { userId, isAdmin }));
    return NextResponse.json({ flows }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[flow-progress]', err);
    return NextResponse.json({ error: 'No se pudo cargar el avance de las solicitudes' }, { status: 500 });
  }
}
