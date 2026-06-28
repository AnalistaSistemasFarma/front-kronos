import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Articulos" (multiempresa).
 *
 * Espeja el mecanismo de "Registros Sanitarios": el doble nivel de permiso
 * (lectura/escritura) se modela con DOS subprocesos distintos bajo el mismo
 * proceso, cada fila atada a un company_user que define EN QUE EMPRESA aplica.
 *
 *   - READ_URL  -> consultar
 *   - WRITE_URL -> crear / editar / cargue masivo
 *
 * IMPORTANTE — reuso de acceso para testeo inmediato:
 * Para que el modulo sea probable YA, SIN sembrar permisos nuevos en BD, este
 * archivo REUSA los subprocesos de health-records (mismas filas
 * subprocess_user_company). Asi, quien tenga acceso a registros sanitarios en
 * una empresa, tiene articulos en esa misma empresa con el mismo nivel.
 *
 * Para darle al modulo sus PROPIAS filas (subproceso y permisos dedicados),
 * vea el SQL documentado en el reporte de entrega: basta crear los subprocesos
 * '/process/articles' y '/process/articles/manage' y cambiar las constantes de
 * abajo a esas URLs. Ningun otro cambio de codigo es necesario.
 *
 * "Readiness" de articulos NO depende de un UDO: la entidad estandar Items
 * existe siempre en SAP. Una empresa esta lista si su endpoint SAP esta
 * configurado con credenciales (baseUrl + companyDB).
 */

// Reuso del acceso de health-records (testeo inmediato sin filas nuevas en BD).
// Para acceso dedicado, cambie a '/process/articles' y '/process/articles/manage'.
export const ARTICLES_READ_URL = '/process/health-records';
export const ARTICLES_WRITE_URL = '/process/health-records/manage';

/** Endpoint SAP de una empresa, con credenciales. SOLO uso en servidor. */
export interface CompanySapEndpoint {
  baseUrl: string;
  username: string;
  password: string;
  /** CompanyDB de SAP B1 (columna `client`). */
  companyDB: string;
}

/** Acceso de un usuario a una empresa dentro del modulo. */
export interface ArticlesCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  /** null si la empresa no tiene endpoint SAP activo configurado. */
  endpoint: CompanySapEndpoint | null;
}

/** Vista segura para el cliente: sin credenciales. */
export interface ArticlesCompanyPublic {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  /** true si la empresa esta lista para consultar (endpoint activo). */
  ready: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el modulo de
 * articulos, con su nivel (lectura/escritura) y su endpoint SAP.
 *
 * INCLUYE credenciales -> NO devolver tal cual al navegador. Para el cliente,
 * usar toPublicAccess().
 */
export async function getArticlesAccess(userEmail: string): Promise<ArticlesCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: {
        subprocess_url: { in: [ARTICLES_READ_URL, ARTICLES_WRITE_URL] },
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

  const byCompany = new Map<number, ArticlesCompanyAccess>();

  for (const row of rows) {
    const company = row.companyUser.company;
    const id = company.id_company;
    const isWrite = row.subprocess.subprocess_url === ARTICLES_WRITE_URL;

    let entry = byCompany.get(id);
    if (!entry) {
      const ep =
        company.sap_endpoints.find((e) => e.is_active) ?? company.sap_endpoints[0] ?? null;
      entry = {
        idCompany: id,
        companyName: company.company,
        canRead: false,
        canWrite: false,
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

    if (isWrite) entry.canWrite = true;
    else entry.canRead = true;
  }

  // El permiso de escritura implica el de lectura.
  for (const entry of byCompany.values()) {
    if (entry.canWrite) entry.canRead = true;
  }

  return [...byCompany.values()];
}

/** Una empresa esta "lista" si tiene endpoint activo con credenciales. */
export function isCompanyReady(access: ArticlesCompanyAccess): boolean {
  return Boolean(access.endpoint && access.endpoint.baseUrl && access.endpoint.companyDB);
}

/**
 * Devuelve el acceso (con endpoint y credenciales, SOLO servidor) de UNA empresa
 * para un usuario, validando el nivel requerido y que la empresa este lista.
 * null si no tiene permiso, la empresa no aplica, o no esta configurada.
 */
export async function getCompanyEndpointForUser(
  userEmail: string,
  companyId: number,
  level: 'read' | 'write'
): Promise<ArticlesCompanyAccess | null> {
  const access = await getArticlesAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (level === 'write' && !company.canWrite) return null;
  if (!company.canRead) return null;
  if (!isCompanyReady(company)) return null;
  return company;
}

/** Proyecta el acceso a la forma segura para el navegador (sin credenciales). */
export function toPublicAccess(access: ArticlesCompanyAccess[]): ArticlesCompanyPublic[] {
  return access.map((a) => ({
    idCompany: a.idCompany,
    companyName: a.companyName,
    canRead: a.canRead,
    canWrite: a.canWrite,
    ready: isCompanyReady(a),
  }));
}
