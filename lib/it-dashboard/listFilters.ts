/**
 * Column filters of the Dashboard TI asset list (the row under the table
 * headers). Pure functions so they can be unit-tested.
 */

export interface AssetListRowLike {
  name: string | null;
  label: string | null;
  serial: string | null;
  model: string | null;
  subtype: string | null;
  user: string | null;
  department: string | null;
  company: string | null;
  status: string | null;
  /** Purchase date (Date or ISO string). */
  purchaseDate?: string | Date | null;
}

export interface AssetColumnFilters {
  name: string;
  label: string;
  serial: string;
  model: string;
  user: string;
  company: string;
  /** Exact subtype («Tipo de equipo», the category of the asset). Empty = all. */
  category: string;
  /** Exact status. Empty = all. */
  status: string;
  /** Purchase year «2025». Empty = all; EMPTY_OPTION = without date. */
  purchaseYear: string;
  /** Purchase month «1»..«12». Empty = all. */
  purchaseMonth: string;
}

export const EMPTY_COLUMN_FILTERS: AssetColumnFilters = {
  name: '',
  label: '',
  serial: '',
  model: '',
  user: '',
  company: '',
  category: '',
  status: '',
  purchaseYear: '',
  purchaseMonth: '',
};

export const MONTH_OPTIONS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
].map((label, i) => ({ value: String(i + 1), label }));

/** Year and month (1-12) of the purchase date, in UTC (dates are stored without time). */
export function purchaseParts(value: string | Date | null | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function matchesPurchase(value: string | Date | null | undefined, year: string, month: string): boolean {
  if (!year && !month) return true;
  const p = purchaseParts(value);
  if (year === EMPTY_OPTION) return p == null;
  if (!p) return false;
  if (year && p.year !== Number(year)) return false;
  if (month && p.month !== Number(month)) return false;
  return true;
}

/** Purchase years present in the rows, newest first (plus «Sin fecha» when some have none). */
export function purchaseYearOptions<T extends AssetListRowLike>(rows: T[]): Array<{ value: string; label: string }> {
  const years = new Set<number>();
  let hasEmpty = false;
  for (const r of rows) {
    const p = purchaseParts(r.purchaseDate);
    if (p) years.add(p.year);
    else hasEmpty = true;
  }
  const options = [...years].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  if (hasEmpty) options.push({ value: EMPTY_OPTION, label: 'Sin fecha' });
  return options;
}

/** Value used for rows with an empty category or status. */
export const EMPTY_OPTION = '__empty__';

function norm(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

function contains(value: string | null | undefined, needle: string): boolean {
  const n = norm(needle);
  return !n || norm(value).includes(n);
}

function matchesOption(value: string | null | undefined, option: string): boolean {
  if (!option) return true;
  if (option === EMPTY_OPTION) return clean(value) === '';
  return clean(value) === option;
}

export function filterAssetRows<T extends AssetListRowLike>(rows: T[], f: AssetColumnFilters): T[] {
  return rows.filter(
    (r) =>
      contains(r.name, f.name) &&
      contains(r.label, f.label) &&
      contains(r.serial, f.serial) &&
      contains(r.model, f.model) &&
      (contains(r.user, f.user) || (Boolean(f.user.trim()) && contains(r.department, f.user))) &&
      contains(r.company, f.company) &&
      matchesOption(r.subtype, f.category) &&
      matchesOption(r.status, f.status) &&
      matchesPurchase(r.purchaseDate, f.purchaseYear, f.purchaseMonth)
  );
}

/** Distinct values of a column, sorted, as Select options (with «Sin dato» when some are empty). */
export function columnOptions<T extends AssetListRowLike>(
  rows: T[],
  key: 'subtype' | 'status'
): Array<{ value: string; label: string }> {
  const values = new Set<string>();
  let hasEmpty = false;
  for (const r of rows) {
    const v = clean(r[key]);
    if (v) values.add(v);
    else hasEmpty = true;
  }
  const options = [...values]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((v) => ({ value: v, label: v }));
  if (hasEmpty) options.push({ value: EMPTY_OPTION, label: 'Sin dato' });
  return options;
}

export function hasActiveFilters(f: AssetColumnFilters): boolean {
  return Object.values(f).some((v) => v.trim() !== '');
}
