import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Socios de Negocio" (multiempresa).
 *
 * Espeja el mecanismo de "Articulos". El modulo nacio como SOLO LECTURA (un
 * unico subproceso `/process/business-partners`); esta ampliacion agrega
 * DETALLE + EDICION del encabezado del socio. Para modelar el doble nivel
 * (lectura/escritura) al estilo de Articulos se define tambien un subproceso de
 * ESCRITURA (`/process/business-partners/manage`), atado a company_user que
 * define EN QUE EMPRESA aplica.
 *
 *   - READ_URL  -> consultar el listado consolidado y el detalle del socio.
 *   - WRITE_URL -> actualizar el encabezado del socio (PATCH).
 *
 * ESTADO ACTUAL DEL GATEO DE ESCRITURA (importante):
 * El subproceso de escritura AUN NO esta sembrado en BD, por lo que hoy nadie
 * tendria `canWrite` y la edicion quedaria bloqueada. Para poder PROBAR la
 * edicion en testing sin sembrar permisos nuevos, la ruta de actualizacion
 * (app/api/business-partners/update) gatea por LECTURA (canRead) por ahora,
 * validando SIEMPRE la sesion (getServerSession) antes del PATCH. `canWrite`
 * queda EXPUESTO aqui para el futuro: cuando se siembre WRITE_URL en BD, basta
 * cambiar la ruta a exigir `level: 'write'` — ningun otro cambio de codigo.
 *
 * "Readiness" NO depende de un UDO: la entidad estandar BusinessPartners existe
 * siempre en SAP. Una empresa esta lista si su endpoint SAP esta configurado
 * con credenciales (baseUrl + companyDB).
 */

// Permisos del modulo (subprocesos en BD: lectura sembrada; escritura pendiente).
export const BUSINESS_PARTNERS_READ_URL = '/process/business-partners';
export const BUSINESS_PARTNERS_WRITE_URL = '/process/business-partners/manage';

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
  canWrite: boolean;
  /** null si la empresa no tiene endpoint SAP activo configurado. */
  endpoint: CompanySapEndpoint | null;
}

/** Vista segura para el cliente: sin credenciales. */
export interface BusinessPartnersCompanyPublic {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  /** true si la empresa esta lista para consultar (endpoint activo). */
  ready: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el modulo de
 * socios de negocio, con su nivel (lectura/escritura) y su endpoint SAP.
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
        subprocess_url: { in: [BUSINESS_PARTNERS_READ_URL, BUSINESS_PARTNERS_WRITE_URL] },
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
    const isWrite = row.subprocess.subprocess_url === BUSINESS_PARTNERS_WRITE_URL;

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
  // TESTING: mientras no se siembre el subproceso WRITE_URL en BD, se habilita
  // la edicion a quien tenga lectura (canWrite = canRead). El update route ya
  // valida sesion + canRead. Cuando exista granularidad de escritura, quitar
  // esta linea para que canWrite dependa solo de WRITE_URL.
  for (const entry of byCompany.values()) {
    if (entry.canWrite) entry.canRead = true;
    else if (entry.canRead) entry.canWrite = true;
  }

  return [...byCompany.values()];
}

/** Una empresa esta "lista" si tiene endpoint activo con credenciales. */
export function isCompanyReady(access: BusinessPartnersCompanyAccess): boolean {
  return Boolean(access.endpoint && access.endpoint.baseUrl && access.endpoint.companyDB);
}

/**
 * Devuelve el acceso (con endpoint y credenciales, SOLO servidor) de UNA empresa
 * para un usuario, validando el nivel requerido y que la empresa este lista.
 * null si no tiene permiso, la empresa no aplica, o no esta configurada.
 *
 * `level` por defecto = 'read'. Para 'write' exige canWrite.
 */
export async function getCompanyEndpointForUser(
  userEmail: string,
  companyId: number,
  level: 'read' | 'write' = 'read'
): Promise<BusinessPartnersCompanyAccess | null> {
  const access = await getBusinessPartnersAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (level === 'write' && !company.canWrite) return null;
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
    canWrite: a.canWrite,
    ready: isCompanyReady(a),
  }));
}
