import type { DashboardDateFilter } from './dateRange';
import { formatDateLocal, getDashboardDateRange } from './dateRange';
import type { DashboardRequest, DashboardTask } from './types';
import {
  countRequestsByDashboardStatus,
  normalizeRequestStatus,
  type RequestDashboardStatus,
} from './requestStatus';
import { enrichRequestsWithResolution, type RequestWithResolution } from './requestResolution';
import { formatRequestTimeSeriesLabel } from './requestAnalytics';

export const ALL_PROCESSES_VALUE = '__all__';

export type ProcessStatusCounts = {
  abierto: number;
  enProceso: number;
  cerrada: number;
  pendiente: number;
  sinEstado: number;
};

export type ProcessStat = {
  proceso: string;
  solicitudes: number;
  categorias: number;
  empresas: number;
  encargados: string[];
  status: ProcessStatusCounts;
  avgResolutionHours: number | null;
  closedWithTime: number;
};

export type ProcessStatusStackedRow = {
  label: string;
  Abierto: number;
  'En proceso': number;
  Cerrada: number;
  Pendiente: number;
};

function normalizeProcesoName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Sin proceso';
}

function bumpStatus(counts: ProcessStatusCounts, status: RequestDashboardStatus): void {
  switch (status) {
    case 'Abierto':
      counts.abierto += 1;
      break;
    case 'En proceso':
      counts.enProceso += 1;
      break;
    case 'Cerrada':
      counts.cerrada += 1;
      break;
    case 'Pendiente':
      counts.pendiente += 1;
      break;
    default:
      counts.sinEstado += 1;
      break;
  }
}

