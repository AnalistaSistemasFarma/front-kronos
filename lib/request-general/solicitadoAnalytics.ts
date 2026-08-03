import {
  formatTrendChange,
  formatResolutionDuration,
  type ResolutionTrend,
} from '../dashboard/resolutionTimeSeries';
import type { NamedValue, PieSlice, TimeSeriesPoint, TrendPoint } from '../charts/builders';

export type SolicitadoRequestInput = {
  id: number;
  status?: string | null;
  created_at?: string | null;
  date_resolution?: string | null;
  company?: string | null;
  process?: string | null;
  category?: string | null;
  requester?: string | null;
};

export type SolicitadoActivityInput = {
  id: number;
  status_task?: string | null;
  start_date?: string | null;
  date_resolution?: string | null;
  company?: string | null;
  process?: string | null;
  category?: string | null;
  task?: string | null;
  subject?: string | null;
};

export type ProcessPersonalStat = {
  name: string;
  count: number;
  avgHours: number | null;
  topCompany: string;
};

export type CompanyPersonalStat = {
  name: string;
  count: number;
  pct: number;
};

export type TimeTrendSummary = {
  points: TrendPoint[];
  overallAvgHours: number | null;
  latestTrend: ResolutionTrend | null;
  latestChangeLabel: string | null;
  sampleCount: number;
};

export type PersonalProcesosAnalytics = {
  kpis: {
    total: number;
    abierto: number;
    enProgreso: number;
    resuelto: number;
    cancelado: number;
    myAvgHours: number | null;
    cadenceDays: number | null;
    topCompany: string | null;
    topProcess: string | null;
  };
  /** Mi tiempo promedio por tipo de proceso (finalizados). */
  avgHoursByProcess: NamedValue[];
  /** Cuántos procesos de cada tipo me llegan. */
  countByProcess: NamedValue[];
  /** Empresas que más me solicitan. */
  byCompany: CompanyPersonalStat[];
  companyPie: PieSlice[];
  /** Procesos más repetitivos + empresa dominante. */
  topProcesses: ProcessPersonalStat[];
  /** Frecuencia: cuántos me llegan por periodo. */
  frequency: TimeSeriesPoint[];
  myResolutionTrend: TimeTrendSummary;
};

export type PersonalActividadesAnalytics = {
  kpis: {
    total: number;
    abierto: number;
    enProgreso: number;
    resuelto: number;
    cancelado: number;
    myAvgHours: number | null;
    cadenceDays: number | null;
    topProcess: string | null;
    topCompany: string | null;
  };
  avgHoursByProcess: NamedValue[];
  countByProcess: NamedValue[];
  byCompany: CompanyPersonalStat[];
  companyPie: PieSlice[];
  frequency: TimeSeriesPoint[];
  myResolutionTrend: TimeTrendSummary;
};

type BucketMode = 'day' | 'week' | 'month';

const PROCESS_COLORS = [
  '#0ea5e9',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#ef4444',
  '#6366f1',
  '#84cc16',
  '#f97316',
];

/** Colores distintivos por tipo de gráfica personal. */
export const PERSONAL_CHART_ACCENTS = {
  frequencyProcesos: '#0ea5e9',
  frequencyActividades: '#a855f7',
  volumeBars: PROCESS_COLORS,
  timeBars: PROCESS_COLORS,
  companyPie: PROCESS_COLORS,
} as const;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
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
  if (mode === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

function statusKind(
  status?: string | null
): 'abierto' | 'enProgreso' | 'resuelto' | 'cancelado' | 'otros' {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('cancel')) return 'cancelado';
  if (
    s.includes('resuelt') ||
    s.includes('complet') ||
    s.includes('cerrad') ||
    s.includes('finaliz')
  ) {
    return 'resuelto';
  }
  if (s.includes('abiert') || s.includes('sin empezar')) return 'abierto';
  if (s.includes('progreso') || s.includes('proceso')) return 'enProgreso';
  return 'otros';
}

const MAX_HOURS = 365 * 24;

function hoursBetween(start: Date, end: Date): number | null {
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;
  const hours = ms / 3_600_000;
  if (hours > MAX_HOURS) return null;
  return hours;
}

function emptyTimeTrend(): TimeTrendSummary {
  return {
    points: [],
    overallAvgHours: null,
    latestTrend: null,
    latestChangeLabel: null,
    sampleCount: 0,
  };
}

