import { prisma } from '../prisma';

/**
 * Permisos del módulo "Predicciones".
 *
 * Mismo patrón que lib/service-layer-metrics/access.ts: un único subproceso
 * ('/process/predicciones') sembrado en subprocess_user_company. El acceso es
 * POR EMPRESA: el usuario ve una empresa solo si tiene el subproceso asignado
 * en esa empresa y la empresa tiene motor predictivo. Sin filas de permiso el
 * módulo queda invisible (fail-closed).
 */
export const PREDICCIONES_ACCESS_URL = '/process/predicciones';
export const PREDICCIONES_COMPANY_ID = 1; // Farmalógica S.A. (piloto)

/** Empresas con motor predictivo (id de la tabla `company`) y nombre corto para la pestaña. */
export const PREDICCIONES_EMPRESAS: Record<number, string> = {
  1: 'Farmalógica',
  2: 'Ryan',
  3: 'OLP',
  7: 'Abamia',
  6: 'Meditrack',
  9: 'Kelab',
};
const ORDEN = [1, 2, 3, 7, 6, 9];

export interface EmpresaPrediccion {
  id: number;
  nombre: string;
}

export async function getPrediccionesCompanies(userEmail: string): Promise<EmpresaPrediccion[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail }, id_company: { in: ORDEN } },
      subprocess: { subprocess_url: PREDICCIONES_ACCESS_URL },
    },
    select: { companyUser: { select: { id_company: true } } },
  });
  const ids = new Set(rows.map((r) => r.companyUser.id_company));
  return ORDEN.filter((id) => ids.has(id)).map((id) => ({ id, nombre: PREDICCIONES_EMPRESAS[id] }));
}

export async function hasPrediccionesAccess(
  userEmail: string,
  companyId: number = PREDICCIONES_COMPANY_ID
): Promise<boolean> {
  if (!PREDICCIONES_EMPRESAS[companyId]) return false;
  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email: userEmail }, id_company: companyId },
      subprocess: { subprocess_url: PREDICCIONES_ACCESS_URL },
    },
    select: { id_subprocess_user_company: true },
  });
  return row !== null;
}
