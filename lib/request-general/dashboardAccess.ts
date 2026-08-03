import { prisma } from '../prisma';

/** URLs de los subprocesos Dashboard Solicitante / Solicitado. */
export const DASHBOARD_SOLICITANTE_URL = '/process/request-general/dashboard-solicitante';
export const DASHBOARD_SOLICITADO_URL = '/process/request-general/dashboard-solicitado';

/**
 * Subprocesos que viven en el header (no deben listarse en el hub de Procesos).
 */
export function isHubHiddenRequestDashboardSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = (subprocess.subprocess_url ?? '').toLowerCase().trim();
  if (
    url === DASHBOARD_SOLICITADO_URL.toLowerCase() ||
    url === DASHBOARD_SOLICITANTE_URL.toLowerCase() ||
    url.includes('/dashboard-solicitado') ||
    url.includes('/dashboard-solicitante')
  ) {
    return true;
  }

  const name = (subprocess.subprocess ?? '').toLowerCase().trim();
  return (
    name === 'dashboard solicitado' ||
    name.includes('dashboard solicitado') ||
    name === 'dashboard solicitante' ||
    name.includes('dashboard solicitante')
  );
}

export type RequestDashboardKind = 'solicitante' | 'solicitado';

async function resolveUserEmail(userEmail: string): Promise<string | null> {
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

export async function hasRequestDashboardAccess(
  userEmail: string,
  kind: RequestDashboardKind
): Promise<boolean> {
  const email = await resolveUserEmail(userEmail);
  if (!email) return false;

  const url = kind === 'solicitante' ? DASHBOARD_SOLICITANTE_URL : DASHBOARD_SOLICITADO_URL;

  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: url },
    },
    select: { id_subprocess_user_company: true },
  });

  return Boolean(row);
}

/**
 * Inicio post-login: Mis procesos (solicitado) > Solicitante > hub de procesos.
 * Si tiene ambos módulos, prioriza Mis procesos.
 */
export async function resolvePersonalHomeUrl(
  userEmail: string,
  fallback = '/process'
): Promise<string> {
  if (await hasRequestDashboardAccess(userEmail, 'solicitado')) {
    return DASHBOARD_SOLICITADO_URL;
  }
  if (await hasRequestDashboardAccess(userEmail, 'solicitante')) {
    return DASHBOARD_SOLICITANTE_URL;
  }
  return fallback;
}

export async function resolveUserIdByEmail(userEmail: string): Promise<string | null> {
  const email = await resolveUserEmail(userEmail);
  if (!email) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  return user?.id ?? null;
}
