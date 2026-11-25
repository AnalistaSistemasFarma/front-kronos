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

/** Distinct values of a column, sorted, for the select filters. */
export function distinctValues(
  cases: HelpdeskCaseDetail[],
  pick: (c: HelpdeskCaseDetail) => string
): string[] {
  return [...new Set(cases.map(pick))].sort((a, b) => a.localeCompare(b, 'es'));
}
