import { prisma } from '../prisma';

/**
 * Resolución de permisos del módulo "Métricas del Service Layer" (OLP).
 *
 * Mismo patrón que lib/organigrama/access.ts: un solo subproceso
 * ('/process/service-layer-metrics') sembrado en subprocess_user_company.
 * Un único nivel de acceso (ver): es información operativa/técnica interna
 * de infraestructura (conteo de tráfico del SAP Service Layer), sin datos
 * de negocio ni información personal — pero igual queda restringida
 * (no visible para cualquier usuario) porque hoy solo tiene sentido para
 * quien da soporte técnico/infra, a diferencia de un módulo de negocio
 * abierto a toda la operación.
 *
 * A diferencia de Organigrama/Registros Sanitarios, este módulo NO es
 * multiempresa: hoy solo existe data de OLP (ver ServiceLayerDailyMetric.company
 * en schema.prisma), así que no hace falta resolver una lista de empresas,
 * solo un booleano de acceso al módulo.
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
