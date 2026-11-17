import { prisma } from '../../prisma';
import type { SapCredentials } from '../../sap/serviceLayer';

/**
 * Permiso del «Dashboard de gestión comercial» (mismo patrón que
 * lib/dashboards/venta-diaria/access.ts y lib/predictivo/access.ts).
 *
 * Un único subproceso ('/process/dashboards/gestion-comercial', bajo el proceso
 * «Dashboards») asignado POR EMPRESA en subprocess_user_company. El usuario ve
 * una empresa solo si tiene el subproceso en esa empresa; sin filas, sin acceso
 * (fail-closed). Las credenciales SAP salen de `sap_endpoints` y nunca llegan al
 * navegador.
 */
export const GESTION_COMERCIAL_URL = '/process/dashboards/gestion-comercial';

/** Empresas con SAP Business One (id de la tabla `company`), en orden de pestaña. */
export const GESTION_COMERCIAL_EMPRESAS: readonly number[] = [1, 2, 3, 7, 6, 9];

interface EndpointRow {
  base_url: string;
  username: string | null;
  password: string | null;
  client: string | null;
  is_active: boolean | null;
}

/** Endpoint activo con credenciales completas, o null. */
export function endpointListo(endpoints: EndpointRow[]): SapCredentials | null {
  const ep = endpoints.find((e) => e.is_active);
  if (!ep || !ep.base_url || !ep.client) return null;
  return { baseUrl: ep.base_url, username: ep.username ?? '', password: ep.password ?? '', companyDB: ep.client };
}

export interface EmpresaGestionComercial {
  id: number;
  nombre: string;
  /** true si la empresa tiene Service Layer activo configurado. */
  lista: boolean;
}

/** Empresas permitidas para la sesión (vista segura, sin credenciales). */
export async function getGestionComercialEmpresas(userEmail: string): Promise<EmpresaGestionComercial[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail }, id_company: { in: [...GESTION_COMERCIAL_EMPRESAS] } },
      subprocess: { subprocess_url: GESTION_COMERCIAL_URL },
    },
    select: {
      companyUser: {
        select: { company: { select: { id_company: true, company: true, sap_endpoints: true } } },
      },
    },
  });
  const porId = new Map<number, EmpresaGestionComercial>();
  for (const r of rows) {
    const c = r.companyUser.company;
    porId.set(c.id_company, { id: c.id_company, nombre: c.company.trim(), lista: endpointListo(c.sap_endpoints) !== null });
  }
  return GESTION_COMERCIAL_EMPRESAS.filter((id) => porId.has(id)).map((id) => porId.get(id)!);
}

export type AccesoEmpresa =
  | { permitido: false }
  | { permitido: true; endpoint: SapCredentials | null };

/** Acceso de UNA empresa: sin permiso → { permitido:false }. Solo servidor. */
export async function accesoGestionComercial(userEmail: string, companyId: number): Promise<AccesoEmpresa> {
  if (!GESTION_COMERCIAL_EMPRESAS.includes(companyId)) return { permitido: false };
  const row = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email: userEmail }, id_company: companyId },
      subprocess: { subprocess_url: GESTION_COMERCIAL_URL },
    },
    select: { companyUser: { select: { company: { select: { sap_endpoints: true } } } } },
  });
  if (!row) return { permitido: false };
  return { permitido: true, endpoint: endpointListo(row.companyUser.company.sap_endpoints) };
}
