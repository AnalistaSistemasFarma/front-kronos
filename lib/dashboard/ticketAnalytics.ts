import type { TicketStackedRow } from '../charts/builders';
import {
  formatDateLocal,
  getDashboardDateRange,
  type DashboardDateFilter,
} from './dateRange';
import {
  buildResolutionTimeSeries,
  formatResolutionDuration,
  getTaskResolutionHours,
  type TaskForResolutionTime,
} from './resolutionTimeSeries';

export type TicketStatusBucket = 'Abierto' | 'En progreso' | 'Resuelto' | 'Cerrado';

export interface HelpDeskCase {
  id_case?: number;
  subject_case?: string;
  status?: string;
  id_status_case?: number;
  priority?: string;
  department?: string;
  case_type?: string;
  category?: string;
  creation_date?: string | Date;
  end_date?: string | Date | null;
  nombreTecnico?: string;
  company?: string;
  resolution?: string;
}

export interface TicketStatusCounts {
  abierto: number;
  enProgreso: number;
  resuelto: number;
  cerrado: number;
  total: number;
}

export interface TechnicianMetrics {
  name: string;
  total: number;
  counts: TicketStatusCounts;
  resolved: number;
  avgResolutionHours: number | null;
  score: number;
  openBacklog: number;
}

export interface TeamSummary {
  counts: TicketStatusCounts;
  avgResolutionHours: number | null;
  teamScore: number;
  technicians: TechnicianMetrics[];
}

const ALL_TECHNICIANS = '__all__';
export const ALL_TECHNICIANS_VALUE = ALL_TECHNICIANS;

export function normalizeTicketStatus(
  status?: string,
  idStatus?: number
): TicketStatusBucket {
  const s = String(status ?? '').toLowerCase().trim();
  const id = idStatus ?? 0;

  if (id === 2 || s.includes('resuelt')) return 'Resuelto';
  if (id === 3 || s.includes('cancel') || s.includes('cerrad')) return 'Cerrado';
  if (id === 4 || s.includes('progreso') || s.includes('proceso')) return 'En progreso';
  if (id === 1 || s.includes('abiert')) return 'Abierto';
  return 'Abierto';
}

function parseCaseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getTechnicianLabel(c: HelpDeskCase): string {
  const name = c.nombreTecnico?.trim();
  return name && name.length > 0 ? name : 'Sin asignar';
}

export function getCompanyLabel(c: HelpDeskCase): string {
  const name = c.company?.trim();
  return name && name.length > 0 ? name : 'Sin empresa';
}

export function caseToResolutionTask(c: HelpDeskCase): TaskForResolutionTime {
  const creation = c.creation_date;
  const startStr =
    creation instanceof Date
      ? formatDateLocal(creation)
      : String(creation ?? '').split('T')[0] || null;
  const end = c.end_date;
  const endStr =
    end instanceof Date ? formatDateLocal(end) : end ? String(end).split('T')[0] : null;

  return {
    id_tarea: c.id_case,
    tarea: c.subject_case,
    estado_tarea: c.status ?? '',
    asignado_tarea: getTechnicianLabel(c),
    hora_inicio_tarea: startStr,
    fecha_fin_tarea: endStr,
  };
}

export function countByStatus(cases: HelpDeskCase[]): TicketStatusCounts {
  const counts: TicketStatusCounts = {
    abierto: 0,
    enProgreso: 0,
    resuelto: 0,
    cerrado: 0,
    total: cases.length,
  };

  for (const c of cases) {
    const bucket = normalizeTicketStatus(c.status, c.id_status_case);
    if (bucket === 'Abierto') counts.abierto += 1;
    else if (bucket === 'En progreso') counts.enProgreso += 1;
    else if (bucket === 'Resuelto') counts.resuelto += 1;
    else counts.cerrado += 1;
  }

  return counts;
}

