import { prisma } from '../prisma';
import { DASHBOARDS_REGISTRO, dashboardsPermitidos, type DashboardKey } from './registro';

/**
 * Dashboards del registro que la sesión puede ver (en al menos una empresa).
 * Solo servidor. Fail-closed: sin filas en subprocess_user_company, lista vacía.
 */
export async function getDashboardsPermitidos(userEmail: string): Promise<DashboardKey[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: { in: DASHBOARDS_REGISTRO.map((d) => d.subprocessUrl) } },
    },
    select: { subprocess: { select: { subprocess_url: true } } },
  });
  return dashboardsPermitidos(rows.map((r) => r.subprocess.subprocess_url));
}
