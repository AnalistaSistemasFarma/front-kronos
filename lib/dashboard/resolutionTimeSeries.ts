export interface TaskForResolutionTime {
  id_tarea?: number;
  tarea?: string;
  estado_tarea: string;
  asignado_tarea: string;
  /** start_date — cuando la persona empieza a trabajar la tarea */
  hora_inicio_tarea?: string | null;
  /** end_date — cuando finaliza la tarea */
  fecha_fin_tarea?: string | null;
  /** Resolución registrada (alternativa si end_date viene vacío en BD) */
  fecha_resolucion_tarea?: string | null;
}

/** Máximo razonable para descartar registros inconsistentes en BD (30 días). */
const MAX_RESOLUTION_HOURS = 30 * 24;

/** Tickets pueden tardar más que actividades puntuales. */
export const MAX_TICKET_RESOLUTION_HOURS = 365 * 24;

export type ResolutionTrend = 'up' | 'down' | 'flat';

export interface ResolutionTimePoint {
  /** Etiqueta corta para el eje X */
  label: string;
  /** Clave de periodo ordenable (YYYY-MM-DD del inicio del bucket) */
  periodKey: string;
  /** Promedio de horas de resolución en el periodo */
  avgHours: number;
  /** Suma de horas (todas las tareas cerradas en el periodo) */
  totalHours: number;
  /** Cantidad de tareas cerradas en el periodo */
  taskCount: number;
  /** Variación porcentual vs periodo anterior */
  changePct: number | null;
  trend: ResolutionTrend | null;
  /** Texto legible del cambio vs periodo anterior */
  changeLabel: string | null;
  prevAvgHours: number | null;
}

export interface ResolutionTimeSummary {
  points: ResolutionTimePoint[];
  completedTasks: number;
  overallAvgHours: number | null;
  latestAvgHours: number | null;
  latestChangePct: number | null;
  latestTrend: ResolutionTrend | null;
  latestChangeLabel: string | null;
}

type BucketMode = 'day' | 'week' | 'month';

function parseTaskDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function chooseBucketMode(dates: Date[]): BucketMode {
  if (dates.length === 0) return 'week';
  const min = Math.min(...dates.map((d) => d.getTime()));
  const max = Math.max(...dates.map((d) => d.getTime()));
  const spanDays = (max - min) / 86_400_000;
  if (spanDays <= 45) return 'day';
  if (spanDays <= 180) return 'week';
  return 'month';
}

function bucketStart(date: Date, mode: BucketMode): Date {
  if (mode === 'day') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  if (mode === 'week') return startOfWeek(date);
  return startOfMonth(date);
}

function formatBucketLabel(date: Date, mode: BucketMode): string {
  if (mode === 'day') {
    return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }
  if (mode === 'week') {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    const startStr = date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    return `${startStr} – ${endStr}`;
  }
  return date.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
}

/**
 * Duración en horas desde inicio de trabajo hasta cierre.
 * Usa fecha_fin_tarea y, si falta, fecha_resolucion_tarea.
 */
export function getTaskResolutionHours(
  task: TaskForResolutionTime,
  maxHours: number = MAX_RESOLUTION_HOURS
): number | null {
  const start = parseTaskDate(task.hora_inicio_tarea);
  const end =
    parseTaskDate(task.fecha_fin_tarea) ?? parseTaskDate(task.fecha_resolucion_tarea);
  if (!start || !end) return null;

  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;

  const hours = ms / 3_600_000;
  if (hours > maxHours) return null;

  return hours;
}

function isTaskClosedForSeries(task: TaskForResolutionTime): boolean {
  if (task.fecha_fin_tarea || task.fecha_resolucion_tarea) return true;
  const s = (task.estado_tarea || '').toLowerCase();
  return (
    s.includes('completad') ||
    s.includes('resuelt') ||
    s.includes('cerrad') ||
    s.includes('cancel')
  );
}

