import type { DashboardTask } from './types';
import { resolveSolicitudId } from './viewTasksQuery';

/** Estados mostrados en gráficas de actividades. */
export type ActivityChartStatus = 'Completada' | 'Pendiente' | 'En Proceso';

/**
 * Filas de actividades desde vw_tareas_solicitudes (misma base que main).
 * Cada fila de la vista = una tarea con su solicitud asociada.
 */
export function allActivityRowsFromTasks(tasks: DashboardTask[]): DashboardTask[] {
  return tasks;
}

/** @deprecated Alias de allActivityRowsFromTasks. */
export function uniqueActivityRowsFromTasks(tasks: DashboardTask[]): DashboardTask[] {
  return allActivityRowsFromTasks(tasks);
}

export interface ActivityStats {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  abierto: number;
  other: number;
  active: number;
  solicitudesConTareas: number;
}

/** Conteos por estado_tarea tal como vienen de vw_tareas_solicitudes. */
export function computeActivityStats(tasks: DashboardTask[]): ActivityStats {
  const rows = allActivityRowsFromTasks(tasks);

  let completed = 0;
  let pending = 0;
  let inProgress = 0;
  let other = 0;

  for (const row of rows) {
    const status = row.estado_tarea;
    if (status === 'Completada') completed += 1;
    else if (status === 'Pendiente') pending += 1;
    else if (status === 'En Proceso') inProgress += 1;
    else other += 1;
  }

  const solicitudesConTareas = new Set(
    rows.map((r) => resolveSolicitudId(r)).filter((id) => id != null)
  ).size;

  return {
    total: rows.length,
    completed,
    pending,
    inProgress,
    abierto: 0,
    other,
    active: rows.filter((r) => r.activo_tarea).length,
    solicitudesConTareas,
  };
}

export function sumCostBySolicitud(tasks: DashboardTask[]): Map<number, number> {
  const costs = new Map<number, number>();
  for (const t of tasks) {
    const id = resolveSolicitudId(t);
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
