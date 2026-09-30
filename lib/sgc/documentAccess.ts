import type { SgcConfidentiality, SgcDocumentStatus } from './constants';
import type { SgcCompanyAccess } from './permissions';

/**
 * Permisos sobre UN documento del SGC — funciones PURAS (probadas con Vitest).
 *
 * Se evalúan DESPUÉS de las dos llaves del módulo (permiso por subproceso y
 * empresa activa, ver permissions.ts): sin acceso a la empresa no hay nada.
 *
 * Consulta:
 *   - Aseguramiento de Calidad ve todos los documentos de la empresa, en
 *     cualquier estado (es la dueña del módulo).
 *   - Los demás solo ven documentos VIGENTES (el listado maestro), y además:
 *       publica      → cualquiera con consulta en la empresa
 *       departamento → su departamento es el dueño, o tiene un acceso vigente
 *                      (por departamento o a su nombre)
 *       confidencial → solo con un acceso vigente expreso (por departamento o
 *                      a su nombre); ser del departamento dueño NO basta
 * Descarga e impresión: NUNCA por defecto (ni para Calidad). Solo con un
 * acceso excepcional vigente que las incluya, y solo sobre lo que se puede
 * consultar.
 */

export interface SgcAccessSubject {
  email: string;
  departmentIds: readonly number[];
}

export interface SgcDocumentForAccess {
  idCompany: number;
  status: SgcDocumentStatus | string;
  confidentiality: SgcConfidentiality | string;
  idOwnerDepartment: number | null;
}

export interface SgcAccessGrant {
  idDepartment: number | null;
  userEmail: string | null;
  canView: boolean;
  canDownload: boolean;
  canPrint: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface SgcDocumentPermissions {
  canView: boolean;
  canDownload: boolean;
  canPrint: boolean;
  /** Puede administrar el documento (metadatos, accesos, anulación). */
  canAdminister: boolean;
}

const NONE: SgcDocumentPermissions = { canView: false, canDownload: false, canPrint: false, canAdminister: false };

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** true si el acceso está vigente (no revocado ni vencido) y aplica a la persona. */
export function grantApplies(grant: SgcAccessGrant, subject: SgcAccessSubject, now: Date): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) return false;
  if (grant.userEmail) return sameEmail(grant.userEmail, subject.email);
  return grant.idDepartment !== null && subject.departmentIds.includes(grant.idDepartment);
}

/** Permisos efectivos de la persona sobre el documento. */
export function resolveDocumentPermissions(
  companyAccess: SgcCompanyAccess | null | undefined,
  subject: SgcAccessSubject,
  doc: SgcDocumentForAccess,
  grants: readonly SgcAccessGrant[],
  now: Date = new Date()
): SgcDocumentPermissions {
  if (!companyAccess || companyAccess.idCompany !== doc.idCompany || !companyAccess.canRead) return NONE;

  const applicable = grants.filter((g) => grantApplies(g, subject, now));
  const quality = companyAccess.canQuality;

  let canView: boolean;
  if (quality) {
    canView = true;
  } else if (doc.status !== 'vigente') {
    canView = false;
  } else if (doc.confidentiality === 'publica') {
    canView = true;
  } else if (doc.confidentiality === 'departamento') {
    const owner = doc.idOwnerDepartment !== null && subject.departmentIds.includes(doc.idOwnerDepartment);
    canView = owner || applicable.some((g) => g.canView);
  } else if (doc.confidentiality === 'confidencial') {
    canView = applicable.some((g) => g.canView);
  } else {
    // Confidencialidad desconocida: se cierra (fail-closed).
    canView = false;
  }

  if (!canView) return NONE;

  return {
    canView: true,
    canDownload: applicable.some((g) => g.canDownload),
    canPrint: applicable.some((g) => g.canPrint),
    canAdminister: quality,
  };
}

/** Motivo por el que un acceso excepcional es inválido, o null si se puede registrar. */
export function getGrantInputError(input: {
  idDepartment: number | null;
  userEmail: string | null;
  canView: boolean;
  canDownload: boolean;
  canPrint: boolean;
  expiresAt: Date | null;
  reason: string;
}, now: Date = new Date()): string | null {
  const hasDept = input.idDepartment !== null && Number.isInteger(input.idDepartment) && input.idDepartment > 0;
  const email = (input.userEmail ?? '').trim();
  if (hasDept === !!email) return 'Indique un departamento o una persona (solo uno).';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'El correo no es válido.';
  if (!input.canView && !input.canDownload && !input.canPrint) return 'Seleccione al menos un permiso.';
  if ((input.canDownload || input.canPrint) && !input.expiresAt) {
    return 'La descarga y la impresión son excepcionales: exigen fecha de vencimiento.';
  }
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return 'El vencimiento debe ser una fecha futura.';
  if ((input.reason ?? '').trim().length < 10) return 'Explique el motivo (mínimo 10 caracteres).';
  return null;
}