export function formatResolutionDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 1) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  const days = hours / 24;
  if (days < 2) return `${days.toFixed(1)} día`;
  return `${days.toFixed(1)} días`;
}

function computeTrend(changePct: number | null): ResolutionTrend | null {
  if (changePct == null) return null;
  if (changePct > 0.5) return 'up';
  if (changePct < -0.5) return 'down';
  return 'flat';
}

const MIN_PREV_HOURS_FOR_PCT = 5 / 60; // 5 min — por debajo, usar diferencia absoluta
const MAX_DISPLAY_PCT = 300;

/** Cambio entendible: minutos/horas concretos en lugar de % absurdos. */
export function formatTrendChange(
  currentHours: number,
  prevHours: number | null
): { changePct: number | null; changeLabel: string | null; trend: ResolutionTrend | null } {
  if (prevHours == null) {
    return { changePct: null, changeLabel: 'Primer periodo con datos', trend: null };
  }

  const deltaHours = currentHours - prevHours;
  const deltaMinutes = Math.round(Math.abs(deltaHours) * 60);
  const direction = deltaHours > 0 ? 'up' : deltaHours < 0 ? 'down' : 'flat';

  if (Math.abs(deltaHours) < 1 / 120) {
    return { changePct: 0, changeLabel: 'Sin cambio', trend: 'flat' };
  }

  if (prevHours < MIN_PREV_HOURS_FOR_PCT) {
    const label =
      direction === 'up'
        ? `Tardó ${deltaMinutes} min más`
        : direction === 'down'
          ? `Fue ${deltaMinutes} min más rápido`
          : 'Sin cambio';
    return { changePct: null, changeLabel: label, trend: direction };
  }

  const changePct = (deltaHours / prevHours) * 100;
  const trend = computeTrend(changePct);

  if (Math.abs(changePct) > MAX_DISPLAY_PCT) {
    const absLabel = formatResolutionDuration(Math.abs(deltaHours));
    const label =
      direction === 'up'
        ? `Tardó ${absLabel} más`
        : direction === 'down'
          ? `Fue ${absLabel} más rápido`
          : 'Sin cambio';
    return { changePct, changeLabel: label, trend };
  }

  const pctRounded = Math.round(Math.abs(changePct));
  const label =
    direction === 'up'
      ? `Tardó ${pctRounded}% más`
      : direction === 'down'
        ? `Fue ${pctRounded}% más rápido`
        : 'Sin cambio';

  return { changePct, changeLabel: label, trend };
}

function formatTaskPointLabel(task: TaskForResolutionTime, finishedAt: Date): string {
  const dateStr = finishedAt.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
  });
  const name = task.tarea?.trim();
  if (name) {
    return name.length > 22 ? `${dateStr} · ${name.slice(0, 20)}…` : `${dateStr} · ${name}`;
  }
  if (task.id_tarea) return `${dateStr} · #${task.id_tarea}`;
  return dateStr;
}

function buildPerTaskPoints(
  items: { hours: number; closedAt: Date; label: string }[]
): ResolutionTimePoint[] {
  const sorted = [...items].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  let prevAvg: number | null = null;

  return sorted.map((item, index) => {
    const { changePct, changeLabel, trend } = formatTrendChange(item.hours, prevAvg);
    const point: ResolutionTimePoint = {
      label: item.label,
      periodKey: `${formatDateKey(item.closedAt)}-${index}`,
      avgHours: item.hours,
      totalHours: item.hours,
      taskCount: 1,
      changePct,
      trend,
      changeLabel,
      prevAvgHours: prevAvg,
    };
    prevAvg = item.hours;
    return point;
  });
}