function buildTimeTrend(items: { hours: number; at: Date }[]): TimeTrendSummary {
  if (items.length === 0) return emptyTimeTrend();

  const mode = chooseBucketMode(items.map((i) => i.at));
  const buckets = new Map<string, { hours: number[]; start: Date }>();

  for (const item of items) {
    const start = bucketStart(item.at, mode);
    const key = formatDateKey(start);
    const existing = buckets.get(key);
    if (existing) existing.hours.push(item.hours);
    else buckets.set(key, { hours: [item.hours], start });
  }

  const sorted = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  let prevAvg: number | null = null;
  const points: TrendPoint[] = [];

  for (const [, bucket] of sorted) {
    const avg = bucket.hours.reduce((s, h) => s + h, 0) / bucket.hours.length;
    const { changePct, changeLabel } = formatTrendChange(avg, prevAvg);
    points.push({
      period: formatBucketLabel(bucket.start, mode),
      tiempo: Number(avg.toFixed(2)),
      tareas: bucket.hours.length,
      changePct,
      changeLabel,
    });
    prevAvg = avg;
  }

  const allHours = items.map((i) => i.hours);
  const overallAvgHours = allHours.reduce((s, h) => s + h, 0) / allHours.length;
  const last = points[points.length - 1];

  return {
    points,
    overallAvgHours,
    latestTrend:
      last?.changePct == null
        ? null
        : last.changePct > 0.5
          ? 'up'
          : last.changePct < -0.5
            ? 'down'
            : 'flat',
    latestChangeLabel: last?.changeLabel ?? null,
    sampleCount: items.length,
  };
}

function computeCadenceDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const spanMs = sorted[sorted.length - 1].getTime() - sorted[0].getTime();
  const spanDays = spanMs / 86_400_000;
  if (spanDays <= 0) return null;
  return Number((spanDays / (sorted.length - 1)).toFixed(1));
}

function buildFrequency(dates: Date[]): TimeSeriesPoint[] {
  if (dates.length === 0) return [];
  const mode = chooseBucketMode(dates);
  const map = new Map<string, { label: string; value: number; key: string }>();

  for (const date of dates) {
    const start = bucketStart(date, mode);
    const key = formatDateKey(start);
    const existing = map.get(key);
    if (existing) existing.value += 1;
    else map.set(key, { label: formatBucketLabel(start, mode), value: 1, key });
  }

  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ label, value }) => ({ label, value }));
}

