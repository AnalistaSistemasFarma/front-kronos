import { countRequestsByDashboardStatus, normalizeRequestStatus } from './requestStatus';
import type { DashboardTask } from './types';

/** Estados mostrados en gráficas de actividades (derivados del estado de la solicitud). */
export type ActivityChartStatus = 'Completada' | 'Pendiente' | 'En Proceso';

export function mapSolicitudStatusToChartStatus(
  estadoSolicitud: string | null | undefined
): ActivityChartStatus {
  const bucket = normalizeRequestStatus(estadoSolicitud);
  if (bucket === 'Cerrada') return 'Completada';
  if (bucket === 'Pendiente') return 'Pendiente';
  return 'En Proceso';
}

/**
 * Una fila por solicitud (= una actividad en el dashboard).
 * Misma base que Solicitudes; evita contar varias tareas de un mismo pedido.
 */
export function uniqueActivityRowsFromTasks(tasks: DashboardTask[]): DashboardTask[] {
  const map = new Map<number, DashboardTask>();
  for (const task of tasks) {
    const id = task.id_solicitud;
    if (id == null || Number.isNaN(Number(id))) continue;
    if (map.has(id)) continue;
    map.set(id, {
      ...task,
      estado_tarea: mapSolicitudStatusToChartStatus(task.estado_solicitud),
    });
  }
  return [...map.values()];
}

export interface ActivityStats {
  /** Actividades (= solicitudes únicas en el periodo) */
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  abierto: number;
  other: number;
  active: number;
}

/** Mismos conteos que la pestaña Solicitudes (estado de la solicitud). */
export function computeActivityStats(tasks: DashboardTask[]): ActivityStats {
  const rows = uniqueActivityRowsFromTasks(tasks);
  const status = countRequestsByDashboardStatus(rows);

  const other = Math.max(
    0,
    status.total - status.cerrada - status.pendiente - status.abierto - status.enProceso
  );

  return {
    total: status.total,
    completed: status.cerrada,
    pending: status.pendiente,
    inProgress: status.enProceso,
    abierto: status.abierto,
    other,
    active: rows.filter((r) => r.activo_tarea).length,
  };
}

/** Costo total por solicitud (suma tareas hijas, una actividad por solicitud). */
export function sumCostBySolicitud(tasks: DashboardTask[]): Map<number, number> {
  const costs = new Map<number, number>();
  for (const t of tasks) {
    const id = t.id_solicitud;
    if (id == null) continue;
    const c = Number(t.costo_tarea) || 0;
    if (c <= 0) continue;
    costs.set(id, (costs.get(id) ?? 0) + c);
  }
  return costs;
}

export function applyCostsToActivityRows(
  rows: DashboardTask[],
  costBySolicitud: Map<number, number>
): DashboardTask[] {
  return rows.map((r) => ({
    ...r,
    costo_tarea: costBySolicitud.get(r.id_solicitud) ?? r.costo_tarea,
  }));
}