function buildBucketPoints(
  completed: { hours: number; closedAt: Date }[],
  mode: BucketMode
): ResolutionTimePoint[] {
  const buckets = new Map<string, { hours: number[]; start: Date }>();

  for (const item of completed) {
    const start = bucketStart(item.closedAt, mode);
    const key = formatDateKey(start);
    const existing = buckets.get(key);
    if (existing) {
      existing.hours.push(item.hours);
    } else {
      buckets.set(key, { hours: [item.hours], start });
    }
  }

  const sorted = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  let prevAvg: number | null = null;

  return sorted.map(([key, bucket]) => {
    const totalHours = bucket.hours.reduce((sum, h) => sum + h, 0);
    const avgHours = totalHours / bucket.hours.length;
    const { changePct, changeLabel, trend } = formatTrendChange(avgHours, prevAvg);
    const point: ResolutionTimePoint = {
      label: formatBucketLabel(bucket.start, mode),
      periodKey: key,
      avgHours,
      totalHours,
      taskCount: bucket.hours.length,
      changePct,
      trend,
      changeLabel,
      prevAvgHours: prevAvg,
    };
    prevAvg = avgHours;
    return point;
  });
}

/**
 * Serie temporal del tiempo promedio de resolución.
 * Agrupa por día/semana/mes según la fecha de finalización (end_date).
 * Para el líder de área: pasar todas las tareas del equipo (sin filtro de persona).
 */
export function buildResolutionTimeSeries(
  tasks: TaskForResolutionTime[],
  assigneeFilter?: string | null,
  options?: { maxHours?: number }
): ResolutionTimeSummary {
  const normalizedFilter = assigneeFilter?.trim() || null;
  const maxHours = options?.maxHours ?? MAX_RESOLUTION_HOURS;

  const completed = tasks
    .map((task) => {
      if (normalizedFilter) {
        const assignee = task.asignado_tarea?.trim() || 'Sin asignar';
        if (assignee !== normalizedFilter) return null;
      }
      const hours = getTaskResolutionHours(task, maxHours);
      const finishedAt =
        parseTaskDate(task.fecha_fin_tarea) ??
        parseTaskDate(task.fecha_resolucion_tarea);
      if (hours == null || !finishedAt) return null;
      if (!isTaskClosedForSeries(task)) return null;
      return {
        task,
        hours,
        closedAt: finishedAt,
        label: formatTaskPointLabel(task, finishedAt),
      };
    })
    .filter(
      (
        item
      ): item is {
        task: TaskForResolutionTime;
        hours: number;
        closedAt: Date;
        label: string;
      } => item != null
    );

  if (completed.length === 0) {
    return {
      points: [],
      completedTasks: 0,
      overallAvgHours: null,
      latestAvgHours: null,
      latestChangePct: null,
      latestTrend: null,
      latestChangeLabel: null,
    };
  }

  const mode = chooseBucketMode(completed.map((c) => c.closedAt));
  let points = buildBucketPoints(
    completed.map((c) => ({ hours: c.hours, closedAt: c.closedAt })),
    mode
  );

  // Con pocos cierres o un solo bucket: una línea por tarea (siempre visible)
  if (points.length < 2) {
    points = buildPerTaskPoints(
      completed.map((c) => ({
        hours: c.hours,
        closedAt: c.closedAt,
        label: c.label,
      }))
    );
  }

  const overallTotal = completed.reduce((sum, c) => sum + c.hours, 0);
  const latest = points[points.length - 1];

  return {
    points,
    completedTasks: completed.length,
    overallAvgHours: overallTotal / completed.length,
    latestAvgHours: latest?.avgHours ?? null,
    latestChangePct: latest?.changePct ?? null,
    latestTrend: latest?.trend ?? null,
    latestChangeLabel: latest?.changeLabel ?? null,
  };
}

/** Datos listos para Mantine/Recharts (valor en horas). */
export function toChartRows(points: ResolutionTimePoint[]) {
  return points.map((p) => ({
    period: p.label,
    periodKey: p.periodKey,
    tiempo: Number(p.avgHours.toFixed(2)),
    tareas: p.taskCount,
    changePct: p.changePct,
    trend: p.trend,
    changeLabel: p.changeLabel,
    totalHours: p.totalHours,
  }));
}
