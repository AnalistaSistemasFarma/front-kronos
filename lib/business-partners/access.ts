import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Socios de Negocio" (multiempresa, SOLO
 * LECTURA).
 *
 * Espeja el mecanismo de "Articulos", pero simplificado: como el modulo es de
 * solo consulta, hay UN unico nivel de permiso (lectura), modelado con UN
 * subproceso bajo el proceso "Maestros SAP". Cada fila de
 * subprocess_user_company ata el permiso a un company_user, que define EN QUE
 * EMPRESA aplica.
 *
 *   - READ_URL -> consultar el listado consolidado de socios de negocio.
 *
 * DECISION DE ACCESO:
 * Se crea un subproceso PROPIO (`/process/business-partners`) en vez de reusar
 * el de artículos, porque conceptualmente son entidades distintas (Items vs
 * BusinessPartners) y un usuario podría necesitar ver socios sin ver artículos.
 * Para que el modulo sea probable YA, el SQL de siembra (ver reporte de
 * entrega) CLONA las asignaciones del subproceso de lectura de artículos hacia
 * este nuevo subproceso, de modo que quien ve artículos vea también socios en
 * las mismas empresas. Ningun cambio de código adicional es necesario.
 *
 * "Readiness" NO depende de un UDO: la entidad estandar BusinessPartners existe
 * siempre en SAP. Una empresa esta lista si su endpoint SAP esta configurado
 * con credenciales (baseUrl + companyDB).
 */

// Permiso dedicado del modulo (subproceso sembrado en BD: lectura).
export const BUSINESS_PARTNERS_READ_URL = '/process/business-partners';

/** Endpoint SAP de una empresa, con credenciales. SOLO uso en servidor. */
export interface CompanySapEndpoint {
  baseUrl: string;
  username: string;
  password: string;
  /** CompanyDB de SAP B1 (columna `client`). */
  companyDB: string;
}

/** Acceso de un usuario a una empresa dentro del modulo. */
export interface BusinessPartnersCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  /** null si la empresa no tiene endpoint SAP activo configurado. */
  endpoint: CompanySapEndpoint | null;
}

/** Vista segura para el cliente: sin credenciales. */
export interface BusinessPartnersCompanyPublic {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  /** true si la empresa esta lista para consultar (endpoint activo). */
  ready: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso de lectura en el
 * modulo de socios de negocio, con su endpoint SAP.
 *
 * INCLUYE credenciales -> NO devolver tal cual al navegador. Para el cliente,
 * usar toPublicAccess().
 */
export async function getBusinessPartnersAccess(
  userEmail: string
): Promise<BusinessPartnersCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: {
        subprocess_url: BUSINESS_PARTNERS_READ_URL,
      },
    },
    include: {
      subprocess: true,
      companyUser: {
        include: {
          company: { include: { sap_endpoints: true } },
        },
      },
    },
  });

  const byCompany = new Map<number, BusinessPartnersCompanyAccess>();

  for (const row of rows) {
    const company = row.companyUser.company;
    const id = company.id_company;

    if (byCompany.has(id)) continue;

    const ep =
      company.sap_endpoints.find((e) => e.is_active) ?? company.sap_endpoints[0] ?? null;
    byCompany.set(id, {
      idCompany: id,
      companyName: company.company,
      canRead: true,
      endpoint: ep
        ? {
            baseUrl: ep.base_url,
            username: ep.username ?? '',
            password: ep.password ?? '',
            companyDB: ep.client ?? '',
          }
        : null,
    });
  }

  return [...byCompany.values()];
}

/** Una empresa esta "lista" si tiene endpoint activo con credenciales. */
export function isCompanyReady(access: BusinessPartnersCompanyAccess): boolean {
  return Boolean(access.endpoint && access.endpoint.baseUrl && access.endpoint.companyDB);
}

/**
 * Devuelve el acceso (con endpoint y credenciales, SOLO servidor) de UNA empresa
 * para un usuario, validando que la empresa este lista. null si no tiene
 * permiso, la empresa no aplica, o no esta configurada.
 */
export async function getCompanyEndpointForUser(
  userEmail: string,
  companyId: number
): Promise<BusinessPartnersCompanyAccess | null> {
  const access = await getBusinessPartnersAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (!company.canRead) return null;
  if (!isCompanyReady(company)) return null;
  return company;
}

/** Proyecta el acceso a la forma segura para el navegador (sin credenciales). */
export function toPublicAccess(
  access: BusinessPartnersCompanyAccess[]
): BusinessPartnersCompanyPublic[] {
  return access.map((a) => ({
    idCompany: a.idCompany,
    companyName: a.companyName,
    canRead: a.canRead,
    ready: isCompanyReady(a),
  }));
}
