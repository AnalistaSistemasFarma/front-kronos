import 'server-only';
import { prisma } from '../prisma';
import { NABUCO_SUBPROCESS_URLS } from './constants';

/**
 * Permisos del módulo con el patrón de SynerLink: subproceso × company_user
 * (subprocess_user_company), igual que Vitrina:
 *   - «Transferencias Nabuco»                  → lectura (tablero, envíos, corridas) en ESA empresa;
 *   - «Transferencias Nabuco · Administración» → configuración y acciones en ESA empresa.
 */
export interface NabucoCompanyAccess {
  idCompany: number;
  companyName: string;
  canLeer: boolean;
  canAdministrar: boolean;
}

export async function getNabucoAccessForUser(email: string): Promise<NabucoCompanyAccess[]> {
  const grants = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email, isActive: true } },
      subprocess: { subprocess_url: { in: Object.values(NABUCO_SUBPROCESS_URLS) } },
    },
    select: {
      subprocess: { select: { subprocess_url: true } },
      companyUser: { select: { company: { select: { id_company: true, company: true } } } },
    },
  });
  const map = new Map<number, NabucoCompanyAccess>();
  for (const g of grants) {
    const c = g.companyUser.company;
    const e = map.get(c.id_company) ?? { idCompany: c.id_company, companyName: c.company, canLeer: false, canAdministrar: false };
    if (g.subprocess.subprocess_url === NABUCO_SUBPROCESS_URLS.admin) e.canAdministrar = true;
    e.canLeer = true; // administrar implica leer
    map.set(c.id_company, e);
  }
  return [...map.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'es'));
}

export async function getActiveUserId(email: string): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { email, isActive: true }, select: { id: true } });
  return u?.id ?? null;
}

/** Conexiones SAP (sap_endpoints) de la empresa, SIN credenciales (para la UI). */
export async function listarEndpointsSap(idCompany: number): Promise<{ id: number; nombre: string; companyDB: string; activo: boolean }[]> {
  const eps = await prisma.sap_endpoints.findMany({ where: { id_company: idCompany }, orderBy: { id_sap_endpoint: 'asc' } });
  return eps.map((e) => ({ id: e.id_sap_endpoint, nombre: e.endpoint_name, companyDB: e.client ?? '', activo: e.is_active }));
}

/** Credenciales del endpoint SAP elegido (debe ser de la MISMA empresa). SOLO servidor. */
export async function getEndpointSap(idCompany: number, idEndpoint: number | null) {
  const eps = await prisma.sap_endpoints.findMany({ where: { id_company: idCompany }, orderBy: { id_sap_endpoint: 'asc' } });
  const ep = (idEndpoint ? eps.find((e) => e.id_sap_endpoint === idEndpoint) : null) ?? (idEndpoint ? null : (eps.find((e) => e.is_active) ?? eps[0] ?? null));
  if (!ep || !ep.base_url || !ep.client) return null;
  return { baseUrl: ep.base_url, username: ep.username ?? '', password: ep.password ?? '', companyDB: ep.client };
}