/** Puntaje 0–100: cumplimiento, tiempo de cierre y carga abierta */
export function computeTicketPerformanceScore(params: {
  total: number;
  resolved: number;
  cerrado: number;
  openBacklog: number;
  avgHours: number | null;
}): number {
  const { total, resolved, cerrado, openBacklog, avgHours } = params;
  if (total <= 0) return 0;

  const closedRate = (resolved + cerrado) / total;
  const resolvedRate = resolved / total;
  const backlogFactor = 1 - Math.min(openBacklog / total, 1);

  let timeScore = 55;
  if (avgHours != null && avgHours >= 0) {
    if (avgHours <= 8) timeScore = 100;
    else if (avgHours <= 24) timeScore = 85;
    else if (avgHours <= 48) timeScore = 70;
    else if (avgHours <= 72) timeScore = 55;
    else if (avgHours <= 120) timeScore = 35;
    else timeScore = Math.max(10, 100 - avgHours / 4);
  }

  const raw =
    resolvedRate * 40 + closedRate * 20 + backlogFactor * 15 + (timeScore / 100) * 25;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

function avgResolutionHoursForCases(cases: HelpDeskCase[]): number | null {
  const hours = cases
    .map((c) => getTaskResolutionHours(caseToResolutionTask(c)))
    .filter((h): h is number => h != null);
  if (hours.length === 0) return null;
  return hours.reduce((a, b) => a + b, 0) / hours.length;
}

export function buildTechnicianMetrics(cases: HelpDeskCase[]): TechnicianMetrics[] {
  const byTech = new Map<string, HelpDeskCase[]>();

  for (const c of cases) {
    const name = getTechnicianLabel(c);
    const list = byTech.get(name) ?? [];
    list.push(c);
    byTech.set(name, list);
  }

  return [...byTech.entries()]
    .map(([name, list]) => {
      const counts = countByStatus(list);
      const avgResolutionHours = avgResolutionHoursForCases(
        list.filter((c) => normalizeTicketStatus(c.status, c.id_status_case) === 'Resuelto')
      );
      const openBacklog = counts.abierto + counts.enProgreso;
      const score = computeTicketPerformanceScore({
        total: counts.total,
        resolved: counts.resuelto,
        cerrado: counts.cerrado,
        openBacklog,
        avgHours: avgResolutionHours,
      });

      return {
        name,
        total: counts.total,
        counts,
        resolved: counts.resuelto,
        avgResolutionHours,
        score,
        openBacklog,
      };
    })
    .sort((a, b) => b.total - a.total || b.score - a.score);
}

export function buildTeamSummary(cases: HelpDeskCase[]): TeamSummary {
  const counts = countByStatus(cases);
  const resolvedCases = cases.filter(
    (c) => normalizeTicketStatus(c.status, c.id_status_case) === 'Resuelto'
  );
  const avgResolutionHours = avgResolutionHoursForCases(resolvedCases);
  const openBacklog = counts.abierto + counts.enProgreso;

  const teamScore = computeTicketPerformanceScore({
    total: counts.total,
    resolved: counts.resuelto,
    cerrado: counts.cerrado,
    openBacklog,
    avgHours: avgResolutionHours,
  });

  return {
    counts,
    avgResolutionHours,
    teamScore,
    technicians: buildTechnicianMetrics(cases),
  };
}

export function filterCasesByTechnician(
  cases: HelpDeskCase[],
  technician: string
): HelpDeskCase[] {
  if (technician === ALL_TECHNICIANS_VALUE) return cases;
  return cases.filter((c) => getTechnicianLabel(c) === technician);
}

export function listTechnicians(cases: HelpDeskCase[]): string[] {
  const names = new Set(cases.map(getTechnicianLabel));
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
}

export function aggregateByCompany(
  cases: HelpDeskCase[],
  limit = 10
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const c of cases) {
    const company = getCompanyLabel(c);
    map.set(company, (map.get(company) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function buildTechnicianStackedRows(
  technicians: TechnicianMetrics[]
): TicketStackedRow[] {
  return technicians.slice(0, 12).map((t) => ({
    tecnico: t.name,
    Abierto: t.counts.abierto,
    'En progreso': t.counts.enProgreso,
    Resuelto: t.counts.resuelto,
    Cerrado: t.counts.cerrado,
  }));
}

export function buildCaseResolutionSeries(
  cases: HelpDeskCase[],
  technicianFilter?: string | null
) {
  const tasks = cases.map(caseToResolutionTask);
  return buildResolutionTimeSeries(tasks, technicianFilter ?? null);
}

export { formatResolutionDuration };

function getCaseDateKey(date: Date, filter: DashboardDateFilter): string {
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
    default:
      return formatDateLocal(date);
  }
}

export function buildCaseCreationTimeSeries(
  cases: HelpDeskCase[],
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date
): Record<string, number> {
  return cases.reduce(
    (acc, c) => {
      const d = parseCaseDate(c.creation_date);
      if (!d) return acc;
      const key = getCaseDateKey(d, dateFilter);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

export function buildCompleteCaseTimeSeries(
  cases: HelpDeskCase[],
  timeSeriesData: Record<string, number>,
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date
): [string, number][] {
  const range = getDashboardDateRange(dateFilter, selectedMonthDate);

  switch (dateFilter) {
    case 'month': {
      if (!range) return Object.entries(timeSeriesData);
      const result: [string, number][] = [];
      const cur = new Date(`${range.startDate}T00:00:00`);
      const end = new Date(`${range.endDate}T00:00:00`);
      while (cur <= end) {
        const key = formatDateLocal(cur);
        result.push([key, timeSeriesData[key] || 0]);
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }
    case 'quarter': {
      if (!range) return Object.entries(timeSeriesData);
      const start = new Date(`${range.startDate}T00:00:00`);
      const end = new Date(`${range.endDate}T00:00:00`);
      const cur = new Date(start);
      cur.setDate(start.getDate() - start.getDay());
      const result: [string, number][] = [];
      while (cur <= end) {
        const key = formatDateLocal(cur);
        if (!result.some(([k]) => k === key)) {
          result.push([key, timeSeriesData[key] || 0]);
        }
        cur.setDate(cur.getDate() + 7);
      }
      return result;
    }
    case 'semester':
    case 'year': {
      if (!range) return Object.entries(timeSeriesData).sort(([a], [b]) => a.localeCompare(b));
      const start = new Date(`${range.startDate}T00:00:00`);
      const end = new Date(`${range.endDate}T00:00:00`);
      const result: [string, number][] = [];
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        result.push([key, timeSeriesData[key] || 0]);
        cur.setMonth(cur.getMonth() + 1);
      }
      return result;
    }
    default:
      return Object.entries(timeSeriesData).sort(([a], [b]) => a.localeCompare(b));
  }
}

export function formatCaseTimeSeriesLabel(
  key: string,
  dateFilter: DashboardDateFilter
): string {
  if (dateFilter === 'month') {
    const d = new Date(`${key}T00:00:00`);
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }
  if (dateFilter === 'quarter') {
    const d = new Date(`${key}T00:00:00`);
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`;
  }
  const [y, m] = key.split('-');
  const monthDate = new Date(Number(y), Number(m) - 1, 1);
  return monthDate.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
}

export function formatHoursLabel(hours: number): string {
  return formatResolutionDuration(hours);
}
