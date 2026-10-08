/**
 * Agrupa tareas Orion de firma por archivo (no por persona).
 * Evita listar N×2 filas (Autorizar + Firmar) por cada firmante.
 */
import {
  isOrionWorkflowResolution,
  parseOrionFileIdFromResolution,
} from './signerAuthMarkers';

export type OrionTaskLike = {
  id: number | string;
  task?: string | null;
  status?: string | null;
  id_status?: number | null;
  resolution?: string | null;
  name?: string | null;
  locked?: boolean | null;
  display_order?: number | null;
  id_task?: number | null;
};

export type OrionFileProgressGroup = {
  fileId: string;
  label: string;
  totalSignTasks: number;
  completedSignTasks: number;
  totalAuthTasks: number;
  completedAuthTasks: number;
  /** 0–100 según tareas de firma del archivo. */
  percent: number;
  allDone: boolean;
  anyLocked: boolean;
  taskIds: Array<number | string>;
};

function isDone(task: OrionTaskLike & { status_task?: string | null }): boolean {
  const statusLower = String(task.status_task || task.status || '').toLowerCase();
  return task.id_status === 2 || statusLower === 'resuelto' || statusLower === 'completado';
}

function isSignTaskName(name?: string | null): boolean {
  const t = String(name || '').toLowerCase();
  return t.includes('firmar documento') || (t.includes('firmar') && !t.includes('autoriz'));
}

function isAuthTaskName(name?: string | null): boolean {
  const t = String(name || '').toLowerCase();
  return t.includes('autorizar firma') || t.includes('firma digital');
}

export function isOrionSignatureTask(task: OrionTaskLike): boolean {
  if (isOrionWorkflowResolution(task.resolution)) return true;
  return isSignTaskName(task.task) || isAuthTaskName(task.task);
}

/** Tareas normales (no Orion) + un resumen por archivo de firma. */
export function partitionTasksForDisplay<T extends OrionTaskLike>(tasks: T[]): {
  businessTasks: T[];
  orionByFile: OrionFileProgressGroup[];
} {
  const businessTasks: T[] = [];
  const byFile = new Map<string, T[]>();

  for (const task of tasks) {
    if (!isOrionSignatureTask(task)) {
      businessTasks.push(task);
      continue;
    }
    const fileId = parseOrionFileIdFromResolution(task.resolution) || '_legacy';
    const list = byFile.get(fileId) || [];
    list.push(task);
    byFile.set(fileId, list);
  }

  const orionByFile: OrionFileProgressGroup[] = [];
  for (const [fileId, fileTasks] of byFile) {
    const signTasks = fileTasks.filter((t) => isSignTaskName(t.task));
    const authTasks = fileTasks.filter((t) => isAuthTaskName(t.task));
    const signPool = signTasks.length > 0 ? signTasks : fileTasks;
    const completedSign = signPool.filter(isDone).length;
    const totalSign = signPool.length;
    const completedAuth = authTasks.filter(isDone).length;
    const percent = totalSign > 0 ? Math.round((completedSign / totalSign) * 100) : 0;

    const fileLabel =
      fileTasks
        .map((t) => {
          const m = /:\s*([^(\]]+?)(?:\s*\(|$)/.exec(String(t.resolution || ''));
          return m?.[1]?.trim();
        })
        .find(Boolean) || (fileId === '_legacy' ? 'Documento' : `Archivo ${fileId.slice(0, 8)}…`);

    orionByFile.push({
      fileId,
      label: fileLabel,
      totalSignTasks: totalSign,
      completedSignTasks: completedSign,
      totalAuthTasks: authTasks.length,
      completedAuthTasks: completedAuth,
      percent,
      allDone: totalSign > 0 && completedSign >= totalSign,
      anyLocked: fileTasks.some((t) => Boolean(t.locked)),
      taskIds: fileTasks.map((t) => t.id),
    });
  }

  orionByFile.sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return { businessTasks, orionByFile };
}

export type TaskDisplayBadge = {
  key: string;
  label: string;
  statusLabel: string;
  /** Estado visual: resuelto / pendiente / otro */
  statusKey: string;
  done: boolean;
  percent: number;
  kind: 'business' | 'orion-file';
};

/**
 * Badges para listados de solicitudes: tareas de negocio + 1 badge por archivo Orion
 * (en lugar de N×“Firmar documento” / “Autorizar firma digital”).
 */
export function buildTaskDisplayBadges<
  T extends OrionTaskLike & { status_task?: string | null },
>(tasks: T[]): TaskDisplayBadge[] {
  const { businessTasks, orionByFile } = partitionTasksForDisplay(tasks);
  const badges: TaskDisplayBadge[] = [];

  for (const t of businessTasks) {
    const statusLabel = String(t.status_task || t.status || '').trim() || 'Pendiente';
    const done = isDone(t);
    badges.push({
      key: `biz-${t.id}`,
      label: String(t.task || t.name || 'Tarea'),
      statusLabel,
      statusKey: statusLabel,
      done,
      percent: done ? 100 : 0,
      kind: 'business',
    });
  }

  for (const g of orionByFile) {
    const statusLabel = g.allDone
      ? 'Resuelto'
      : g.completedSignTasks > 0
        ? `En progreso (${g.completedSignTasks}/${g.totalSignTasks})`
        : 'Pendiente';
    badges.push({
      key: `orion-${g.fileId}`,
      label: g.label.startsWith('Firma') ? g.label : `Firma · ${g.label}`,
      statusLabel,
      statusKey: g.allDone
        ? 'Resuelto'
        : g.completedSignTasks > 0
          ? 'Abierto'
          : 'Sin empezar',
      done: g.allDone,
      percent: g.percent,
      kind: 'orion-file',
    });
  }

  return badges;
}

/** Progreso agregado (negocio + un ítem por archivo de firma). */
export function getSimplifiedTasksProgress<
  T extends OrionTaskLike & { status_task?: string | null },
>(tasks: T[]): { total: number; done: number; percent: number } {
  const badges = buildTaskDisplayBadges(tasks);
  const total = badges.length;
  const done = badges.filter((b) => b.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}