function topKey(map: Map<string, number>): string | null {
  let best: string | null = null;
  let max = -1;
  for (const [k, v] of map) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

export function buildPersonalProcesosAnalytics(
  requests: SolicitadoRequestInput[]
): PersonalProcesosAnalytics {
  let abierto = 0;
  let enProgreso = 0;
  let resuelto = 0;
  let cancelado = 0;

  const resolutionItems: { hours: number; at: Date; process: string }[] = [];
  const createdDates: Date[] = [];
  const processCounts = new Map<string, number>();
  const processHours = new Map<string, number[]>();
  const processCompany = new Map<string, Map<string, number>>();
  const companyCounts = new Map<string, number>();

  for (const r of requests) {
    const kind = statusKind(r.status);
    if (kind === 'abierto') abierto += 1;
    else if (kind === 'enProgreso') enProgreso += 1;
    else if (kind === 'resuelto') resuelto += 1;
    else if (kind === 'cancelado') cancelado += 1;

    const process = (r.process || 'Sin proceso').trim() || 'Sin proceso';
    const company = (r.company || 'Sin empresa').trim() || 'Sin empresa';

    processCounts.set(process, (processCounts.get(process) ?? 0) + 1);
    companyCounts.set(company, (companyCounts.get(company) ?? 0) + 1);

    const pc = processCompany.get(process) ?? new Map<string, number>();
    pc.set(company, (pc.get(company) ?? 0) + 1);
    processCompany.set(process, pc);

    const created = parseDate(r.created_at);
    if (created) createdDates.push(created);

    const ended = parseDate(r.date_resolution);
    if (created && ended && kind === 'resuelto') {
      const hours = hoursBetween(created, ended);
      if (hours != null) {
        resolutionItems.push({ hours, at: ended, process });
        const list = processHours.get(process) ?? [];
        list.push(hours);
        processHours.set(process, list);
      }
    }
  }

  const myResolutionTrend = buildTimeTrend(
    resolutionItems.map(({ hours, at }) => ({ hours, at }))
  );

  const avgHoursByProcess: NamedValue[] = [...processHours.entries()]
    .map(([name, hours]) => ({
      name,
      value: Number((hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(2)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const countByProcess: NamedValue[] = [...processCounts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const total = requests.length || 1;
  const byCompany: CompanyPersonalStat[] = [...companyCounts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const companyPie: PieSlice[] = byCompany.slice(0, 6).map((c, i) => ({
    name: c.name,
    value: c.count,
    color: PROCESS_COLORS[i % PROCESS_COLORS.length],
  }));

  const topProcesses: ProcessPersonalStat[] = [...processCounts.entries()]
    .map(([name, count]) => {
      const hours = processHours.get(name);
      const companies = processCompany.get(name);
      return {
        name,
        count,
        avgHours:
          hours && hours.length > 0
            ? Number((hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(2))
            : null,
        topCompany: companies ? topKey(companies) ?? '—' : '—',
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    kpis: {
      total: requests.length,
      abierto,
      enProgreso,
      resuelto,
      cancelado,
      myAvgHours: myResolutionTrend.overallAvgHours,
      cadenceDays: computeCadenceDays(createdDates),
      topCompany: topKey(companyCounts),
      topProcess: topKey(processCounts),
    },
    avgHoursByProcess,
    countByProcess,
    byCompany,
    companyPie,
    topProcesses,
    frequency: buildFrequency(createdDates),
    myResolutionTrend,
  };
}

export function buildPersonalActividadesAnalytics(
  activities: SolicitadoActivityInput[]
): PersonalActividadesAnalytics {
  let abierto = 0;
  let enProgreso = 0;
  let resuelto = 0;
  let cancelado = 0;

  const resolutionItems: { hours: number; at: Date }[] = [];
  const startDates: Date[] = [];
  const processCounts = new Map<string, number>();
  const processHours = new Map<string, number[]>();
  const companyCounts = new Map<string, number>();

  for (const a of activities) {
    const kind = statusKind(a.status_task);
    if (kind === 'abierto') abierto += 1;
    else if (kind === 'enProgreso') enProgreso += 1;
    else if (kind === 'resuelto') resuelto += 1;
    else if (kind === 'cancelado') cancelado += 1;

    const process = (a.process || 'Sin proceso').trim() || 'Sin proceso';
    const company = (a.company || 'Sin empresa').trim() || 'Sin empresa';
    processCounts.set(process, (processCounts.get(process) ?? 0) + 1);
    companyCounts.set(company, (companyCounts.get(company) ?? 0) + 1);

    const start = parseDate(a.start_date);
    if (start) startDates.push(start);

    const end = parseDate(a.date_resolution);
    if (start && end && (kind === 'resuelto' || kind === 'cancelado')) {
      const hours = hoursBetween(start, end);
      if (hours != null) {
        resolutionItems.push({ hours, at: end });
        const list = processHours.get(process) ?? [];
        list.push(hours);
        processHours.set(process, list);
      }
    }
  }

  const myResolutionTrend = buildTimeTrend(resolutionItems);

  const avgHoursByProcess: NamedValue[] = [...processHours.entries()]
    .map(([name, hours]) => ({
      name,
      value: Number((hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(2)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const countByProcess: NamedValue[] = [...processCounts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const total = activities.length || 1;
  const byCompany: CompanyPersonalStat[] = [...companyCounts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const companyPie: PieSlice[] = byCompany.slice(0, 6).map((c, i) => ({
    name: c.name,
    value: c.count,
    color: PROCESS_COLORS[i % PROCESS_COLORS.length],
  }));

  return {
    kpis: {
      total: activities.length,
      abierto,
      enProgreso,
      resuelto,
      cancelado,
      myAvgHours: myResolutionTrend.overallAvgHours,
      cadenceDays: computeCadenceDays(startDates),
      topProcess: topKey(processCounts),
      topCompany: topKey(companyCounts),
    },
    avgHoursByProcess,
    countByProcess,
    byCompany,
    companyPie,
    frequency: buildFrequency(startDates),
    myResolutionTrend,
  };
}

export { formatResolutionDuration, PROCESS_COLORS };
