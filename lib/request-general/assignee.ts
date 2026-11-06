/**
 * Responsable (asignado) de una solicitud general, venga de donde venga el dato.
 *
 * Las listas (Mis solicitudes, Asignadas…) guardan la fila en sessionStorage con
 * `id_assigned_process_category` / `id_assigned_category`; la API del detalle
 * (`/api/requests-general/view-request`) lo devuelve como `id_assigned_process_category`
 * (desde 2026-11-04) y, en versiones anteriores, solo como `IDassignedUserID`.
 * Al entrar por el enlace del correo no hay fila de la lista: sin este respaldo, el
 * solicitante que es el asignado veía «Cerrar Solicitud» deshabilitado (#838).
 */
export interface AssigneeSource {
  id_requester?: number | string | null;
  id_assigned_process_category?: number | string | null;
  id_assigned_category?: number | string | null;
  IDassignedUserID?: number | string | null;
}

const clean = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Id del asignado de la solicitud ('' si no se conoce). */
export function requestAssigneeId(r: AssigneeSource | null | undefined): string {
  if (!r) return '';
  return clean(r.id_assigned_process_category) || clean(r.id_assigned_category) || clean(r.IDassignedUserID);
}

/** ¿El solicitante es también el asignado? (regla del #838: solo así puede cerrar). */
export function isRequesterSelfAssigned(r: AssigneeSource | null | undefined): boolean {
  const requester = clean(r?.id_requester);
  const assignee = requestAssigneeId(r);
  return requester !== '' && assignee !== '' && requester === assignee;
}

/** ¿El usuario de la sesión es el asignado? */
export function isAssignedTo(r: AssigneeSource | null | undefined, userId: unknown): boolean {
  const assignee = requestAssigneeId(r);
  return assignee !== '' && assignee === clean(userId);
}
