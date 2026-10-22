/**
 * REJA de la auditoría de inicios de sesión (servidor).
 *
 * Dos condiciones, ambas obligatorias:
 *   1. Ser administrador de Usuarios (checkAdminPrivileges: rol admin/super_user
 *      o el subproceso /process/administration/users).
 *   2. Tener rol admin / super_user, O el subproceso-marcador
 *      /process/administration/users/inicios-sesion en cualquier empresa.
 *
 * Así, quien solo administra usuarios (crear, asignar módulos) no ve las IP ni
 * la ubicación de sus compañeros salvo que se le otorgue con nombre propio.
 */
import 'server-only';
import { checkAdminPrivileges, resolveCanonicalUserEmail } from '../../access-control';
import { prisma } from '../../prisma';
import { LOGIN_AUDIT_MARKER_URL } from './constants';

export async function canViewLoginAudit(userEmail: string | null | undefined): Promise<boolean> {
  if (!userEmail) return false;
  try {
    if (!(await checkAdminPrivileges(userEmail))) return false;
    const email = await resolveCanonicalUserEmail(userEmail);
    if (!email) return false;

    const rows = await prisma.$queryRaw<Array<{ role: string | null; marker: number | null }>>`
      SELECT TOP 1 u.role,
        (SELECT TOP 1 suc.id_subprocess_user_company
           FROM [subprocess_user_company] suc
           INNER JOIN [company_user] cu ON cu.id_company_user = suc.id_company_user
           INNER JOIN [subprocess] s ON s.id_subprocess = suc.id_subprocess
          WHERE cu.id_user = u.id
            AND LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, '')))) = ${LOGIN_AUDIT_MARKER_URL}) AS marker
      FROM [user] u
      WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(${email})))
    `;
    const row = rows[0];
    if (!row) return false;
    const role = row.role?.trim().toLowerCase();
    return role === 'admin' || role === 'super_user' || Boolean(row.marker);
  } catch (error) {
    console.error('[login-audit] Error al validar el acceso:', error);
    return false;
  }
}
