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

export type ValentineWallCompanyScope = {
  idCompany: number;
  companyName: string;
};

function isAdminRole(role?: string | null): boolean {
  const normalized = role?.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_user';
}

/**
 * Empresas donde el usuario tiene el subproceso Valentine asignado
 * (company_user → subprocess_user_company). Cada empresa = su propio tablero.
 */
export async function listValentineWallCompaniesForUser(
  userEmail: string
): Promise<ValentineWallCompanyScope[]> {
  const email = String(userEmail || '')
    .trim()
    .toLowerCase();
  if (!email) return [];

  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: VALENTINE_WALL_ACCESS_URL },
    },
    select: {
      companyUser: {
        select: {
          id_company: true,
          company: { select: { company: true } },
        },
      },
    },
  });

  const byId = new Map<number, ValentineWallCompanyScope>();
  for (const row of rows) {
    const idCompany = row.companyUser.id_company;
    if (byId.has(idCompany)) continue;
    byId.set(idCompany, {
      idCompany,
      companyName: String(row.companyUser.company?.company || `Empresa ${idCompany}`).trim(),
    });
  }
  return Array.from(byId.values());
}

export async function userHasValentineWallSubprocess(
  userEmail: string
): Promise<boolean> {
  const scopes = await listValentineWallCompaniesForUser(userEmail);
  return scopes.length > 0;
}

/**
 * Elige el tablero de la empresa del subproceso.
 * - Usuarios: empresa activa del hub (`preferredCompanyId`) si tienen el subproceso ahí; si no, la primera.
 * - Admins: pueden pasar cualquier `preferredCompanyId` de sus asignaciones (selector en el tablero).
 */
export async function resolveValentineWallCompany(
  userEmail: string,
  preferredCompanyId?: number | null
): Promise<ValentineWallCompanyScope | null> {
  const scopes = await listValentineWallCompaniesForUser(userEmail);
  if (scopes.length === 0) return null;

  if (preferredCompanyId != null && Number.isFinite(preferredCompanyId)) {
    const match = scopes.find((s) => s.idCompany === preferredCompanyId);
    if (match) return match;
  }

  return scopes[0];
}

export async function assertValentineWallAccess(
  email: string,
  preferredCompanyId?: number | null
): Promise<{
  ok: boolean;
  reason?: 'unauthorized' | 'no_subprocess' | 'off_season';
  company?: ValentineWallCompanyScope;
  companies?: ValentineWallCompanyScope[];
}> {
  if (!email) return { ok: false, reason: 'unauthorized' };
  if (!isValentineWallSeason()) return { ok: false, reason: 'off_season' };

  const companies = await listValentineWallCompaniesForUser(email);
  if (companies.length === 0) return { ok: false, reason: 'no_subprocess' };

  const company = await resolveValentineWallCompany(email, preferredCompanyId);
  if (!company) return { ok: false, reason: 'no_subprocess' };

  return { ok: true, company, companies };
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

/** Lee ?companyId= o body.companyId de forma segura. */
export function parsePreferredCompanyId(
  value: unknown
): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}
