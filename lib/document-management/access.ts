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
 *                        los tres subprocesos -> ve el módulo.
 *   - Nivel 2 (empresa): cada fila está atada a un company_user, así que
 *                        define EN QUÉ EMPRESA tiene acceso.
 *
 * TRES subprocesos distintos bajo el mismo proceso (igual que Registros
 * Sanitarios, que solo tiene dos):
 *   - READ_URL        -> consultar el listado de documentos vigentes
 *   - WRITE_URL        -> acciones del flujo de aprobación (revisar, aprobar,
 *                         reasignar, anular, etc. — ver workflowEngine.ts) y
 *                         administración del catálogo de tipos de documento
 *   - REGULATORY_URL   -> (Sprint 5) atajo "Cargar documento": crear un
 *                         documento NUEVO directo, sin pasar por el flujo
 *                         estándar de "crear solicitud" de SynerLink. Antes
 *                         de este sprint este atajo vivía detrás de
 *                         WRITE_URL; ahora es un permiso aparte reservado a
 *                         Asuntos Regulatorios (pedido explícito de
 *                         Nicolás) — ver prisma/seeds/
 *                         document-management-regulatory-subprocess.sql
 *                         para la migración de quién lo tenía antes.
 * Un usuario puede tener cualquier combinación de los tres, por empresa.
 */

export const DOCUMENT_MANAGEMENT_READ_URL = '/process/document-management';
export const DOCUMENT_MANAGEMENT_WRITE_URL = '/process/document-management/manage';
export const DOCUMENT_MANAGEMENT_REGULATORY_URL = '/process/document-management/manage/regulatory';

/** Acceso de un usuario a una empresa dentro del módulo. */
export interface DocumentManagementCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  /** Asuntos Regulatorios (Sprint 5): puede usar el atajo "Cargar documento". */
  canUploadDirect: boolean;
}

/**
 * Devuelve las empresas a las que el usuario tiene acceso en el módulo de
 * gestión documental, con su nivel (lectura/escritura/atajo regulatorio).
 */
export async function getDocumentManagementAccess(
  userEmail: string
): Promise<DocumentManagementCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: {
        subprocess_url: {
          in: [
            DOCUMENT_MANAGEMENT_READ_URL,
            DOCUMENT_MANAGEMENT_WRITE_URL,
            DOCUMENT_MANAGEMENT_REGULATORY_URL,
          ],
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
    const url = row.subprocess.subprocess_url;

    let entry = byCompany.get(id);
    if (!entry) {
      entry = {
        idCompany: id,
        companyName: company.company,
        canRead: false,
        canWrite: false,
        canUploadDirect: false,
      };
      byCompany.set(id, entry);
    }

    if (url === DOCUMENT_MANAGEMENT_WRITE_URL) entry.canWrite = true;
    else if (url === DOCUMENT_MANAGEMENT_REGULATORY_URL) entry.canUploadDirect = true;
    else entry.canRead = true;
  }

  // El permiso de escritura o el atajo regulatorio implican el de lectura.
  for (const entry of byCompany.values()) {
    if (entry.canWrite || entry.canUploadDirect) entry.canRead = true;
  }

  return [...byCompany.values()];
}

/**
 * Devuelve el acceso de UNA empresa para un usuario, validando el nivel
 * requerido. null si no tiene permiso o la empresa no aplica. Uso en las
 * rutas de crear tipo de documento / crear documento / atajo regulatorio.
 */
export async function getDocumentManagementCompanyAccess(
  userEmail: string,
  companyId: number,
  level: 'read' | 'write' | 'uploadDirect'
): Promise<DocumentManagementCompanyAccess | null> {
  const access = await getDocumentManagementAccess(userEmail);
  const company = access.find((a) => a.idCompany === companyId);
  if (!company) return null;
  if (level === 'write' && !company.canWrite) return null;
  if (level === 'uploadDirect' && !company.canUploadDirect) return null;
  if (!company.canRead) return null;
  return company;
}
