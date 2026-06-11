import type { DashboardRequest, DashboardTask } from './types';
import { resolveSolicitudId } from './viewTasksQuery';

function normalizeEncargadoName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/**
 * vw_tareas_solicitudes no expone encargado de área; el líder viene de
 * vw_requests_general.UsuarioAsignado (encargado_proceso en solicitudes).
 */
export function enrichTasksWithEncargadoFromRequests(
  tasks: DashboardTask[],
  requests: DashboardRequest[]
): DashboardTask[] {
  const leaderBySolicitud = new Map<number, string>();

  for (const req of requests) {
    const leader = normalizeEncargadoName(req.encargado_proceso);
    if (req.id_solicitud != null && leader) {
      leaderBySolicitud.set(req.id_solicitud, leader);
    }
  }

  return tasks.map((task) => {
    const existing = normalizeEncargadoName(task.encargado_proceso);
    const solicitudId = resolveSolicitudId(task);
    const fromRequest =
      solicitudId != null ? leaderBySolicitud.get(solicitudId) ?? null : null;

    return {
      ...task,
      encargado_proceso: existing ?? fromRequest,
    };
  });
}
