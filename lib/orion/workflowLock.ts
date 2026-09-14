import { isOrionWorkflowResolution } from './signerAuthMarkers';

/**
 * Bloquea edición de firmantes cuando la tarea o la solicitud ya están cerradas.
 * Las tareas Orion llevan texto en `resolution` ([orionFile]/[orionAuth]) desde que se crean;
 * eso NO significa que estén cerradas.
 */
export function isSynerlinkWorkflowLocked(params: {
  taskStatusId?: number | null;
  taskStatusLabel?: string | null;
  taskResolution?: string | null;
  requestStatusReq?: number | null;
}): boolean {
  const label = String(params.taskStatusLabel ?? '').toLowerCase();
  const resolution = String(params.taskResolution ?? '').trim();
  const orionMarkerOnly = isOrionWorkflowResolution(resolution);

  const taskClosedByStatus =
    params.taskStatusId === 2 ||
    params.taskStatusId === 3 ||
    label.includes('completad') ||
    label.includes('resuelt') ||
    label.includes('cancel');

  // Solo contar resolución como cierre si NO es marcador Orion de firma/auth abierta
  const taskClosedByResolution =
    Boolean(resolution) && !orionMarkerOnly && (taskClosedByStatus || params.taskStatusId == null);

  const taskClosed = taskClosedByStatus || taskClosedByResolution;

  const requestClosed =
    params.requestStatusReq === 2 || params.requestStatusReq === 3;

  return taskClosed || requestClosed;
}
