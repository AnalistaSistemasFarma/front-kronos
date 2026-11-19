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
