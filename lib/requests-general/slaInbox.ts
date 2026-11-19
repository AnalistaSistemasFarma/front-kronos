/**
 * SLA (ANS) counters of the assigned-requests inbox (hotfix 2026-11-19).
 *
 * The widget must count EXACTLY the items of the «Pendientes» card of the inbox: the open
 * requests of the user's processes/categories AND the open tasks assigned to the user, one
 * item per row, each one in exactly one bucket. A task inherits the SLA state of its
 * request. Items whose request clock is stopped (returned, draft or already closed request)
 * fall in `paused`, so the buckets always add up to the «Pendientes» count.
 *
 * Pure module (no DB): shared by the API (`slaScope.ts`) and the inbox page.
 */
import type { StatusGroup } from './listFilters';
import type { SlaState } from './sla';

export type InboxSlaState = SlaState | 'paused';
export const INBOX_SLA_STATES: InboxSlaState[] = ['overdue', 'near_due', 'on_time', 'no_sla', 'paused'];

export interface InboxSlaItem {
  kind: 'request' | 'task';
  requestId: number | string | null | undefined;
  /** General status group of the row (`statusGroupOf`), the same one the inbox cards use. */
  group: Exclude<StatusGroup, 'all'>;
}

export type InboxSlaCounts = Record<InboxSlaState, number>;
export type InboxSlaBreakdown = Record<InboxSlaState, { requests: number; tasks: number }>;

/** Minimal per-request info needed here (state of the request SLA clock). */
export type SlaStateByRequest = Record<number, { state: SlaState } | undefined>;

/**
 * Bucket of one inbox row, or null when the row is not pending (done, cancelled or
 * returned rows are not part of the widget, same as the «Pendientes» card).
 */
export function inboxItemSlaState(item: InboxSlaItem, byRequest: SlaStateByRequest): InboxSlaState | null {
  if (item.group !== 'pending') return null;
  const info = byRequest[Number(item.requestId)];
  return info ? info.state : 'paused';
}

export const emptyInboxSlaCounts = (): InboxSlaCounts => ({
  overdue: 0,
  near_due: 0,
  on_time: 0,
  no_sla: 0,
  paused: 0,
});

export function countInboxSla(
  items: InboxSlaItem[],
  byRequest: SlaStateByRequest
): { counts: InboxSlaCounts; breakdown: InboxSlaBreakdown; total: number } {
  const counts = emptyInboxSlaCounts();
  const breakdown = Object.fromEntries(
    INBOX_SLA_STATES.map((s) => [s, { requests: 0, tasks: 0 }])
  ) as InboxSlaBreakdown;
  let total = 0;
  for (const item of items) {
    const state = inboxItemSlaState(item, byRequest);
    if (!state) continue;
    counts[state] += 1;
    breakdown[state][item.kind === 'request' ? 'requests' : 'tasks'] += 1;
    total += 1;
  }
  return { counts, breakdown, total };
}

/* ------------------------------------------------------------------------------------------
 * «Vencimiento» sort (hotfix 2026-11-19, msg 36306).
 * Sort key = remaining SLA hours of the row (negative = overdue). Rows without a running SLA
 * (no SLA, paused, or not pending) always go last, whatever the direction. The sort is stable,
 * so rows with the same key keep the list's default order (newest first).
 * ---------------------------------------------------------------------------------------- */

export type DueSort = 'none' | 'due_asc' | 'due_desc';
export const DUE_SORTS: DueSort[] = ['none', 'due_asc', 'due_desc'];

/** Per-request info with the remaining time (what the API returns in `byRequest`). */
export type SlaDueByRequest = Record<number, { state: SlaState; remainingHours: number | null } | undefined>;

/**
 * Remaining SLA hours of an inbox row, or null when the row has no running SLA (no SLA,
 * paused, or a row that is not pending). A task carries the clock of its request.
 */
export function inboxItemRemainingHours(item: InboxSlaItem, byRequest: SlaDueByRequest): number | null {
  const state = inboxItemSlaState(item, byRequest);
  if (state !== 'overdue' && state !== 'near_due' && state !== 'on_time') return null;
  const h = byRequest[Number(item.requestId)]?.remainingHours;
  return typeof h === 'number' && Number.isFinite(h) ? h : null;
}

/** Comparator of two sort keys; null keys go last in both directions. */
export function compareDue(a: number | null, b: number | null, sort: DueSort): number {
  if (sort === 'none') return 0;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return sort === 'due_asc' ? a - b : b - a;
}

