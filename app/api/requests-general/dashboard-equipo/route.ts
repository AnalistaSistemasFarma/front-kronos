import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import { isTeamLeader, loadTeamActivities } from '../../../../lib/request-general/teamDashboard';

/**
 * Dashboard «Mi equipo»: actividades de los colaboradores en las solicitudes de las que
 * el usuario es responsable. Sin actividades de equipo = no es líder (403).
 * GET /api/requests-general/dashboard-equipo
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const userId = await resolveUserIdByEmail(session.user.email);
    if (!userId) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    const activities = await loadTeamActivities(userId);
    if (activities.length === 0 && !(await isTeamLeader(userId))) {
      return NextResponse.json(
        { error: 'No tienes colaboradores con actividades en tus procesos' },
        { status: 403 }
      );
    }

    return NextResponse.json({ role: 'lider', userId, activities });
  } catch (error) {
    console.error('Error dashboard-equipo:', error);
    return NextResponse.json(
      { error: 'Error al cargar el dashboard de tu equipo' },
      { status: 500 }
    );
  }
}
