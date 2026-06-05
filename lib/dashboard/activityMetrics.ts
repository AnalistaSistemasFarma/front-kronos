import type { DashboardTask } from './types';

/** Estados mostrados en gráficas de actividades (estado real de la tarea). */
export type ActivityChartStatus = 'Completada' | 'Pendiente' | 'En Proceso';

/** Filas con tarea real asignada (excluye solicitudes sin tareas en el periodo). */
export function getTaskRows(tasks: DashboardTask[]): DashboardTask[] {
  return tasks.filter((t) => t.id_tarea != null && Number(t.id_tarea) > 0);
}

/**
 * Todas las filas de actividades del dashboard (una por tarea en task_request_general).
 * Incluye repetidas si la solicitud tiene varias tareas o varias áreas.
 */
export function allActivityRowsFromTasks(tasks: DashboardTask[]): DashboardTask[] {
  return getTaskRows(tasks);
}

/** @deprecated Usar allActivityRowsFromTasks — mantiene compatibilidad con exportaciones. */
export function uniqueActivityRowsFromTasks(tasks: DashboardTask[]): DashboardTask[] {
  return allActivityRowsFromTasks(tasks);
}

export interface ActivityStats {
  /** Total de tareas asignadas en el periodo */
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  abierto: number;
  other: number;
  active: number;
  /** Solicitudes distintas con al menos una tarea */
  solicitudesConTareas: number;
}

/** Conteos por estado de tarea (cada fila = una actividad asignada). */
export function computeActivityStats(tasks: DashboardTask[]): ActivityStats {
  const rows = getTaskRows(tasks);

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

  const solicitudesConTareas = new Set(rows.map((r) => r.id_solicitud)).size;

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
  for (const t of getTaskRows(tasks)) {
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
