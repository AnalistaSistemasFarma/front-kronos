import type { DashboardRequest, DashboardTask } from './types';
import {
  formatDateLocal,
  getDashboardDateRange,
  type DashboardDateFilter,
} from './dateRange';

export function uniqueRequestsFromTasks(tasks: DashboardTask[]): DashboardRequest[] {
  const map = new Map<number, DashboardRequest>();
  for (const task of tasks) {
    if (!map.has(task.id_solicitud)) {
      map.set(task.id_solicitud, {
        id_solicitud: task.id_solicitud,
        asunto_solicitud: task.asunto_solicitud,
        descripcion_solicitud: task.descripcion_solicitud,
        fecha_creacion_solicitud: task.fecha_creacion_solicitud,
        empresa_solicitud: task.empresa_solicitud,
        creador_solicitud: task.creador_solicitud,
        estado_solicitud: task.estado_solicitud,
        resolucion_solicitud: task.resolucion_solicitud,
        fecha_resolucion_solicitud: task.fecha_resolucion_solicitud,
        ejecutor_final_solicitud: task.ejecutor_final_solicitud,
        proceso_solicitud: task.proceso_solicitud,
        categoria_solicitud: task.categoria_solicitud,
      });
    }
  }
  return Array.from(map.values());
}

function getRequestDateKey(date: Date, filter: DashboardDateFilter): string {
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

export function buildRequestTimeSeries(
  requests: DashboardRequest[],
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date
): Record<string, number> {
  return requests.reduce(
    (acc, req) => {
      const date = new Date(req.fecha_creacion_solicitud);
      const key = getRequestDateKey(date, dateFilter);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

export function buildCompleteRequestTimeSeries(
  requests: DashboardRequest[],
  timeSeriesData: Record<string, number>,
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date
): [string, number][] {
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
      if (requests.length === 0) return [];
      const minDate = requests.reduce((min, r) => {
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

export function formatRequestTimeSeriesLabel(
  key: string,
  dateFilter: DashboardDateFilter
): string {
  if (dateFilter === 'year' || dateFilter === 'semester') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
  }
  if (dateFilter === 'month' || dateFilter === 'quarter') {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  }
  if (dateFilter === 'all') {
    const [year, q] = key.split('-');
    return `${q} ${year}`;
  }
  return key;
}
