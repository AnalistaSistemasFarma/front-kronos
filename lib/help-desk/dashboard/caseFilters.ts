import type { HelpdeskCaseDetail } from './aggregate';

/**
 * Column filters of the Dashboard Helpdesk case preview (pure, client side).
 * One filter per table header; every active filter must match (AND).
 */
export interface CaseColumnFilters {
  /** Free text over every column (the search box). */
  search: string;
  /** Case number: contains. */
  id: string;
  /** Subject (and department / type shown under it): contains. */
  subject: string;
  status: string[];
  company: string[];
  technician: string[];
  category: string[];
  subcategory: string[];
  activity: string[];
  /** YYYY-MM-DD, inclusive. */
  createdFrom: string;
  createdTo: string;
  /** Closing date. */
  closed: 'all' | 'with' | 'without';
  /** Resolution days, inclusive; '' = no limit. */
  daysMin: string;
  daysMax: string;
}

export const EMPTY_CASE_FILTERS: CaseColumnFilters = {
  search: '',
  id: '',
  subject: '',
  status: [],
  company: [],
  technician: [],
  category: [],
  subcategory: [],
  activity: [],
  createdFrom: '',
  createdTo: '',
  closed: 'all',
  daysMin: '',
  daysMax: '',
};

/** Lowercase without accents, for "contains" comparisons. */
export function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
}

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Number of active filters (the search box included). */
export function countActiveFilters(f: CaseColumnFilters): number {
  return [
    f.search.trim() !== '',
    f.id.trim() !== '',
    f.subject.trim() !== '',
    f.status.length > 0,
    f.company.length > 0,
    f.technician.length > 0,
    f.category.length > 0,
    f.subcategory.length > 0,
    f.activity.length > 0,
    f.createdFrom !== '' || f.createdTo !== '',
    f.closed !== 'all',
    toNumber(f.daysMin) != null || toNumber(f.daysMax) != null,
  ].filter(Boolean).length;
}

export function matchesCaseFilters(c: HelpdeskCaseDetail, f: CaseColumnFilters): boolean {
  const search = normalizeText(f.search);
  if (search) {
    const haystack = normalizeText(
      [c.id, c.subject, c.status, c.company, c.department, c.caseType, c.technician, c.category, c.subcategory, c.activity].join(' ')
    );
    if (!haystack.includes(search)) return false;
  }

  const id = f.id.trim();
  if (id && !String(c.id).includes(id)) return false;

  const subject = normalizeText(f.subject);
  if (subject && !normalizeText(`${c.subject} ${c.department} ${c.caseType}`).includes(subject)) return false;

  if (f.status.length > 0 && !f.status.includes(c.status)) return false;
  if (f.company.length > 0 && !f.company.includes(c.company)) return false;
  if (f.technician.length > 0 && !f.technician.includes(c.technician)) return false;
  if (f.category.length > 0 && !f.category.includes(c.category)) return false;
  if (f.subcategory.length > 0 && !f.subcategory.includes(c.subcategory)) return false;
  if (f.activity.length > 0 && !f.activity.includes(c.activity)) return false;

  // ISO dates (YYYY-MM-DD) compare correctly as strings.
  if (f.createdFrom && (!c.createdAt || c.createdAt < f.createdFrom)) return false;
  if (f.createdTo && (!c.createdAt || c.createdAt > f.createdTo)) return false;

  if (f.closed === 'with' && !c.endDate) return false;
  if (f.closed === 'without' && c.endDate) return false;

  const min = toNumber(f.daysMin);
  const max = toNumber(f.daysMax);
  if (min != null || max != null) {
    if (c.resolutionDays == null) return false;
    if (min != null && c.resolutionDays < min) return false;
    if (max != null && c.resolutionDays > max) return false;
  }

  return true;
}

export function filterCaseDetails(cases: HelpdeskCaseDetail[], f: CaseColumnFilters): HelpdeskCaseDetail[] {
  return cases.filter((c) => matchesCaseFilters(c, f));
}

/** One category · subcategory · activity combination and how many cases have it. */
export interface CaseCombination {
  category: string;
  subcategory: string;
  activity: string;
  total: number;
  /** Share of the cases given, 0-100. */
  percent: number;
}

export type CombinationOrder = 'most' | 'least';

/**
 * Ranks the category · subcategory · activity combinations of the given cases.
 * 'most' = most repeated first; 'least' = least repeated first. Ties keep a stable
 * alphabetical order so the list does not jump around.
 */
export function rankCombinations(
  cases: HelpdeskCaseDetail[],
  order: CombinationOrder = 'most',
  limit = 10
): CaseCombination[] {
  const map = new Map<string, CaseCombination>();
  for (const c of cases) {
    const key = `${c.category}\u0000${c.subcategory}\u0000${c.activity}`;
    const entry = map.get(key) ?? { category: c.category, subcategory: c.subcategory, activity: c.activity, total: 0, percent: 0 };
    entry.total += 1;
    map.set(key, entry);
  }
  const total = cases.length || 1;
  const label = (x: CaseCombination) => `${x.category} ${x.subcategory} ${x.activity}`;
  return [...map.values()]
    .map((x) => ({ ...x, percent: Math.round((x.total / total) * 1000) / 10 }))
    .sort((a, b) => (order === 'most' ? b.total - a.total : a.total - b.total) || label(a).localeCompare(label(b), 'es'))
    .slice(0, limit);
}

/** The same filters without category / subcategory / activity (the base of the ranking). */
export function withoutCombination(f: CaseColumnFilters): CaseColumnFilters {
  return { ...f, category: [], subcategory: [], activity: [] };
}

/** True when the filters select exactly this combination (one value in each of the three columns). */
export function isSelectedCombination(f: CaseColumnFilters, r: Pick<CaseCombination, 'category' | 'subcategory' | 'activity'>): boolean {
  return (
    f.category.length === 1 &&
    f.subcategory.length === 1 &&
    f.activity.length === 1 &&
    f.category[0] === r.category &&
    f.subcategory[0] === r.subcategory &&
    f.activity[0] === r.activity
  );
}

/**
 * Click on a ranking row: selects that combination, or removes it when it was
 * already selected (back to the full list). Other filters are kept.
 */
export function toggleCombination(
  f: CaseColumnFilters,
  r: Pick<CaseCombination, 'category' | 'subcategory' | 'activity'>
): CaseColumnFilters {
  if (isSelectedCombination(f, r)) return withoutCombination(f);
  return { ...f, category: [r.category], subcategory: [r.subcategory], activity: [r.activity] };
}

/** Distinct values of a column, sorted, for the select filters. */
export function distinctValues(
  cases: HelpdeskCaseDetail[],
  pick: (c: HelpdeskCaseDetail) => string
): string[] {
  return [...new Set(cases.map(pick))].sort((a, b) => a.localeCompare(b, 'es'));
}
