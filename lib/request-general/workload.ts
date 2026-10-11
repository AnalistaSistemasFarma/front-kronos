/**
 * Distribución de carga de tareas (módulo Solicitudes y Tareas Asignadas).
 *
 * Definiciones (conservadoras, documentadas en el PR):
 * - Responsable DE LA SOLICITUD (decisión de Nicolás Rivera, SynerLink c47 msg 16540:
 *   «solo los responsables de la solicitud pueden reasignar tareas a otros colaboradores»):
 *   requests_general.id_assigned cuando está diligenciado; si está vacío (hoy en el 100 %
 *   de las solicitudes de KRONOSDB_PRUEBAS), el usuario de user_process_category_request_general
 *   del proceso propio de esa solicitud (process_category_request_general), que es el
 *   «Asignado» que muestra la solicitud y quien la recibe en «Solicitudes asignadas».
 *   No es el creador (id_requester) ni el responsable de procesos en abstracto: el
 *   permiso se ancla a cada solicitud (task_request_general.id_request_general).
 * - Distribuidor: responsable de al menos una solicitud con tareas abiertas no de
 *   autorización, y que pertenece a un departamento (department_user).
 * - Delegados: usuarios ACTIVOS que comparten algún departamento con el responsable
 *   (incluido él mismo).
 * - Tarea abierta: task_request_general cuyo estado no es Resuelto (2), Cancelado (3)
 *   ni En Borrador (6), en cualquier proceso.
 * - % de carga: tareas abiertas de la persona / total de tareas abiertas del grupo.
 * - Reasignable: tarea abierta de un delegado, de una solicitud de la que el actor es
 *   responsable; el destino debe ser otro delegado activo.
 * - Autorizaciones (Nicolás Rivera, msg 16541): también se reasignan con la misma regla.
 *   El aprobador ES task_request_general.id_assigned (bandeja «Autorizar» filtra por él),
 *   así que reasignar mueve la aprobación al nuevo colaborador, que recibe la notificación
 *   normal de actividad asignada; estado, secuencia y cadena no cambian. Salvaguardas:
 *   · nunca al solicitante de la solicitud (autoaprobación) → SELF_APPROVAL_REQUESTER;
 *   · nunca al propio actor (el responsable no se autoasigna la aprobación) → SELF_APPROVAL_ACTOR;
 *   · las de FIRMA/Orion siguen fuera: el firmante va ligado a su correo/certificado y a
 *     marcadores [orionAuth]/[orionFile:] (misma detección que update-activities) → SIGNATURE_AUTHORIZATION.
 */

export const CLOSED_TASK_STATUS_IDS = [2, 3, 6] as const;

/**
 * Condición SQL «@param es responsable de la solicitud <alias>» (misma regla que
 * isRequestResponsible). Solo interpola el alias y el nombre del parámetro, nunca datos.
 */
export function requestResponsibleSql(rgAlias: string, userParam: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(rgAlias) || !/^@[a-z_][a-z0-9_]*$/i.test(userParam))
    throw new Error('alias o parámetro inválido');
  return `(NULLIF(LTRIM(RTRIM(${rgAlias}.id_assigned)), '') = ${userParam}
    OR (NULLIF(LTRIM(RTRIM(${rgAlias}.id_assigned)), '') IS NULL AND EXISTS (
      SELECT 1 FROM process_category_request_general pcrg_r
      INNER JOIN user_process_category_request_general upc_r ON upc_r.id_process_category = pcrg_r.id_process_category
      WHERE pcrg_r.id_request_general = ${rgAlias}.id AND upc_r.id_user = ${userParam})))`;
}
export const MAX_REASSIGN_BATCH = 200;

export interface WorkloadMember {
  id: string;
  name: string;
  email?: string | null;
}

export interface WorkloadTask {
  id: number;
  id_assigned: string | null;
  id_status: number;
  status_task?: string;
  id_process_category: number | null;
  id_request_general?: number | null;
  process?: string | null;
  is_authorization?: boolean | number | null;
  id_requester?: string | null;
  type_authorization?: string | null;
  task?: string | null;
  resolution?: string | null;
}

