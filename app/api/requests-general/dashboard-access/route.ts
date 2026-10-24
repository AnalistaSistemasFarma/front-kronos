import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  hasRequestDashboardAccess,
  resolveUserIdByEmail,
  type RequestDashboardKind,
} from '../../../../lib/request-general/dashboardAccess';
import { isTeamLeader } from '../../../../lib/request-general/teamDashboard';
import { checkAdminPrivileges } from '../../../../lib/access-control';

/**
 * GET /api/requests-general/dashboard-access?kind=solicitante|solicitado|equipo|all
 * `all` devuelve los tres más `dashboardAdmin` (misma regla que /api/dashboard/access).
 * `equipo` no es un permiso asignado: lo tiene quien es líder (ver teamDashboard.ts).
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ allowed: false, error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get('kind') || '').trim() as RequestDashboardKind | 'equipo' | 'all';
    if (kind === 'all') {
      // Todo lo que necesita el menú en UNA llamada y en paralelo (antes 4–6 llamadas por página).
      const email = session.user.email;
      const [solicitante, solicitado, equipo, dashboardAdmin] = await Promise.all([
        hasRequestDashboardAccess(email, 'solicitante'),
        hasRequestDashboardAccess(email, 'solicitado'),
        resolveUserIdByEmail(email).then((userId) => (userId ? isTeamLeader(userId) : false)),
        checkAdminPrivileges(email),
      ]);
      return NextResponse.json({ kind, solicitante, solicitado, equipo, dashboardAdmin });
    }
    if (kind === 'equipo') {
      const userId = await resolveUserIdByEmail(session.user.email);
      const allowed = userId ? await isTeamLeader(userId) : false;
      return NextResponse.json({ allowed, kind });
    }
    if (kind !== 'solicitante' && kind !== 'solicitado') {
      return NextResponse.json(
        { allowed: false, error: 'Parámetro kind inválido (solicitante|solicitado|equipo)' },
        { status: 400 }
      );
    }

    const allowed = await hasRequestDashboardAccess(session.user.email, kind);
    return NextResponse.json({ allowed, kind });
  } catch (error) {
    console.error('Error dashboard-access:', error);
    return NextResponse.json({ allowed: false, error: 'Error interno' }, { status: 500 });
  }
}
