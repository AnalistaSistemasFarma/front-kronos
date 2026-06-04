import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { PrismaClient } from '../../app/generated/prisma';

const prisma = new PrismaClient();

/** Mismo criterio que GET /api/requests-general/verify-permissions */
export function isDashboardAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'super_user';
}

export async function getDashboardAdminForSession(): Promise<{
  allowed: boolean;
  email: string | null;
}> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) {
    return { allowed: false, email: null };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });

  return { allowed: isDashboardAdminRole(user?.role), email };
}

export async function requireDashboardAdminApi(): Promise<
  { ok: true; email: string } | { ok: false; response: NextResponse }
> {
  const { allowed, email } = await getDashboardAdminForSession();
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 }),
    };
  }
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Sin permiso' }, { status: 403 }),
    };
  }
  return { ok: true, email };
}
