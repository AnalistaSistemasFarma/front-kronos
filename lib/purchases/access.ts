import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Compras" (multiempresa, SOLO LECTURA en el
 * MVP).
 *
 * Espeja el mecanismo de "Articulos" / "Registros Sanitarios": el permiso por
 * empresa se modela con filas subprocess_user_company atadas a un subproceso
 * cuya subprocess_url identifica el modulo. Cada fila esta atada a un
 * company_user que define EN QUE EMPRESA aplica.
 *
 *   - READ_URL  -> consultar Solicitudes y Ordenes de compra
 *
 * El MVP es de lectura: por ahora solo se usa READ. La escritura
 * (creacion/autorizacion) llega en incrementos posteriores y agregaria un
 * WRITE_URL / AUTHORIZE_URL siguiendo el mismo patron.
 *
 * IMPORTANTE — reuso de acceso para testeo inmediato:
 * Para que el modulo sea probable YA, SIN sembrar permisos nuevos en BD, este
 * archivo REUSA los subprocesos de Articulos (mismas filas
 * subprocess_user_company '/process/articles'). Asi, quien tenga acceso de
 * lectura a articulos en una empresa, tiene compras en esa misma empresa.
 *
 * Para darle al modulo su PROPIA fila (subproceso dedicado), siembre en BD el
 * subproceso '/process/purchases' (ver el SQL en el reporte de entrega) y
 * cambie PURCHASES_READ_URL abajo a esa URL. Ningun otro cambio de codigo es
 * necesario.
 *
 * "Readiness" de compras NO depende de un UDO: la entidad estandar Drafts
 * existe siempre en SAP B1. Una empresa esta lista si su endpoint SAP esta
 * configurado con credenciales (baseUrl + companyDB).
 */

// URL dedicada del modulo (sembrar el subproceso en BD para usarla; ver reporte).
export const PURCHASES_READ_URL = '/process/purchases';

// URL reusada mientras no exista la fila dedicada (subproceso de Articulos).
// Cambie PURCHASES_ACCESS_URL a PURCHASES_READ_URL en cuanto se siembre la fila.
const ARTICLES_READ_URL = '/process/articles';
const PURCHASES_ACCESS_URL = ARTICLES_READ_URL;

/** Endpoint SAP de una empresa, con credenciales. SOLO uso en servidor. */
export interface CompanySapEndpoint {
  baseUrl: string;
  username: string;
  password: string;
  /** CompanyDB de SAP B1 (columna `client`). */
  companyDB: string;
}

/** Acceso de un usuario a una empresa dentro del modulo. */
export interface PurchasesCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  /** null si la empresa no tiene endpoint SAP activo configurado. */
  endpoint: CompanySapEndpoint | null;
}

/** Vista segura para el cliente: sin credenciales. */
export interface PurchasesCompanyPublic {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  /** true si la empresa esta lista para consultar (endpoint activo). */
  ready: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso de lectura en el
 * modulo de compras, con su endpoint SAP.
 *
 * INCLUYE credenciales -> NO devolver tal cual al navegador. Para el cliente,
 * usar toPublicAccess().
 */
export async function getPurchasesAccess(userEmail: string): Promise<PurchasesCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: {
        subprocess_url: { in: [PURCHASES_ACCESS_URL] },
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

  const byCompany = new Map<number, PurchasesCompanyAccess>();

  for (const row of rows) {
    const company = row.companyUser.company;
    const id = company.id_company;

    let entry = byCompany.get(id);
    if (!entry) {
      const ep =
        company.sap_endpoints.find((e) => e.is_active) ?? company.sap_endpoints[0] ?? null;
      entry = {
        idCompany: id,
        companyName: company.company,
        canRead: false,
        endpoint: ep
          ? {
              baseUrl: ep.base_url,
              username: ep.username ?? '',
              password: ep.password ?? '',
              companyDB: ep.client ?? '',
            }
          : null,
      };
      byCompany.set(id, entry);
    }

    entry.canRead = true;
  }

  return [...byCompany.values()];
}

/** Una empresa esta "lista" si tiene endpoint activo con credenciales. */
export function isCompanyReady(access: PurchasesCompanyAccess): boolean {
  return Boolean(access.endpoint && access.endpoint.baseUrl && access.endpoint.companyDB);
}

/**
 * Devuelve el acceso (con endpoint y credenciales, SOLO servidor) de UNA empresa
 * para un usuario, validando el permiso de lectura y que la empresa este lista.
 * null si no tiene permiso, la empresa no aplica, o no esta configurada.
 */
export async function getCompanyEndpointForUser(
  userEmail: string,
  companyId: number
): Promise<PurchasesCompanyAccess | null> {
  const access = await getPurchasesAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (!company.canRead) return null;
  if (!isCompanyReady(company)) return null;
  return company;
}

/** Proyecta el acceso a la forma segura para el navegador (sin credenciales). */
export function toPublicAccess(access: PurchasesCompanyAccess[]): PurchasesCompanyPublic[] {
  return access.map((a) => ({
    idCompany: a.idCompany,
    companyName: a.companyName,
    canRead: a.canRead,
    ready: isCompanyReady(a),
  }));
}
