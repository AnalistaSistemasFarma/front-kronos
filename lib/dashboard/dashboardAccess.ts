import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { checkAdminPrivileges } from '../access-control';
import { prisma } from '@/lib/prisma';

/** Rol global admin/super_user (p. ej. verificación de edición de solicitudes). */
export function isDashboardAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'super_user';
}

/**
 * Acceso al dashboard analítico: admins globales o quienes administran usuarios.
 */
export async function canAccessDashboard(email: string): Promise<boolean> {
  return checkAdminPrivileges(email);
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

  const allowed = await canAccessDashboard(email);
  return { allowed, email };
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
    const user = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'Sin permiso',
          role: user?.role ?? null,
          hint: 'Se requiere rol admin/super_user o acceso al subproceso de administración de usuarios.',
        },
        { status: 403 }
      ),
    };
  }
  return { ok: true, email };
}
