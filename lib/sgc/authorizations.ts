/**
 * Autorizaciones SGC — reglas PURAS.
 *
 * COPIA CONGELADA (2026-09-30) del mecanismo de autorizaciones de SynerLink
 * general (app/api/authorization/authorization-activities: una autorización
 * llega a quien está asignado directamente o al GRUPO del tipo de
 * autorización), reescrita para el SGC con tablas propias
 * (sgc.authorization_type, sgc.authorization_type_user, sgc.authorization).
 * No usa el tipo «Autorización de documento» (id 8) de SynerLink general.
 */

export type SgcAuthorizationStatus = 'pendiente' | 'autorizada' | 'rechazada' | 'anulada';

export const SGC_AUTHORIZATION_STATUS_LABELS: Record<SgcAuthorizationStatus, string> = {
  pendiente: 'Pendiente',
  autorizada: 'Autorizada',
  rechazada: 'Rechazada',
  anulada: 'Anulada',
};

/** Colores copiados de la bandeja de Autorizaciones de SynerLink. */
export function sgcAuthorizationColor(status: string): string {
  switch (status) {
    case 'pendiente':
      return 'yellow';
    case 'autorizada':
      return 'green';
    case 'rechazada':
      return 'red';
    default:
      return 'gray';
  }
}

export interface SgcAuthorizationRouting {
  assignedEmail: string | null;
  typeCode: string;
  status: SgcAuthorizationStatus;
}

/**
 * ¿La autorización llega a la bandeja de esta persona? Si está asignada
 * directamente, solo a esa persona; si es de grupo (sin asignado), a quien
 * pertenezca al grupo del tipo (con el grupo vigente, no revocado).
 */
export function authorizationReaches(auth: SgcAuthorizationRouting, email: string, poolTypeCodes: readonly string[]): boolean {
  const me = email.trim().toLowerCase();
  if (auth.assignedEmail) return auth.assignedEmail.toLowerCase() === me;
  return poolTypeCodes.includes(auth.typeCode);
}

/** Estado de la autorización según la decisión del firmante. */
export function authorizationStatusFor(decision: 'aprobar' | 'devolver'): SgcAuthorizationStatus {
  return decision === 'aprobar' ? 'autorizada' : 'rechazada';
}

const CODE_RE = /^[A-Z][A-Z0-9_-]{1,39}$/;

export function getAuthorizationTypeCodeError(code: string): string | null {
  if (!CODE_RE.test(code)) return 'use mayúsculas, números, guion o guion bajo (2 a 40, empezando por letra)';
  return null;
}
