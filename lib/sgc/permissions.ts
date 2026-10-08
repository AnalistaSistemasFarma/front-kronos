import { sgcPermissionFromUrl, type SgcPermission } from './constants';

/**
 * Reglas de acceso del SGC documental — funciones PURAS (probadas con Vitest).
 *
 * El acceso se decide con dos llaves, ambas obligatorias (fail-closed):
 *   1. Permiso por subproceso (`subprocess_user_company`), por empresa.
 *   2. Empresa ACTIVA en el SGC (`sgc.company_config.is_active = 1`).
 * Una concesión en una empresa no activada no abre nada: así nadie puede
 * habilitar por accidente a otra empresa antes de que su Calidad esté lista.
 */

/** Una fila de permiso: la URL del subproceso otorgado y su empresa. */
export interface SgcGrantRow {
  subprocessUrl: string | null | undefined;
  idCompany: number;
  companyName: string;
}

/** Acceso efectivo de un usuario en UNA empresa del SGC. */
export interface SgcCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canManage: boolean;
  canQuality: boolean;
  canAdminFlows: boolean;
}

const FLAG_BY_PERMISSION: Record<SgcPermission, keyof Omit<SgcCompanyAccess, 'idCompany' | 'companyName'>> = {
  lectura: 'canRead',
  gestion: 'canManage',
  calidad: 'canQuality',
  flujos: 'canAdminFlows',
};

/**
 * Resuelve el acceso por empresa a partir de las filas de permiso y del
 * conjunto de empresas activas. Ignora URLs ajenas al módulo y empresas no
 * activadas. Cualquier permiso marcador implica lectura.
 */
export function resolveSgcAccess(
  rows: readonly SgcGrantRow[],
  activeCompanyIds: Iterable<number>
): SgcCompanyAccess[] {
  const active = new Set(activeCompanyIds);
  const byCompany = new Map<number, SgcCompanyAccess>();

  for (const row of rows) {
    if (!active.has(row.idCompany)) continue;
    const perm = sgcPermissionFromUrl(row.subprocessUrl);
    if (!perm) continue;

    let entry = byCompany.get(row.idCompany);
    if (!entry) {
      entry = {
        idCompany: row.idCompany,
        companyName: row.companyName,
        canRead: false,
        canManage: false,
        canQuality: false,
        canAdminFlows: false,
      };
      byCompany.set(row.idCompany, entry);
    }
    entry[FLAG_BY_PERMISSION[perm]] = true;
  }

  for (const entry of byCompany.values()) {
    if (entry.canManage || entry.canQuality || entry.canAdminFlows) entry.canRead = true;
  }

  return [...byCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'es'));
}

/** true si el usuario tiene el permiso pedido en la empresa indicada. */
export function hasSgcPermission(
  access: readonly SgcCompanyAccess[],
  idCompany: number,
  permission: SgcPermission
): boolean {
  const entry = access.find((a) => a.idCompany === idCompany);
  if (!entry) return false;
  return entry[FLAG_BY_PERMISSION[permission]];
}
