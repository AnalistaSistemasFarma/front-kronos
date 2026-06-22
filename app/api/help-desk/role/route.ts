import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getHelpDeskUserRole } from '../../../../lib/help-desk/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/help-desk/role
 * Devuelve si el usuario es técnico (panel general) o solicitante (mis tickets).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const role = await getHelpDeskUserRole(session.user.email);

  return NextResponse.json({
    ...role,
    isTechnician: role.isOperator,
  });
}
