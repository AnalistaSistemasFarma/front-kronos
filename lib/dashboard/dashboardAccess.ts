import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { checkAdminPrivileges } from '../access-control';
import { prisma } from '@/lib/prisma';
import { extractBearer, isValidIntegrationApiKey } from '../integration/apiKeyAuth';

/** Identidad sintética cuando la petición usa API key de integración (SharePoint/PA). */
export const INTEGRATION_ACTOR_EMAIL = 'integration:sharepoint';

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

/**
 * Solo sesión NextAuth (cookie). Usado por el resto de endpoints de dashboard.
 * No acepta Bearer: no cambia el comportamiento existente.
 */
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

/**
 * Sesión NextAuth **o** API key de integración (`Authorization: Bearer …`).
 * Usar solo en rutas pensadas para SharePoint / Power Automate
 * (dashboard-cases, view-requests). El resto de endpoints no deben llamar esto.
 */
export async function requireDashboardAdminOrIntegrationApi(
  req: Request
): Promise<{ ok: true; email: string; via: 'session' | 'api_key' } | { ok: false; response: NextResponse }> {
  const bearer = extractBearer(req.headers.get('authorization'));
  if (bearer && isValidIntegrationApiKey(bearer)) {
    return { ok: true, email: INTEGRATION_ACTOR_EMAIL, via: 'api_key' };
  }

  // Bearer presente pero inválido → 401 (no caer a cookie; evita confusión en Postman/PA)
  if (bearer) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'No autorizado',
          hint: 'API key inválida. Use Authorization: Bearer <INTEGRATION_API_KEYS>.',
        },
        { status: 401 }
      ),
    };
  }

  const sessionAuth = await requireDashboardAdminApi();
  if (!sessionAuth.ok) return sessionAuth;
  return { ok: true, email: sessionAuth.email, via: 'session' };
}