export function listProcessesFromRequests(requests: DashboardRequest[]): string[] {
  const set = new Set<string>();
  for (const r of requests) {
    set.add(normalizeProcesoName(r.proceso_solicitud));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

export function buildProcessStats(
  requests: DashboardRequest[],
  enriched: RequestWithResolution[]
): ProcessStat[] {
  const resolutionById = new Map(enriched.map((r) => [r.id_solicitud, r]));
  const byProceso = new Map<
    string,
    {
      requests: DashboardRequest[];
      categorias: Set<string>;
      empresas: Set<string>;
      encargados: Set<string>;
      status: ProcessStatusCounts;
      resolutionHours: number[];
      closedWithTime: number;
    }
  >();

  for (const req of requests) {
    const proceso = normalizeProcesoName(req.proceso_solicitud);
    const entry =
      byProceso.get(proceso) ??
      {
        requests: [],
        categorias: new Set<string>(),
        empresas: new Set<string>(),
        encargados: new Set<string>(),
        status: { abierto: 0, enProceso: 0, cerrada: 0, pendiente: 0, sinEstado: 0 },
        resolutionHours: [],
        closedWithTime: 0,
      };

    entry.requests.push(req);
    const cat = req.categoria_solicitud?.trim();
    if (cat) entry.categorias.add(cat);
    const emp = req.empresa_solicitud?.trim();
    if (emp) entry.empresas.add(emp);
    const enc = req.encargado_proceso?.trim();
    if (enc) {
      for (const name of enc.split(',').map((s) => s.trim()).filter(Boolean)) {
        entry.encargados.add(name);
      }
    }

    bumpStatus(entry.status, normalizeRequestStatus(req.estado_solicitud));

    const enrichedReq = resolutionById.get(req.id_solicitud);
    if (enrichedReq?.resolutionHours != null) {
      entry.resolutionHours.push(enrichedReq.resolutionHours);
      entry.closedWithTime += 1;
    }

    byProceso.set(proceso, entry);
  }

  return Array.from(byProceso.entries())
    .map(([proceso, data]) => {
      const hours = data.resolutionHours;
      const avg =
        hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
      return {
        proceso,
        solicitudes: data.requests.length,
        categorias: data.categorias.size,
        empresas: data.empresas.size,
        encargados: Array.from(data.encargados).sort((a, b) => a.localeCompare(b, 'es')),
        status: data.status,
        avgResolutionHours: avg,
        closedWithTime: data.closedWithTime,
      };
    })
    .sort((a, b) => b.solicitudes - a.solicitudes);
}

export function buildProcessStatusStackedRows(stats: ProcessStat[], limit = 10): ProcessStatusStackedRow[] {
  return stats.slice(0, limit).map((s) => ({
    label: s.proceso,
    Abierto: s.status.abierto,
    'En proceso': s.status.enProceso,
    Cerrada: s.status.cerrada,
    Pendiente: s.status.pendiente,
  }));
}

export function buildCategoryCountByProcess(
  requests: DashboardRequest[],
  procesoFilter?: string | null
): { name: string; value: number }[] {
  const data: Record<string, number> = {};
  for (const r of requests) {
    const proceso = normalizeProcesoName(r.proceso_solicitud);
    if (procesoFilter && procesoFilter !== ALL_PROCESSES_VALUE && proceso !== procesoFilter) {
      continue;
    }
    const cat = r.categoria_solicitud?.trim() || 'Sin categoría';
    data[cat] = (data[cat] || 0) + 1;
  }
  return Object.entries(data)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

export function buildCompanyCountForProcess(
  requests: DashboardRequest[],
  proceso: string
): { name: string; value: number }[] {
  const data: Record<string, number> = {};
  for (const r of requests) {
    if (normalizeProcesoName(r.proceso_solicitud) !== proceso) continue;
    const c = r.empresa_solicitud?.trim() || 'Sin empresa';
    data[c] = (data[c] || 0) + 1;
  }
  return Object.entries(data)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function getProcessTrendDateKey(date: Date, filter: DashboardDateFilter): string {
  const year = date.getFullYear();
  const month = date.getMonth();

  switch (filter) {
    case 'month':
      return formatDateLocal(date);
    case 'quarter': {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      return formatDateLocal(weekStart);
    }
    case 'semester':
    case 'year':
      return `${year}-${String(month + 1).padStart(2, '0')}`;
    case 'all': {
      const q = Math.floor(month / 3) + 1;
      return `${year}-Q${q}`;
    }
    default:
      return formatDateLocal(date);
  }
}

/** Tendencia de solicitudes creadas agrupadas por periodo (total o filtrado por proceso). */
export function buildProcessTimeSeries(
  requests: DashboardRequest[],
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date,
  procesoFilter?: string | null
): [string, number][] {
  const raw = requests.reduce(
    (acc, req) => {
      const proceso = normalizeProcesoName(req.proceso_solicitud);
      if (procesoFilter && procesoFilter !== ALL_PROCESSES_VALUE && proceso !== procesoFilter) {
        return acc;
      }
      const date = new Date(req.fecha_creacion_solicitud);
      const key = getProcessTrendDateKey(date, dateFilter);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return buildCompleteProcessTimeSeries(requests, raw, dateFilter, selectedMonthDate, procesoFilter);
}

export function buildCompleteProcessTimeSeries(
  requests: DashboardRequest[],
  timeSeriesData: Record<string, number>,
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date,
  procesoFilter?: string | null
): [string, number][] {
  const filtered =
    procesoFilter && procesoFilter !== ALL_PROCESSES_VALUE
      ? requests.filter((r) => normalizeProcesoName(r.proceso_solicitud) === procesoFilter)
      : requests;

  const now = new Date();

  switch (dateFilter) {
    case 'month': {
      const range = getDashboardDateRange('month', selectedMonthDate)!;
      const result: [string, number][] = [];
      const cur = new Date(range.startDate + 'T00:00:00');
      const end = new Date(range.endDate + 'T00:00:00');
      while (cur <= end) {
        const key = formatDateLocal(cur);
        result.push([key, timeSeriesData[key] || 0]);
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }
    case 'quarter': {
      const range = getDashboardDateRange('quarter', selectedMonthDate)!;
      const start = new Date(range.startDate + 'T00:00:00');
      const end = new Date(range.endDate + 'T00:00:00');
      const cur = new Date(start);
      cur.setDate(start.getDate() - start.getDay());
      const result: [string, number][] = [];
      while (cur <= end) {
        const key = formatDateLocal(cur);
        result.push([key, timeSeriesData[key] || 0]);
        cur.setDate(cur.getDate() + 7);
      }
      return result;
    }
    case 'semester':
    case 'year': {
      const range = getDashboardDateRange(dateFilter, selectedMonthDate)!;
      const start = new Date(range.startDate + 'T00:00:00');
      const end = new Date(range.endDate + 'T00:00:00');
      const result: [string, number][] = [];
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        result.push([key, timeSeriesData[key] || 0]);
        cur.setMonth(cur.getMonth() + 1);
      }
      return result;
    }
    case 'all': {
      if (filtered.length === 0) return [];
      const minDate = filtered.reduce((min, r) => {
        const d = new Date(r.fecha_creacion_solicitud);
        return d < min ? d : min;
      }, new Date());
      const result: [string, number][] = [];
      const cur = new Date(minDate.getFullYear(), Math.floor(minDate.getMonth() / 3) * 3, 1);
      while (cur <= now) {
        const q = Math.floor(cur.getMonth() / 3) + 1;
        const key = `${cur.getFullYear()}-Q${q}`;
        result.push([key, timeSeriesData[key] || 0]);
        cur.setMonth(cur.getMonth() + 3);
      }
      return result;
    }
    default:
      return Object.entries(timeSeriesData).sort((a, b) => a[0].localeCompare(b[0]));
  }
}

export function formatProcessTimeSeriesLabel(
  key: string,
  dateFilter: DashboardDateFilter
): string {
  return formatRequestTimeSeriesLabel(key, dateFilter);
}

export function computeProcessCoverageMetrics(
  processStats: ProcessStat[],
  requests: DashboardRequest[]
): {
  totalProcesos: number;
  avgVolumenPorProceso: number;
  topProceso: ProcessStat | null;
  categoriasDistintas: number;
  empresasDistintas: number;
  encargadosDistintos: number;
} {
  const categorias = new Set<string>();
  const empresas = new Set<string>();
  const encargados = new Set<string>();

  for (const req of requests) {
    const cat = req.categoria_solicitud?.trim();
    if (cat) categorias.add(cat);
    const emp = req.empresa_solicitud?.trim();
    if (emp) empresas.add(emp);
    const encRaw = req.encargado_proceso?.trim();
    if (encRaw) {
      for (const name of encRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
        encargados.add(name);
      }
    }
  }

  const totalVolumen = processStats.reduce((sum, p) => sum + p.solicitudes, 0);

  return {
    totalProcesos: processStats.length,
    avgVolumenPorProceso: processStats.length > 0 ? totalVolumen / processStats.length : 0,
    topProceso: processStats[0] ?? null,
    categoriasDistintas: categorias.size,
    empresasDistintas: empresas.size,
    encargadosDistintos: encargados.size,
  };
}

/** Procesos distintos con al menos una solicitud creada en cada bucket del periodo. */
export function buildDistinctProcessActivityTimeSeries(
  requests: DashboardRequest[],
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date,
  procesoFilter?: string | null
): [string, number][] {
  const buckets = new Map<string, Set<string>>();

  for (const req of requests) {
    const proceso = normalizeProcesoName(req.proceso_solicitud);
    if (procesoFilter && procesoFilter !== ALL_PROCESSES_VALUE && proceso !== procesoFilter) {
      continue;
    }
    const date = new Date(req.fecha_creacion_solicitud);
    const key = getProcessTrendDateKey(date, dateFilter);
    const set = buckets.get(key) ?? new Set<string>();
    set.add(proceso);
    buckets.set(key, set);
  }

  const raw = Object.fromEntries(
    Array.from(buckets.entries()).map(([key, set]) => [key, set.size])
  );

  return buildCompleteProcessTimeSeries(
    requests,
    raw,
    dateFilter,
    selectedMonthDate,
    procesoFilter
  );
}

export function computeProcessSummary(
  processStats: ProcessStat[],
  requests: DashboardRequest[]
): {
  totalProcesos: number;
  totalSolicitudes: number;
  avgSolicitudesPorProceso: number;
  topProceso: ProcessStat | null;
  globalStatus: ReturnType<typeof countRequestsByDashboardStatus>;
} {
  const totalProcesos = processStats.length;
  const totalSolicitudes = requests.length;
  const avgSolicitudesPorProceso =
    totalProcesos > 0 ? totalSolicitudes / totalProcesos : 0;

  return {
    totalProcesos,
    totalSolicitudes,
    avgSolicitudesPorProceso,
    topProceso: processStats[0] ?? null,
    globalStatus: countRequestsByDashboardStatus(requests),
  };
}

export function buildProcessStatsFromTasks(
  tasks: DashboardTask[],
  requests: DashboardRequest[]
): ProcessStat[] {
  const enriched = enrichRequestsWithResolution(requests, tasks);
  return buildProcessStats(requests, enriched);
}
