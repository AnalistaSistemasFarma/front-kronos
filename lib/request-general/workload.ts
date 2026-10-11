/**
 * Distribución de carga de tareas (módulo Solicitudes y Tareas Asignadas).
 *
 * Definiciones (conservadoras, documentadas en el PR):
 * - Responsable: usuario asignado como responsable de al menos un proceso en
 *   user_process_category_request_general (es quien recibe las solicitudes de ese
 *   proceso en «Solicitudes asignadas") Y que pertenece a un departamento
 *   (department_user).
 * - Delegados: usuarios ACTIVOS que comparten algún departamento con el responsable
 *   (incluido él mismo).
 * - Tarea abierta: task_request_general cuyo estado no es Resuelto (2), Cancelado (3)
 *   ni En Borrador (6), en cualquier proceso.
 * - % de carga: tareas abiertas de la persona / total de tareas abiertas del grupo.
 * - Reasignable: tarea abierta de un delegado, en un proceso del que el actor es
 *   responsable y que no es de autorización; el destino debe ser otro delegado activo.
 */

export const CLOSED_TASK_STATUS_IDS = [2, 3, 6] as const;
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
  process?: string | null;
  is_authorization?: boolean | number | null;
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
  responsibleProcessIds: number[];
  delegateIds: string[];
}

export type ReassignRejection =
  | 'NOT_FOUND'
  | 'CLOSED'
  | 'PROCESS_NOT_OWNED'
  | 'AUTHORIZATION_TASK'
  | 'ASSIGNEE_OUTSIDE_AREA'
  | 'SAME_ASSIGNEE';

export function isResponsible(scope: Pick<ReassignScope, 'responsibleProcessIds' | 'delegateIds'>) {
  return scope.responsibleProcessIds.length > 0 && scope.delegateIds.length > 0;
}

/** Motivo por el que una tarea no se puede reasignar a toUserId, o null si se puede. */
export function taskRejection(
  scope: ReassignScope,
  task: WorkloadTask | undefined,
  toUserId: string
): ReassignRejection | null {
  if (!task) return 'NOT_FOUND';
  if (!isOpenTaskStatus(task.id_status)) return 'CLOSED';
  if (task.id_process_category == null || !scope.responsibleProcessIds.includes(task.id_process_category))
    return 'PROCESS_NOT_OWNED';
  if (task.is_authorization === true || task.is_authorization === 1) return 'AUTHORIZATION_TASK';
  if (!task.id_assigned || !scope.delegateIds.includes(task.id_assigned)) return 'ASSIGNEE_OUTSIDE_AREA';
  if (task.id_assigned === toUserId) return 'SAME_ASSIGNEE';
  return null;
}

export function isTaskReassignable(scope: ReassignScope, task: WorkloadTask): boolean {
  const r = taskRejection(scope, task, '\u0000');
  return r === null;
}

export const REJECTION_LABEL: Record<ReassignRejection, string> = {
  NOT_FOUND: 'no existe',
  CLOSED: 'ya está cerrada',
  PROCESS_NOT_OWNED: 'es de un proceso del que no eres responsable',
  AUTHORIZATION_TASK: 'es una tarea de autorización',
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
    return { ok: false, status: 403, error: 'Solo el responsable de procesos del área puede distribuir la carga' };
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
