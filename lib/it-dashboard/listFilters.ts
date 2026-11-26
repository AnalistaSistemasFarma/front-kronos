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
};

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
      matchesOption(r.status, f.status)
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
