import type { TicketStackedRow } from '../charts/builders';
import {
  getDashboardDateRange,
  parseCalendarDate,
  type DashboardDateFilter,
} from './dateRange';
import {
  buildCaseCreationTimeSeries,
  buildCompleteCaseTimeSeries,
  countByStatus,
  formatCaseTimeSeriesLabel,
  getCompanyLabel,
  normalizeTicketStatus,
  type HelpDeskCase,
  type TicketStatusCounts,
} from './ticketAnalytics';

export const ALL_CATEGORIES_VALUE = '__all_categories__';
export const ALL_COMPANIES_VALUE = '__all_companies__';

export function getCategoryLabel(c: HelpDeskCase): string {
  const name = c.category?.trim();
  return name && name.length > 0 ? name : 'Sin categoría';
}

export function getSubcategoryLabel(c: HelpDeskCase): string {
  const name = c.subcategory?.trim();
  return name && name.length > 0 ? name : 'Sin subcategoría';
}

export function listCategories(cases: HelpDeskCase[]): string[] {
  const names = new Set(cases.map(getCategoryLabel));
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
}

export function listCompanies(cases: HelpDeskCase[]): string[] {
  const names = new Set(cases.map(getCompanyLabel));
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
}

export function filterCasesByCategory(
  cases: HelpDeskCase[],
  category: string
): HelpDeskCase[] {
  if (category === ALL_CATEGORIES_VALUE) return cases;
  return cases.filter((c) => getCategoryLabel(c) === category);
}

export function filterCasesByCompany(
  cases: HelpDeskCase[],
  company: string
): HelpDeskCase[] {
  if (company === ALL_COMPANIES_VALUE) return cases;
  return cases.filter((c) => getCompanyLabel(c) === company);
}

