import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  hasRequestDashboardAccess,
  type RequestDashboardKind,
} from '../../../../lib/request-general/dashboardAccess';

/**
 * GET /api/requests-general/dashboard-access?kind=solicitante|solicitado
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ allowed: false, error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get('kind') || '').trim() as RequestDashboardKind;
    if (kind !== 'solicitante' && kind !== 'solicitado') {
      return NextResponse.json(
        { allowed: false, error: 'Parámetro kind inválido (solicitante|solicitado)' },
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
