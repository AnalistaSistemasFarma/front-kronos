import { prisma } from '../prisma';
import { IT_DASHBOARD_URL } from './constants';

/**
 * True when the user has the Dashboard TI subprocess in ANY of their
 * companies. The global admin role does not grant access by itself.
 */
export async function canViewItDashboard(userEmail: string): Promise<boolean> {
  const email = userEmail?.trim();
  if (!email) return false;

  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: IT_DASHBOARD_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return Boolean(row);
}