export function isAuthorizationTask(t: Pick<WorkloadTask, 'is_authorization'>): boolean {
  return t.is_authorization === true || Number(t.is_authorization) === 1;
}

/** Autorización de firma (Orion/firma digital): alineado con update-activities/route.js. */
export function isSignatureAuthorization(t: WorkloadTask): boolean {
  if (!isAuthorizationTask(t)) return false;
  const res = String(t.resolution ?? '');
  return (
    res.includes('[orionAuth]') ||
    res.includes('[orionFile:') ||
    String(t.type_authorization ?? '').toLowerCase().includes('firma') ||
    /\bautorizar firma\b/i.test(String(t.task ?? '')) ||
    /\bfirma digital\b/i.test(String(t.task ?? ''))
  );
}

export interface MemberLoad extends WorkloadMember {
  openTasks: number;
  percent: number;
}

export function isOpenTaskStatus(idStatus: number): boolean {
  return !(CLOSED_TASK_STATUS_IDS as readonly number[]).includes(Number(idStatus));
}

/** Redondea a un decimal; la suma puede diferir de 100 por redondeo. */
export function computeWorkload(members: WorkloadMember[], tasks: WorkloadTask[]): {
  total: number;
  members: MemberLoad[];
} {
  const ids = new Set(members.map((m) => m.id));
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (!t.id_assigned || !ids.has(t.id_assigned) || !isOpenTaskStatus(t.id_status)) continue;
    counts.set(t.id_assigned, (counts.get(t.id_assigned) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const loads = members.map((m) => {
    const openTasks = counts.get(m.id) ?? 0;
    const percent = total > 0 ? Math.round((openTasks / total) * 1000) / 10 : 0;
    return { ...m, openTasks, percent };
  });
  loads.sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name, 'es'));
  return { total, members: loads };
}

export interface ReassignScope {
  actorId: string;
  /** Solicitudes de las que el actor es responsable (ver definición arriba). */
  ownedRequestIds: number[];
  delegateIds: string[];
}

export type ReassignRejection =
  | 'NOT_FOUND'
  | 'CLOSED'
  | 'REQUEST_NOT_OWNED'
  | 'SIGNATURE_AUTHORIZATION'
  | 'SELF_APPROVAL_REQUESTER'
  | 'SELF_APPROVAL_ACTOR'
  | 'ASSIGNEE_OUTSIDE_AREA'
  | 'SAME_ASSIGNEE';

export function isResponsible(scope: Pick<ReassignScope, 'ownedRequestIds' | 'delegateIds'>) {
  return scope.ownedRequestIds.length > 0 && scope.delegateIds.length > 0;
}

/** ¿El usuario es responsable de la solicitud? (id_assigned explícito o, si falta, responsable de su proceso). */
export function isRequestResponsible(
  userId: string,
  req: { id_assigned?: string | null; processResponsibleIds?: (string | null)[] | null }
): boolean {
  const uid = String(userId ?? '').trim();
  if (!uid) return false;
  const explicit = String(req.id_assigned ?? '').trim();
  if (explicit) return explicit === uid;
  return (req.processResponsibleIds ?? []).some((x) => String(x ?? '').trim() === uid);
}

/** Motivo por el que una tarea no se puede reasignar a toUserId, o null si se puede. */
export function taskRejection(
  scope: ReassignScope,
  task: WorkloadTask | undefined,
  toUserId: string
): ReassignRejection | null {
  if (!task) return 'NOT_FOUND';
  if (!isOpenTaskStatus(task.id_status)) return 'CLOSED';
  if (task.id_request_general == null || !scope.ownedRequestIds.includes(Number(task.id_request_general)))
    return 'REQUEST_NOT_OWNED';
  if (isSignatureAuthorization(task)) return 'SIGNATURE_AUTHORIZATION';
  if (!task.id_assigned || !scope.delegateIds.includes(task.id_assigned)) return 'ASSIGNEE_OUTSIDE_AREA';
  if (task.id_assigned === toUserId) return 'SAME_ASSIGNEE';
  if (isAuthorizationTask(task)) {
    if (task.id_requester && String(task.id_requester).trim() === toUserId) return 'SELF_APPROVAL_REQUESTER';
    if (toUserId === scope.actorId) return 'SELF_APPROVAL_ACTOR';
  }
  return null;
}