export function aggregateCountByField(
  cases: HelpDeskCase[],
  getLabel: (c: HelpDeskCase) => string,
  limit = 12
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const c of cases) {
    const label = getLabel(c);
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export interface CategoryCompanyRow {
  category: string;
  company: string;
  total: number;
  counts: TicketStatusCounts;
  avgIntervalDays: number | null;
  lastTicketDate: Date | null;
}

export function buildCategoryCompanyRows(
  cases: HelpDeskCase[],
  limit = 20
): CategoryCompanyRow[] {
  const groups = new Map<string, HelpDeskCase[]>();

  for (const c of cases) {
    const key = `${getCategoryLabel(c)}|||${getCompanyLabel(c)}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const [category, company] = key.split('|||');
      const dates = list
        .map((c) => parseCalendarDate(c.creation_date))
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime());

      return {
        category,
        company,
        total: list.length,
        counts: countByStatus(list),
        avgIntervalDays: computeAverageIntervalDays(list),
        lastTicketDate: dates[0] ?? null,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function computeAverageIntervalDays(cases: HelpDeskCase[]): number | null {
  const dates = cases
    .map((c) => parseCalendarDate(c.creation_date))
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return null;

  let totalDays = 0;
  for (let i = 1; i < dates.length; i++) {
    totalDays += (dates[i]!.getTime() - dates[i - 1]!.getTime()) / 86_400_000;
  }
  return totalDays / (dates.length - 1);
}

export function formatIntervalLabel(days: number | null): string {
  if (days == null) return '—';
  if (days < 1) return 'Menos de 1 día';
  if (days < 7) return `${Math.round(days)} días`;
  if (days < 30) return `${(days / 7).toFixed(1)} semanas`;
  if (days < 365) return `${(days / 30).toFixed(1)} meses`;
  return `${(days / 365).toFixed(1)} años`;
}

export interface EntityFrequencyMetric {
  name: string;
  total: number;
  avgIntervalDays: number | null;
  openBacklog: number;
  counts: TicketStatusCounts;
}

export function buildCompanyFrequencyMetrics(
  cases: HelpDeskCase[],
  limit = 10
): EntityFrequencyMetric[] {
  const byCompany = new Map<string, HelpDeskCase[]>();
  for (const c of cases) {
    const company = getCompanyLabel(c);
    const list = byCompany.get(company) ?? [];
    list.push(c);
    byCompany.set(company, list);
  }

  return [...byCompany.entries()]
    .map(([name, list]) => {
      const counts = countByStatus(list);
      return {
        name,
        total: counts.total,
        avgIntervalDays: computeAverageIntervalDays(list),
        openBacklog: counts.abierto + counts.enProgreso,
        counts,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function buildCategoryFrequencyMetrics(
  cases: HelpDeskCase[],
  limit = 10
): EntityFrequencyMetric[] {
  const byCategory = new Map<string, HelpDeskCase[]>();
  for (const c of cases) {
    const category = getCategoryLabel(c);
    const list = byCategory.get(category) ?? [];
    list.push(c);
    byCategory.set(category, list);
  }

  return [...byCategory.entries()]
    .map(([name, list]) => {
      const counts = countByStatus(list);
      return {
        name,
        total: counts.total,
        avgIntervalDays: computeAverageIntervalDays(list),
        openBacklog: counts.abierto + counts.enProgreso,
        counts,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function buildStatusStackedRowsByLabel(
  cases: HelpDeskCase[],
  getLabel: (c: HelpDeskCase) => string,
  limit = 10
): TicketStackedRow[] {
  const groups = new Map<string, HelpDeskCase[]>();
  for (const c of cases) {
    const label = getLabel(c);
    const list = groups.get(label) ?? [];
    list.push(c);
    groups.set(label, list);
  }

  return [...groups.entries()]
    .map(([label, list]) => {
      const counts = countByStatus(list);
      return {
        tecnico: label,
        Abierto: counts.abierto,
        'En progreso': counts.enProgreso,
        Resuelto: counts.resuelto,
        Cerrado: counts.cerrado,
      };
    })
    .sort(
      (a, b) =>
        b.Abierto +
        b['En progreso'] +
        b.Resuelto +
        b.Cerrado -
        (a.Abierto + a['En progreso'] + a.Resuelto + a.Cerrado)
    )
    .slice(0, limit);
}

export function buildScopedCreationTimeSeries(
  cases: HelpDeskCase[],
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date
): { label: string; value: number }[] {
  const raw = buildCaseCreationTimeSeries(cases, dateFilter, selectedMonthDate);
  return buildCompleteCaseTimeSeries(cases, raw, dateFilter, selectedMonthDate).map(
    ([key, count]) => ({
      label: formatCaseTimeSeriesLabel(key, dateFilter),
      value: count,
    })
  );
}

export function buildMultiSeriesByCompany(
  cases: HelpDeskCase[],
  dateFilter: DashboardDateFilter,
  selectedMonthDate: Date,
  maxCompanies = 6
): { periodLabels: string[]; series: { name: string; values: number[] }[] } | null {
  const topCompanies = aggregateCountByField(cases, getCompanyLabel, maxCompanies);
  if (topCompanies.length === 0) return null;

  const totalRaw = buildCaseCreationTimeSeries(cases, dateFilter, selectedMonthDate);
  const timeline = buildCompleteCaseTimeSeries(
    cases,
    totalRaw,
    dateFilter,
    selectedMonthDate
  );
  if (timeline.length === 0) return null;

  const keys = timeline.map(([key]) => key);
  const periodLabels = keys.map((key) => formatCaseTimeSeriesLabel(key, dateFilter));

  const series = topCompanies.map(({ name }) => {
    const companyCases = cases.filter((c) => getCompanyLabel(c) === name);
    const raw = buildCaseCreationTimeSeries(companyCases, dateFilter, selectedMonthDate);
    return {
      name,
      values: keys.map((key) => raw[key] || 0),
    };
  });

  return { periodLabels, series };
}

export function computeCategoryCompanySummary(cases: HelpDeskCase[]) {
  const counts = countByStatus(cases);
  const categories = new Set(cases.map(getCategoryLabel));
  const companies = new Set(cases.map(getCompanyLabel));
  const avgInterval = computeAverageIntervalDays(cases);
  const range = getDashboardDateRange('month', new Date());

  return {
    counts,
    categoryCount: categories.size,
    companyCount: companies.size,
    avgIntervalDays: avgInterval,
    openBacklog: counts.abierto + counts.enProgreso,
    closedRate:
      counts.total > 0 ? ((counts.resuelto + counts.cerrado) / counts.total) * 100 : 0,
    range,
  };
}

export function statusPercentages(counts: TicketStatusCounts) {
  const total = counts.total || 1;
  return {
    abierto: (counts.abierto / total) * 100,
    enProgreso: (counts.enProgreso / total) * 100,
    resuelto: (counts.resuelto / total) * 100,
    cerrado: (counts.cerrado / total) * 100,
  };
}

export function normalizeStatusBucket(c: HelpDeskCase) {
  return normalizeTicketStatus(c.status, c.id_status_case);
}
