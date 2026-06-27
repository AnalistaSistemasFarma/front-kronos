import { prisma } from '../prisma';

/**
 * Resolucion de permisos del modulo "Registros Sanitarios" (multiempresa).
 *
 * El doble nivel de permiso que pidio el negocio se modela reutilizando el
 * esquema existente (process -> subprocess -> subprocess_user_company):
 *
 *   - Nivel 1 (modulo):  el usuario tiene al menos una fila para el subproceso
 *                        de registros sanitarios -> ve el modulo.
 *   - Nivel 2 (empresa): cada fila esta atada a un company_user, asi que define
 *                        EN QUE EMPRESA tiene acceso.
 *
 * La separacion lectura/escritura se hace con DOS subprocesos distintos bajo el
 * mismo proceso, en vez de tocar la tabla compartida subprocess_user_company:
 *   - READ_URL  -> consultar
 *   - WRITE_URL -> crear / editar / cargue masivo
 * Un usuario puede tener lectura en una empresa y escritura en otra.
 */

export const HEALTH_RECORDS_READ_URL = '/process/health-records';
export const HEALTH_RECORDS_WRITE_URL = '/process/health-records/manage';

/** Endpoint SAP de una empresa, con credenciales. SOLO uso en servidor. */
export interface CompanySapEndpoint {
  baseUrl: string;
  username: string;
  password: string;
  /** CompanyDB de SAP B1 (columna `client`). */
  companyDB: string;
  /** Nombre del UDO de registros sanitarios en esta base (varia por empresa). */
  healthRecordsEntity: string | null;
  healthRecordsLogCollection: string | null;
}

/** Acceso de un usuario a una empresa dentro del modulo. */
export interface HealthRecordsCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  /** null si la empresa no tiene endpoint SAP activo configurado. */
  endpoint: CompanySapEndpoint | null;
}

/** Vista segura para el cliente: sin credenciales. */
export interface HealthRecordsCompanyPublic {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  /** true si la empresa esta lista para consultar (endpoint activo + UDO mapeado). */
  ready: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el modulo de
 * registros sanitarios, con su nivel (lectura/escritura) y su endpoint SAP.
 *
 * INCLUYE credenciales -> NO devolver tal cual al navegador. Para el cliente,
 * usar toPublicAccess().
 */
export async function getHealthRecordsAccess(
  userEmail: string
): Promise<HealthRecordsCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: {
        subprocess_url: { in: [HEALTH_RECORDS_READ_URL, HEALTH_RECORDS_WRITE_URL] },
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

  const byCompany = new Map<number, HealthRecordsCompanyAccess>();

  for (const row of rows) {
    const company = row.companyUser.company;
    const id = company.id_company;
    const isWrite = row.subprocess.subprocess_url === HEALTH_RECORDS_WRITE_URL;

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
              healthRecordsEntity: ep.health_records_entity ?? null,
              healthRecordsLogCollection: ep.health_records_log_collection ?? null,
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

/** Una empresa esta "lista" si tiene endpoint activo y el UDO mapeado. */
export function isCompanyReady(access: HealthRecordsCompanyAccess): boolean {
  return Boolean(
    access.endpoint &&
      access.endpoint.baseUrl &&
      access.endpoint.companyDB &&
      access.endpoint.healthRecordsEntity
  );
}

/** Proyecta el acceso a la forma segura para el navegador (sin credenciales). */
export function toPublicAccess(
  access: HealthRecordsCompanyAccess[]
): HealthRecordsCompanyPublic[] {
  return access.map((a) => ({
    idCompany: a.idCompany,
    companyName: a.companyName,
    canRead: a.canRead,
    canWrite: a.canWrite,
    ready: isCompanyReady(a),
  }));
}
