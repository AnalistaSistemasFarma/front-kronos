import { prisma } from '../prisma';

/**
 * Resolución de permisos del módulo "Gestión Documental" (multiempresa).
 *
 * Mismo patrón que lib/health-records/access.ts: se reusa el esquema
 * existente (process -> subprocess -> subprocess_user_company) en vez de
 * crear una tabla de roles documentales nueva (autor/revisor/aprobador —
 * eso queda para el flujo de aprobación de Fase 2, atado al PROCESO de cada
 * documento, no a un rol genérico de este módulo).
 *
 *   - Nivel 1 (módulo):  el usuario tiene al menos una fila para alguno de
 *                        los dos subprocesos -> ve el módulo.
 *   - Nivel 2 (empresa): cada fila está atada a un company_user, así que
 *                        define EN QUÉ EMPRESA tiene acceso.
 *
 * La separación lectura/escritura usa DOS subprocesos distintos bajo el
 * mismo proceso (igual que Registros Sanitarios):
 *   - READ_URL  -> consultar el listado de documentos vigentes
 *   - WRITE_URL -> crear tipos de documento / cargar documentos nuevos
 * Un usuario puede tener lectura en una empresa y escritura en otra.
 */

export const DOCUMENT_MANAGEMENT_READ_URL = '/process/document-management';
export const DOCUMENT_MANAGEMENT_WRITE_URL = '/process/document-management/manage';

/** Acceso de un usuario a una empresa dentro del módulo. */
export interface DocumentManagementCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el módulo de
 * gestión documental, con su nivel (lectura/escritura).
 */
export async function getDocumentManagementAccess(
  userEmail: string
): Promise<DocumentManagementCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: {
        subprocess_url: {
          in: [DOCUMENT_MANAGEMENT_READ_URL, DOCUMENT_MANAGEMENT_WRITE_URL],
        },
      },
    },
    include: {
      subprocess: true,
      companyUser: {
        include: { company: true },
      },
    },
  });

  const byCompany = new Map<number, DocumentManagementCompanyAccess>();

  for (const row of rows) {
    const company = row.companyUser.company;
    const id = company.id_company;
    const isWrite = row.subprocess.subprocess_url === DOCUMENT_MANAGEMENT_WRITE_URL;

    let entry = byCompany.get(id);
    if (!entry) {
      entry = {
        idCompany: id,
        companyName: company.company,
        canRead: false,
        canWrite: false,
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

/**
 * Devuelve el acceso de UNA empresa para un usuario, validando el nivel
 * requerido. null si no tiene permiso o la empresa no aplica. Uso en las
 * rutas de crear tipo de documento / crear documento.
 */
export async function getDocumentManagementCompanyAccess(
  userEmail: string,
  companyId: number,
  level: 'read' | 'write'
): Promise<DocumentManagementCompanyAccess | null> {
  const access = await getDocumentManagementAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (level === 'write' && !company.canWrite) return null;
  if (!company.canRead) return null;
  return company;
}