/** Stable sort by due time (returns a new array; `none` keeps the input order). */
export function sortByDue<T>(items: readonly T[], keyOf: (item: T) => number | null, sort: DueSort): T[] {
  if (sort === 'none') return [...items];
  return items
    .map((item, index) => ({ item, index, key: keyOf(item) }))
    .sort((x, y) => compareDue(x.key, y.key, sort) || x.index - y.index)
    .map((x) => x.item);
}

/**
 * Default order of a list filtered by an SLA card (hotfix 2026-11-19, msg 36400): «Vencidos»
 * shows the most overdue first and «Próximos a vencer» the soonest due first (both ascending
 * remaining time). Any other card, or no card, keeps the list's default order.
 */
export function dueSortForSlaFilter(slaFilter: InboxSlaState | null | undefined): DueSort {
  return slaFilter === 'overdue' || slaFilter === 'near_due' ? 'due_asc' : 'none';
}

export function parseDueSort(value: unknown): DueSort {
  return typeof value === 'string' && (DUE_SORTS as string[]).includes(value) ? (value as DueSort) : 'none';
}

export function parseInboxSlaState(value: unknown): InboxSlaState | null {
  return typeof value === 'string' && (INBOX_SLA_STATES as string[]).includes(value) ? (value as InboxSlaState) : null;
}

/* ------------------------------------------------------------------------------------------
 * «Solicitudes generales» list (server-paged). The SLA cards, the SLA filter and the due sort
 * run on the server over EXACTLY the rows that list returns for the current filters, with the
 * same functions as the inbox, so a card always shows the rows it filters.
 * ---------------------------------------------------------------------------------------- */

/** Status groups of that list (same as STATUS_GROUP_SQL of the API: everything open is pending). */
export function generalListGroup(statusReq: number): Exclude<StatusGroup, 'all'> {
  if (statusReq === 2) return 'done';
  if (statusReq === 3) return 'cancelled';
  return 'pending';
}

const GENERAL_PENDING = [1, 4, 5, 6, 7];

/** Same semantics as the API `status` param (group name, 'all'/'0', numeric id, empty = open only). */
export function matchesGeneralStatus(statusReq: number, statusKey: string | null | undefined): boolean {
  const key = (statusKey ?? '').trim().toLowerCase();
  if (!key) return statusReq === 1;
  if (key === 'all' || key === '0') return true;
  if (key === 'pending') return GENERAL_PENDING.includes(statusReq);
  if (key === 'done') return statusReq === 2;
  if (key === 'cancelled') return statusReq === 3;
  if (/^\d+$/.test(key)) return statusReq === Number(key);
  return true;
}

export interface GeneralListRow {
  id: number;
  statusReq: number;
}

export interface GeneralSlaPage {
  /** Ids of the requested page, already in display order. */
  pageIds: number[];
  /** Rows after status + SLA filter (pagination total). */
  total: number;
  /** Status cards: SLA filter applied, status ignored (like the inbox). */
  statusCounts: { all: number; pending: number; done: number; cancelled: number };
  /** SLA cards: status and SLA filter ignored. */
  sla: { counts: InboxSlaCounts; breakdown: InboxSlaBreakdown; total: number };
}

/**
 * Filters, sorts and pages the full id list of «Solicitudes generales» (ordered newest first,
 * filters already applied in SQL except status) with the SLA filter and the due sort.
 */
export function pageGeneralList(
  rows: readonly GeneralListRow[],
  byRequest: SlaDueByRequest,
  opts: { statusKey: string | null; slaFilter: InboxSlaState | null; sort: DueSort; page: number; pageSize: number }
): GeneralSlaPage {
  const itemOf = (r: GeneralListRow): InboxSlaItem => ({ kind: 'request', requestId: r.id, group: generalListGroup(r.statusReq) });
  const sla = countInboxSla(rows.map(itemOf), byRequest);
  const slaMatched = opts.slaFilter ? rows.filter((r) => inboxItemSlaState(itemOf(r), byRequest) === opts.slaFilter) : [...rows];
  const statusCounts = { all: slaMatched.length, pending: 0, done: 0, cancelled: 0 };
  for (const r of slaMatched) statusCounts[generalListGroup(r.statusReq) as 'pending' | 'done' | 'cancelled'] += 1;
  const listed = slaMatched.filter((r) => matchesGeneralStatus(r.statusReq, opts.statusKey));
  const sorted = sortByDue(listed, (r) => inboxItemRemainingHours(itemOf(r), byRequest), opts.sort);
  const start = (Math.max(1, opts.page) - 1) * opts.pageSize;
  return { pageIds: sorted.slice(start, start + opts.pageSize).map((r) => r.id), total: listed.length, statusCounts, sla };
}
