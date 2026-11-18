import { CASE_STATUS_CANCELLED, CASE_STATUS_RESOLVED } from './constants';

/**
 * Dashboard Helpdesk: pure aggregation of help desk cases (no DB, no network).
 *
 * The API route loads one compact row per case and this module turns them into
 * the counts the page shows. Only aggregates leave the server.
 */

/** One help desk case, as loaded by lib/help-desk/dashboard/db.ts. */
export interface HelpdeskCaseRow {
  id: number;
  createdAt: Date | string | null;
  endDate: Date | string | null;
  statusId: number | null;
  status: string | null;
  caseType: string | null;
  companyId: number | null;
  company: string | null;
  department: string | null;
  technician: string | null;
  category: string | null;
  subcategory: string | null;
  activity: string | null;
}

export interface HelpdeskDashboardFilters {
  companyId?: number;
  year?: number;
  /** 1-12. Only applied together with `year`. */
  month?: number;
}

export interface NamedCount {
  name: string;
  total: number;
}

export interface MonthCount {
  /** YYYY-MM */
  key: string;
  /** e.g. "nov 2025" */
  label: string;
  total: number;
}

export interface HelpdeskDashboardKpis {
  total: number;
  resolved: number;
  cancelled: number;
  pending: number;
  /** Average days from creation to end_date, only resolved cases WITH end_date. */
  avgResolutionDays: number | null;
  resolvedWithEndDate: number;
  resolvedWithoutEndDate: number;
}

