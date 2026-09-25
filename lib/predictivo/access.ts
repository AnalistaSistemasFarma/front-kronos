import { prisma } from '../prisma';

/**
 * Permisos del módulo "Predicciones" (piloto Farmalógica).
 *
 * Mismo patrón que lib/service-layer-metrics/access.ts: un único subproceso
 * ('/process/predicciones') sembrado en subprocess_user_company, y además
 * acotado a Farmalógica (id_company = 1), la única empresa con datos en este
 * piloto. Sin filas de permiso el módulo queda invisible (fail-closed).
 */
export const PREDICCIONES_ACCESS_URL = '/process/predicciones';
export const PREDICCIONES_COMPANY_ID = 1; // Farmalógica S.A.

export async function hasPrediccionesAccess(userEmail: string): Promise<boolean> {
  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email: userEmail }, id_company: PREDICCIONES_COMPANY_ID },
      subprocess: { subprocess_url: PREDICCIONES_ACCESS_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return row !== null;
}
