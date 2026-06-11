import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { prisma } from '../../../../lib/prisma';

/**
 * GET /api/dashboard/access
 * Misma regla que las APIs del dashboard: rol admin/super_user o acceso al subproceso de administración.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ allowed: false, error: 'No autorizado' }, { status: 401 });
  }

  const [allowed, user] = await Promise.all([
    checkAdminPrivileges(email),
    prisma.user.findUnique({
      where: { email },
      select: { role: true },
    }),
  ]);

  return NextResponse.json({
    allowed,
    role: user?.role ?? null,
    isAdmin: allowed,
  });
}