export function isTaskReassignable(scope: ReassignScope, task: WorkloadTask): boolean {
  const r = taskRejection(scope, task, '\u0000');
  return r === null;
}

export const REJECTION_LABEL: Record<ReassignRejection, string> = {
  NOT_FOUND: 'no existe',
  CLOSED: 'ya está cerrada',
  REQUEST_NOT_OWNED: 'es de una solicitud de la que no eres responsable',
  SIGNATURE_AUTHORIZATION: 'es una autorización de firma (va ligada al firmante)',
  SELF_APPROVAL_REQUESTER: 'es una autorización y el destino es el solicitante (autoaprobación)',
  SELF_APPROVAL_ACTOR: 'es una autorización y no puedes asignártela a ti mismo',
  ASSIGNEE_OUTSIDE_AREA: 'su responsable actual no es de tu área',
  SAME_ASSIGNEE: 'ya está asignada a esa persona',
};

export type ReassignValidation =
  | { ok: true; taskIds: number[] }
  | { ok: false; status: number; error: string; rejected?: { id: number; reason: ReassignRejection }[] };

export function validateReassignRequest(
  scope: ReassignScope,
  input: { taskIds: unknown; toUserId: unknown },
  tasksById: Map<number, WorkloadTask>,
  activeDelegateIds: string[]
): ReassignValidation {
  if (!isResponsible(scope))
    return { ok: false, status: 403, error: 'Solo el responsable de la solicitud puede reasignar sus tareas' };
  const toUserId = typeof input.toUserId === 'string' ? input.toUserId.trim() : '';
  if (!toUserId) return { ok: false, status: 400, error: 'Selecciona el nuevo responsable' };
  if (!Array.isArray(input.taskIds) || input.taskIds.length === 0)
    return { ok: false, status: 400, error: 'Selecciona al menos una tarea' };
  const taskIds = [...new Set(input.taskIds.map((n) => Number(n)))];
  if (taskIds.some((n) => !Number.isInteger(n) || n <= 0))
    return { ok: false, status: 400, error: 'Identificadores de tarea inválidos' };
  if (taskIds.length > MAX_REASSIGN_BATCH)
    return { ok: false, status: 400, error: `Máximo ${MAX_REASSIGN_BATCH} tareas por reasignación` };
  if (!scope.delegateIds.includes(toUserId) || !activeDelegateIds.includes(toUserId))
    return { ok: false, status: 422, error: 'El nuevo responsable debe ser un usuario activo de tu área' };
  const rejected = taskIds
    .map((id) => ({ id, reason: taskRejection(scope, tasksById.get(id), toUserId) }))
    .filter((r): r is { id: number; reason: ReassignRejection } => r.reason !== null);
  if (rejected.length > 0)
    return { ok: false, status: 409, error: 'Algunas tareas no se pueden reasignar; no se cambió ninguna', rejected };
  return { ok: true, taskIds };
}

export function buildReassignNote(p: {
  taskName: string;
  taskId: number;
  fromName: string;
  toName: string;
  actorName: string;
  reason?: string | null;
}): string {
  const motivo = p.reason?.trim() ? ` Motivo: ${p.reason.trim().slice(0, 500)}` : '';
  return `Reasignación por distribución de carga: la tarea «${p.taskName}» (#${p.taskId}) pasó de ${p.fromName} a ${p.toName}. Realizada por ${p.actorName}.${motivo}`;
}
