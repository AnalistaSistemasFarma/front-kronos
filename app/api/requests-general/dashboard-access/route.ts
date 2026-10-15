import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  hasRequestDashboardAccess,
  resolveUserIdByEmail,
  type RequestDashboardKind,
} from '../../../../lib/request-general/dashboardAccess';
import { isTeamLeader } from '../../../../lib/request-general/teamDashboard';

/**
 * GET /api/requests-general/dashboard-access?kind=solicitante|solicitado|equipo
 * `equipo` no es un permiso asignado: lo tiene quien es líder (ver teamDashboard.ts).
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ allowed: false, error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get('kind') || '').trim() as RequestDashboardKind | 'equipo';
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