export interface HelpdeskDashboardData {
  /** Whole history (ignores filters): first and last case dates, YYYY-MM-DD. */
  firstCaseDate: string | null;
  lastCaseDate: string | null;
  filters: HelpdeskDashboardFilters;
  filterOptions: {
    companies: { id: number; name: string; total: number }[];
    years: number[];
  };
  kpis: HelpdeskDashboardKpis;
  byMonth: MonthCount[];
  byStatus: NamedCount[];
  byType: NamedCount[];
  byDepartment: NamedCount[];
  byTechnician: NamedCount[];
  byCategory: NamedCount[];
  bySubcategory: NamedCount[];
  byActivity: NamedCount[];
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MS_PER_DAY = 86_400_000;

/** Trims and removes CR/LF (some catalog names are stored with "\r\n"). */
export function cleanLabel(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** creation_date is a calendar date stored at 00:00 UTC: read it in UTC. */
function yearMonthOf(d: Date): { year: number; month: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return `${MONTHS_ES[month - 1]} ${year}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parses ?company=&year=&month= ignoring invalid values. */
export function parseDashboardFilters(params: URLSearchParams): HelpdeskDashboardFilters {
  const int = (name: string): number | undefined => {
    const raw = params.get(name);
    if (raw == null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) ? n : undefined;
  };

  const filters: HelpdeskDashboardFilters = {};
  const companyId = int('company');
  if (companyId != null && companyId > 0) filters.companyId = companyId;
  const year = int('year');
  if (year != null && year >= 2000 && year <= 2100) filters.year = year;
  const month = int('month');
  if (filters.year != null && month != null && month >= 1 && month <= 12) filters.month = month;
  return filters;
}

export function filterCases(rows: HelpdeskCaseRow[], filters: HelpdeskDashboardFilters): HelpdeskCaseRow[] {
  return rows.filter((row) => {
    if (filters.companyId != null && row.companyId !== filters.companyId) return false;
    if (filters.year != null) {
      const created = toDate(row.createdAt);
      if (!created) return false;
      const { year, month } = yearMonthOf(created);
      if (year !== filters.year) return false;
      if (filters.month != null && month !== filters.month) return false;
    }
    return true;
  });
}

function countBy(rows: HelpdeskCaseRow[], pick: (row: HelpdeskCaseRow) => string): NamedCount[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const name = pick(row);
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));
}

export function computeKpis(rows: HelpdeskCaseRow[]): HelpdeskDashboardKpis {
  let resolved = 0;
  let cancelled = 0;
  let resolvedWithEndDate = 0;
  let resolutionDaysSum = 0;

  for (const row of rows) {
    if (row.statusId === CASE_STATUS_CANCELLED) {
      cancelled += 1;
      continue;
    }
    if (row.statusId !== CASE_STATUS_RESOLVED) continue;
    resolved += 1;

    const created = toDate(row.createdAt);
    const ended = toDate(row.endDate);
    // A resolved case without end_date (or with an end before creation) cannot be measured.
    if (!created || !ended || ended.getTime() < created.getTime()) continue;
    resolvedWithEndDate += 1;
    resolutionDaysSum += (ended.getTime() - created.getTime()) / MS_PER_DAY;
  }

  return {
    total: rows.length,
    resolved,
    cancelled,
    pending: rows.length - resolved - cancelled,
    avgResolutionDays:
      resolvedWithEndDate > 0 ? Math.round((resolutionDaysSum / resolvedWithEndDate) * 10) / 10 : null,
    resolvedWithEndDate,
    resolvedWithoutEndDate: resolved - resolvedWithEndDate,
  };
}

/**
 * Cases per month, with no gaps:
 * - year + month: that single month;
 * - year only: January..December of that year (not past `now`);
 * - no filter: from the first to the last month with cases.
 */
export function buildMonthSeries(
  rows: HelpdeskCaseRow[],
  filters: HelpdeskDashboardFilters,
  now: Date = new Date()
): MonthCount[] {
  const counts = new Map<string, number>();
  let min: { year: number; month: number } | null = null;
  let max: { year: number; month: number } | null = null;

  for (const row of rows) {
    const created = toDate(row.createdAt);
    if (!created) continue;
    const ym = yearMonthOf(created);
    const key = monthKey(ym.year, ym.month);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const ordinal = ym.year * 12 + ym.month;
    if (!min || ordinal < min.year * 12 + min.month) min = ym;
    if (!max || ordinal > max.year * 12 + max.month) max = ym;
  }

  let start: { year: number; month: number } | null;
  let end: { year: number; month: number } | null;
  if (filters.year != null && filters.month != null) {
    start = end = { year: filters.year, month: filters.month };
  } else if (filters.year != null) {
    start = { year: filters.year, month: 1 };
    const current = yearMonthOf(now);
    end = { year: filters.year, month: filters.year === current.year ? current.month : 12 };
  } else {
    start = min;
    end = max;
  }
  if (!start || !end) return [];

  const series: MonthCount[] = [];
  let year = start.year;
  let month = start.month;
  // Guard against absurd ranges (bad data): at most 20 years of months.
  for (let i = 0; i < 240 && year * 12 + month <= end.year * 12 + end.month; i += 1) {
    const key = monthKey(year, month);
    series.push({ key, label: monthLabel(year, month), total: counts.get(key) ?? 0 });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return series;
}

export function aggregateHelpdeskDashboard(
  allRows: HelpdeskCaseRow[],
  filters: HelpdeskDashboardFilters,
  now: Date = new Date()
): HelpdeskDashboardData {
  // Whole-history facts and filter options (independent of the filters).
  let first: Date | null = null;
  let last: Date | null = null;
  const years = new Set<number>();
  const companies = new Map<number, { id: number; name: string; total: number }>();

  for (const row of allRows) {
    const created = toDate(row.createdAt);
    if (created) {
      if (!first || created < first) first = created;
      if (!last || created > last) last = created;
      years.add(yearMonthOf(created).year);
    }
    if (row.companyId != null) {
      const entry = companies.get(row.companyId) ?? {
        id: row.companyId,
        name: cleanLabel(row.company, `Empresa ${row.companyId}`),
        total: 0,
      };
      entry.total += 1;
      companies.set(row.companyId, entry);
    }
  }

  const rows = filterCases(allRows, filters);

  return {
    firstCaseDate: first ? isoDay(first) : null,
    lastCaseDate: last ? isoDay(last) : null,
    filters,
    filterOptions: {
      companies: [...companies.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      years: [...years].sort((a, b) => b - a),
    },
    kpis: computeKpis(rows),
    byMonth: buildMonthSeries(rows, filters, now),
    byStatus: countBy(rows, (r) => cleanLabel(r.status, 'Sin estado')),
    byType: countBy(rows, (r) => cleanLabel(r.caseType, 'Sin tipo')),
    byDepartment: countBy(rows, (r) => cleanLabel(r.department, 'Sin departamento')),
    byTechnician: countBy(rows, (r) => cleanLabel(r.technician, 'Sin técnico asignado')),
    byCategory: countBy(rows, (r) => cleanLabel(r.category, 'Sin categoría')),
    bySubcategory: countBy(rows, (r) => cleanLabel(r.subcategory, 'Sin subcategoría')),
    byActivity: countBy(rows, (r) => cleanLabel(r.activity, 'Sin actividad')),
  };
}
