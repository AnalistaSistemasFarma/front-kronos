import 'server-only';
import { prisma } from '../prisma';
import {
  isValentineWallSeason,
  VALENTINE_WALL_ACCESS_URL,
} from './constants';

export {
  VALENTINE_WALL_ACCESS_URL,
  VALENTINE_WALL_ACCESS_NAME,
  isValentineWallSubprocess,
} from './constants';

const ADMIN_USERS_SUBPROCESS_URL = '/process/administration/users';

function isAdminRole(role?: string | null): boolean {
  const normalized = role?.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_user';
}

/**
 * Acceso por asignación de subproceso (subprocess_user_company).
 * Pensado para OLP: el admin lo otorga solo a usuarios de esa empresa.
 */
export async function userHasValentineWallSubprocess(
  userEmail: string
): Promise<boolean> {
  const email = String(userEmail || '')
    .trim()
    .toLowerCase();
  if (!email) return false;

  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: VALENTINE_WALL_ACCESS_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return row !== null;
}

export async function assertValentineWallAccess(email: string): Promise<{
  ok: boolean;
  reason?: 'unauthorized' | 'no_subprocess' | 'off_season';
}> {
  if (!email) return { ok: false, reason: 'unauthorized' };
  if (!isValentineWallSeason()) return { ok: false, reason: 'off_season' };
  const hasSub = await userHasValentineWallSubprocess(email);
  if (!hasSub) return { ok: false, reason: 'no_subprocess' };
  return { ok: true };
}

/** Admin de plataforma (rol o subproceso Administración → Usuarios). */
export async function userCanModerateValentineWall(
  userEmail: string
): Promise<boolean> {
  const email = String(userEmail || '').trim();
  if (!email) return false;

  try {
    const exact = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });
    if (exact && isAdminRole(exact.role)) return true;

    const byRole = await prisma.$queryRaw<Array<{ role: string | null }>>`
      SELECT TOP 1 role
      FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${email})))
    `;
    if (isAdminRole(byRole[0]?.role)) return true;

    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT TOP 1 suc.id_subprocess_user_company AS id
      FROM [subprocess_user_company] suc
      INNER JOIN [company_user] cu ON cu.id_company_user = suc.id_company_user
      INNER JOIN [user] u ON u.id = cu.id_user
      INNER JOIN [subprocess] s ON s.id_subprocess = suc.id_subprocess
      WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(${email})))
        AND LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, '')))) =
            LOWER(LTRIM(RTRIM(${ADMIN_USERS_SUBPROCESS_URL})))
    `;
    return Boolean(rows[0]?.id);
  } catch (error) {
    console.error('[valentine] moderate check', error);
    return false;
  }
}
