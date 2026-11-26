import { UNASSIGNED_ID } from './constants';

/** One compact row per asset, as loaded by lib/it-dashboard/db.ts. */
export interface ItAssetRow {
  id: number;
  companyId: number | null;
  company: string | null;
  typeId: number | null;
  type: string | null;
  statusId: number | null;
  status: string | null;
  cost: number | string | null;
}

export interface CatalogItem {
  id: number;
  name: string;
}

export interface CountedItem extends CatalogItem {
  total: number;
}

export interface NamedCount {
  name: string;
  total: number;
}

export interface ItDashboardFilters {
  /** null = every company. UNASSIGNED_ID = assets without company. */
  companyId: number | null;
  /** When false, assets in status «Baja» are left out. */
  includeRetired: boolean;
}

export interface ItDashboardKpis {
  total: number;
  inUse: number;
  stock: number;
  onLoan: number;
  retired: number;
  otherStatus: number;
  totalCost: number;
}

export interface ItDashboardData {
  filters: ItDashboardFilters;
  /** Left panel: every company with its asset count (company filter not applied). */
  companies: CountedItem[];
  /** Count of all assets (company filter not applied), for «Todas las empresas». */
  allCompaniesTotal: number;
  /** Right panel: every asset type of the catalogue, with the count of the selected company. */
  types: CountedItem[];
  byStatus: NamedCount[];
  kpis: ItDashboardKpis;
}

export type StatusKey = 'inUse' | 'stock' | 'onLoan' | 'retired' | 'other';

function normalize(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Clean label: trims and collapses whitespace (some catalogue values end in spaces or CR/LF). */
export function cleanLabel(text: string | null | undefined, fallback: string): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  return value || fallback;
}

/** Maps the status_asset text (En uso, Stock, En prestamo, Baja) to a stable key. */
export function statusKey(status: string | null | undefined): StatusKey {
  const s = normalize(status);
  if (s === 'en uso') return 'inUse';
  if (s === 'stock') return 'stock';
  if (s === 'en prestamo') return 'onLoan';
  if (s === 'baja' || s === 'de baja' || s === 'dado de baja') return 'retired';
  return 'other';
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePositiveInt(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** ?company=<id|0>&includeRetired=1 */
export function parseItDashboardFilters(params: URLSearchParams): ItDashboardFilters {
  const flag = (params.get('includeRetired') ?? '').trim().toLowerCase();
  return {
    companyId: parsePositiveInt(params.get('company')),
    includeRetired: flag === '1' || flag === 'true',
  };
}

/** ?type=<id|0> for the drill-down list. */
export function parseTypeFilter(params: URLSearchParams): number | null {
  return parsePositiveInt(params.get('type'));
}

const byTotalThenName = (a: CountedItem, b: CountedItem) =>
  b.total - a.total || a.name.localeCompare(b.name, 'es');

export function aggregateItDashboard(
  rows: ItAssetRow[],
  catalog: { companies: CatalogItem[]; types: CatalogItem[] },
  filters: ItDashboardFilters
): ItDashboardData {
  const visible = filters.includeRetired ? rows : rows.filter((r) => statusKey(r.status) !== 'retired');

  // Left panel: every company of the catalogue, counted over all visible assets.
  const companyCounts = new Map<number, number>();
  for (const r of visible) {
    const id = r.companyId ?? UNASSIGNED_ID;
    companyCounts.set(id, (companyCounts.get(id) ?? 0) + 1);
  }
  const companies: CountedItem[] = catalog.companies.map((c) => ({
    id: c.id,
    name: cleanLabel(c.name, `Empresa ${c.id}`),
    total: companyCounts.get(c.id) ?? 0,
  }));
  const unassignedCompany = companyCounts.get(UNASSIGNED_ID) ?? 0;
  if (unassignedCompany > 0) companies.push({ id: UNASSIGNED_ID, name: 'Sin empresa', total: unassignedCompany });
  companies.sort(byTotalThenName);

  // Everything else uses the selected company.
  const scoped =
    filters.companyId == null
      ? visible
      : visible.filter((r) => (r.companyId ?? UNASSIGNED_ID) === filters.companyId);

  const typeCounts = new Map<number, number>();
  const statusCounts = new Map<string, number>();
  const kpis: ItDashboardKpis = {
    total: scoped.length,
    inUse: 0,
    stock: 0,
    onLoan: 0,
    retired: 0,
    otherStatus: 0,
    totalCost: 0,
  };

  for (const r of scoped) {
    const typeId = r.typeId ?? UNASSIGNED_ID;
    typeCounts.set(typeId, (typeCounts.get(typeId) ?? 0) + 1);

    const statusName = cleanLabel(r.status, 'Sin estado');
    statusCounts.set(statusName, (statusCounts.get(statusName) ?? 0) + 1);

    switch (statusKey(r.status)) {
      case 'inUse':
        kpis.inUse += 1;
        break;
      case 'stock':
        kpis.stock += 1;
        break;
      case 'onLoan':
        kpis.onLoan += 1;
        break;
      case 'retired':
        kpis.retired += 1;
        break;
      default:
        kpis.otherStatus += 1;
    }
    kpis.totalCost += toNumber(r.cost);
  }

  const types: CountedItem[] = catalog.types.map((t) => ({
    id: t.id,
    name: cleanLabel(t.name, `Tipo ${t.id}`),
    total: typeCounts.get(t.id) ?? 0,
  }));
  const unassignedType = typeCounts.get(UNASSIGNED_ID) ?? 0;
  if (unassignedType > 0) types.push({ id: UNASSIGNED_ID, name: 'Sin tipo', total: unassignedType });
  types.sort(byTotalThenName);

  const byStatus = [...statusCounts.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));

  return {
    filters,
    companies,
    allCompaniesTotal: visible.length,
    types,
    byStatus,
    kpis,
  };
}

/** «COMPUTADORES» / «ACCESS_POINT» → «Computadores» / «Access point». */
export function formatTypeName(name: string): string {
  const clean = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
  if (clean !== clean.toUpperCase()) return clean;
  const lower = clean.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
