import { prisma } from '../prisma';

/**
 * Permisos del "Monitor Service Layer".
 *
 * Subproceso '/process/service-layer-metrics' en subprocess_user_company.
 * Incluye: (1) foto en vivo de TODAS las empresas con sap_endpoints
 * (concurrencia/latencia desde SynerLink) y (2) histórico diario OLP.
 * Un solo booleano de acceso (información técnica/operativa).
 */
export const SERVICE_LAYER_METRICS_ACCESS_URL = '/process/service-layer-metrics';

/**
 * Verifica si el usuario tiene acceso al módulo de métricas del Service
 * Layer (subprocess_user_company vía cualquiera de sus company_user).
 */
export async function hasServiceLayerMetricsAccess(userEmail: string): Promise<boolean> {
  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: SERVICE_LAYER_METRICS_ACCESS_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return row !== null;
}
