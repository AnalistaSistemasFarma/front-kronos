import { prisma } from '../prisma';

/**
 * Permisos del módulo "Monitor del sistema". Mismo patrón que
 * lib/service-layer-metrics/access.ts: un subproceso ('/process/system-metrics') sembrado en
 * subprocess_user_company (prisma/seeds/system-metrics-permisos.sql). Es información técnica
 * de infraestructura (consultas SQL, hosts, consumo), así que no se abre a toda la operación.
 */
export const SYSTEM_METRICS_ACCESS_URL = '/process/system-metrics';

export async function hasSystemMetricsAccess(userEmail: string): Promise<boolean> {
  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email: userEmail, isActive: true } },
      subprocess: { subprocess_url: SYSTEM_METRICS_ACCESS_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return row !== null;
}

/** Correos (activos, sin repetir) de quienes tienen el módulo; reciben alertas solo si además las activaron. */
export async function listSystemMetricsRecipients(): Promise<string[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      subprocess: { subprocess_url: SYSTEM_METRICS_ACCESS_URL },
      companyUser: { user: { isActive: true } },
    },
    select: { companyUser: { select: { user: { select: { email: true } } } } },
  });
  return Array.from(new Set(rows.map((r) => r.companyUser.user.email.trim().toLowerCase()).filter(Boolean)));
}
