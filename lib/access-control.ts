import { getServerSession } from 'next-auth';
import { authOptions } from '../app/api/auth/[...nextauth]/route';
import { prisma } from './prisma';

const ADMIN_USERS_SUBPROCESS_URL = '/process/administration/users';

function isAdminRole(role?: string | null): boolean {
  const normalized = role?.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_user';
}

/** Resuelve el email canónico en BD (evita 403 por diferencias de mayúsculas en sesión vs SQL). */
export async function resolveCanonicalUserEmail(userEmail: string): Promise<string | null> {
  const trimmed = userEmail?.trim();
  if (!trimmed) return null;

  const exact = await prisma.user.findUnique({
    where: { email: trimmed },
    select: { email: true },
  });
  if (exact?.email) return exact.email;

  const rows = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT TOP 1 email
    FROM [user]
    WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${trimmed})))
  `;
  return rows[0]?.email ?? null;
}

/**
 * Check if user has admin privileges based on role or subprocess access
 * @param userEmail - The email of the user to check
 * @returns Promise<boolean> - True if user has admin privileges
 */
export async function checkAdminPrivileges(userEmail: string): Promise<boolean> {
  const email = await resolveCanonicalUserEmail(userEmail);
  if (!email) {
    return false;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });

    if (isAdminRole(user?.role)) {
      return true;
    }

    // Misma fuente que Administración → Usuarios (subprocess_user_company)
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
    console.error('Error checking admin privileges:', error);
    return false;
  }
}

/**
 * Get current user session and check if they have admin privileges
 * @returns Promise<{isAdmin: boolean, userEmail: string | null}>
 */
export async function getCurrentUserAdminStatus(): Promise<{
  isAdmin: boolean;
  userEmail: string | null;
}> {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email || null;

    if (!userEmail) {
      return { isAdmin: false, userEmail: null };
    }

    const isAdmin = await checkAdminPrivileges(userEmail);
    return { isAdmin, userEmail };
  } catch (error) {
    console.error('Error getting current user admin status:', error);
    return { isAdmin: false, userEmail: null };
  }
}

/**
 * Client-side utility to check if user has admin privileges
 * This should be used with caution on client-side and always verified on server-side
 * @param userRole - The role of the user from session
 * @returns boolean - True if user has admin privileges
 */
export function hasAdminRole(userRole?: string): boolean {
  return isAdminRole(userRole);
}
