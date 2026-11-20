import { prisma } from '../prisma';
import { SYSTEM_METRICS_ACCESS_URL } from '../system-metrics/access';
import { SERVICE_LAYER_METRICS_ACCESS_URL } from '../service-layer-metrics/access';

/**
 * Monitor SAPSEND: quienes ya ven Monitor del sistema o Service Layer.
 * Es infra (latencia/concurrencia/fallos del salto SynerLink→SAPSEND).
 */
export const SAPSEND_MONITOR_ACCESS_URL = '/process/sapsend-monitor';

export async function hasSapsendMonitorAccess(userEmail: string): Promise<boolean> {
  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email: userEmail, isActive: true } },
      subprocess: {
        subprocess_url: {
          in: [SYSTEM_METRICS_ACCESS_URL, SERVICE_LAYER_METRICS_ACCESS_URL, SAPSEND_MONITOR_ACCESS_URL],
        },
      },
    },
    select: { id_subprocess_user_company: true },
  });
  return row !== null;
}
