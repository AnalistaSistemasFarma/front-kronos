import type { TaskForResolutionTime } from './resolutionTimeSeries';
import { getTaskResolutionHours, formatResolutionDuration } from './resolutionTimeSeries';

export interface TaskWithEncargado extends TaskForResolutionTime {
  encargado_proceso?: string | null;
  id_solicitud: number;
  asunto_solicitud: string;
  proceso_solicitud: string;
  categoria_solicitud: string;
  fecha_resolucion_tarea?: string | null;
}

export interface LeaderActivitySummary {
  encargado: string;
  Completada: number;
  Pendiente: number;
  'En Proceso': number;
  total: number;
  collaborators: string[];
  tasks: TaskWithEncargado[];
}

export function encargadoNames(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return ['Sin encargado'];
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : ['Sin encargado'];
}

export function taskBelongsToEncargado(
  encargadoProceso: string | null | undefined,
  selectedEncargado: string
): boolean {
  return encargadoNames(encargadoProceso).includes(selectedEncargado);
}

export function normalizeAsignado(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Sin asignar';
}

function pushStatus(
  acc: Record<string, { Completada: number; Pendiente: number; 'En Proceso': number }>,
  name: string,
  status: string
) {
  if (!acc[name]) {
    acc[name] = { Completada: 0, Pendiente: 0, 'En Proceso': 0 };
  }
  if (status in acc[name]) {
    acc[name][status as keyof (typeof acc)[string]] += 1;
  } else {
    acc[name].Pendiente += 1;
  }
}

/** Agrupa tareas del periodo por líder de área (encargado_proceso). */
export function buildLeaderSummaries(tasks: TaskWithEncargado[]): LeaderActivitySummary[] {
  const byLeader = new Map<
    string,
    {
      counts: { Completada: number; Pendiente: number; 'En Proceso': number };
      collaborators: Set<string>;
      tasks: TaskWithEncargado[];
    }
  >();

  for (const task of tasks) {
    for (const leader of encargadoNames(task.encargado_proceso)) {
      if (!byLeader.has(leader)) {
        byLeader.set(leader, {
          counts: { Completada: 0, Pendiente: 0, 'En Proceso': 0 },
          collaborators: new Set(),
          tasks: [],
        });
      }
      const bucket = byLeader.get(leader)!;
      const status = task.estado_tarea || 'Pendiente';
      pushStatus({ [leader]: bucket.counts }, leader, status);
      bucket.collaborators.add(normalizeAsignado(task.asignado_tarea));
      bucket.tasks.push(task);
    }
  }

  return [...byLeader.entries()]
    .map(([encargado, data]) => ({
      encargado,
      ...data.counts,
      total: data.counts.Completada + data.counts.Pendiente + data.counts['En Proceso'],
      collaborators: [...data.collaborators].sort((a, b) => a.localeCompare(b, 'es')),
      tasks: data.tasks,
    }))
    .sort((a, b) => b.total - a.total || a.encargado.localeCompare(b.encargado, 'es'));
}

export function completionRate(row: {
  total: number;
  Completada: number;
}): number {
  if (row.total === 0) return 0;
  return Math.round((row.Completada / row.total) * 100);
}

export function taskDevelopmentLabel(task: TaskWithEncargado): string | null {
  const hours = getTaskResolutionHours(task);
  if (hours == null) return null;
  return formatResolutionDuration(hours);
}
