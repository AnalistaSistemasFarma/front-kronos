import type { DashboardRequest, DashboardTask } from './types';
import { formatDateLocal } from './dateRange';
import { formatResolutionDuration } from './resolutionTimeSeries';

export interface RequestWithResolution extends DashboardRequest {
  resolutionHours: number | null;
  resolutionEndDate: string | null;
  resolutionSource: 'solicitud' | 'tareas' | null;
  isClosed: boolean;
}

export function parseDashboardDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isRequestClosedStatus(status: string): boolean {
  const s = status?.toLowerCase().trim() ?? '';
  return ['resuelto', 'completada', 'completado', 'cerrado', 'closed', 'finalizado'].some((x) =>
    s.includes(x)
  );
}

function maxDate(dates: (Date | null)[]): Date | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!max || d.getTime() > max.getTime()) max = d;
  }
  return max;
}

export function enrichRequestsWithResolution(
  requests: DashboardRequest[],
  tasks: DashboardTask[]
): RequestWithResolution[] {
  const tasksByRequest = new Map<number, DashboardTask[]>();
  for (const task of tasks) {
    const list = tasksByRequest.get(task.id_solicitud) ?? [];
    list.push(task);
    tasksByRequest.set(task.id_solicitud, list);
  }

  return requests.map((req) => {
    const created = parseDashboardDate(req.fecha_creacion_solicitud);
    let end = parseDashboardDate(req.fecha_resolucion_solicitud);
    let resolutionSource: 'solicitud' | 'tareas' | null = end ? 'solicitud' : null;

    if (!end) {
      const reqTasks = tasksByRequest.get(req.id_solicitud) ?? [];
      const taskEnds = reqTasks.flatMap((t) => [
        parseDashboardDate(t.fecha_fin_tarea),
        parseDashboardDate(t.fecha_resolucion_tarea),
      ]);
      end = maxDate(taskEnds);
      if (end) resolutionSource = 'tareas';
    }

    const isClosed = isRequestClosedStatus(req.estado_solicitud) || end != null;
    let resolutionHours: number | null = null;
    if (created && end && end.getTime() >= created.getTime()) {
      resolutionHours = (end.getTime() - created.getTime()) / 3_600_000;
    }

    return {
      ...req,
      resolutionHours,
      resolutionEndDate: end ? end.toISOString() : null,
      resolutionSource,
      isClosed,
    };
  });
}

export interface ResolutionSummary {
  closedWithTime: number;
  openCount: number;
  avgHours: number | null;
  medianHours: number | null;
  minHours: number | null;
  maxHours: number | null;
}

export function computeResolutionSummary(
  enriched: RequestWithResolution[]
): ResolutionSummary {
  const hours = enriched
    .map((r) => r.resolutionHours)
    .filter((h): h is number => h != null && h >= 0)
    .sort((a, b) => a - b);

  const openCount = enriched.filter((r) => r.resolutionHours == null).length;

  if (hours.length === 0) {
    return {
      closedWithTime: 0,
      openCount,
      avgHours: null,
      medianHours: null,
      minHours: null,
      maxHours: null,
    };
  }

  const sum = hours.reduce((a, b) => a + b, 0);
  const mid = Math.floor(hours.length / 2);
  const median =
    hours.length % 2 === 0 ? (hours[mid - 1] + hours[mid]) / 2 : hours[mid];

  return {
    closedWithTime: hours.length,
    openCount,
    avgHours: sum / hours.length,
    medianHours: median,
    minHours: hours[0],
    maxHours: hours[hours.length - 1],
  };
}

export interface ResolutionTimeSeriesPoint {
  label: string;
  avgHours: number;
  count: number;
}

export function buildAvgResolutionTimeSeries(
  enriched: RequestWithResolution[],
  formatLabel: (key: string) => string
): ResolutionTimeSeriesPoint[] {
  const buckets = new Map<string, { totalHours: number; count: number }>();

  for (const req of enriched) {
    if (req.resolutionHours == null || !req.resolutionEndDate) continue;
    const end = new Date(req.resolutionEndDate);
    const key = formatDateLocal(end);
    const b = buckets.get(key) ?? { totalHours: 0, count: 0 };
    b.totalHours += req.resolutionHours;
    b.count += 1;
    buckets.set(key, b);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({
      label: formatLabel(key),
      avgHours: v.count > 0 ? v.totalHours / v.count : 0,
      count: v.count,
    }));
}

export function formatHoursLabel(hours: number | null): string {
  if (hours == null) return '—';
  return formatResolutionDuration(hours);
}

export function listCompaniesFromTasks(tasks: DashboardTask[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    const name = t.empresa_solicitud?.trim();
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

export const ALL_COMPANIES_VALUE = '__all__';
