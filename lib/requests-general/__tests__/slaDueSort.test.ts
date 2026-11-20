import { describe, expect, it } from 'vitest';
import {
  compareDue,
  inboxItemRemainingHours,
  matchesGeneralStatus,
  dueSortForSlaFilter,
  pageGeneralList,
  parseDueSort,
  parseInboxSlaState,
  sortByDue,
  type SlaDueByRequest,
} from '../slaInbox';
import { formatRemaining } from '../sla';

const byRequest: SlaDueByRequest = {
  1: { state: 'overdue', remainingHours: -40 }, // most overdue
  2: { state: 'overdue', remainingHours: -2 },
  3: { state: 'near_due', remainingHours: 3 },
  4: { state: 'on_time', remainingHours: 50 },
  5: { state: 'no_sla', remainingHours: null },
  // 6: clock stopped (not in the map) → paused
};

describe('inboxItemRemainingHours', () => {
  it('returns the remaining hours of a pending row with a running SLA (tasks use their request)', () => {
    expect(inboxItemRemainingHours({ kind: 'request', requestId: 1, group: 'pending' }, byRequest)).toBe(-40);
    expect(inboxItemRemainingHours({ kind: 'task', requestId: 3, group: 'pending' }, byRequest)).toBe(3);
  });
  it('is null without SLA, when paused and for rows that are not pending', () => {
    expect(inboxItemRemainingHours({ kind: 'request', requestId: 5, group: 'pending' }, byRequest)).toBeNull();
    expect(inboxItemRemainingHours({ kind: 'request', requestId: 6, group: 'pending' }, byRequest)).toBeNull();
    expect(inboxItemRemainingHours({ kind: 'task', requestId: 1, group: 'done' }, byRequest)).toBeNull();
  });
});

describe('sortByDue', () => {
  const rows = [
    { id: 'a', due: null },
    { id: 'b', due: 3 },
    { id: 'c', due: -40 },
    { id: 'd', due: 50 },
    { id: 'e', due: null },
    { id: 'f', due: -2 },
  ];
  const ids = (sort: Parameters<typeof sortByDue>[2]) => sortByDue(rows, (r) => r.due, sort).map((r) => r.id);
  it('asc: most overdue first, rows without SLA last (stable)', () => {
    expect(ids('due_asc')).toEqual(['c', 'f', 'b', 'd', 'a', 'e']);
  });
  it('desc: most remaining time first, rows without SLA still last', () => {
    expect(ids('due_desc')).toEqual(['d', 'b', 'f', 'c', 'a', 'e']);
  });
  it('none keeps the original order and does not mutate the input', () => {
    expect(ids('none')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(rows[0].id).toBe('a');
  });
  it('compareDue puts null last in both directions', () => {
    expect(compareDue(null, 1, 'due_asc')).toBeGreaterThan(0);
    expect(compareDue(null, 1, 'due_desc')).toBeGreaterThan(0);
  });
});

describe('sort state and parsing', () => {
  it('SLA card picks the default order', () => {
    // «Vencidos»: most overdue first; «Próximos a vencer»: soonest due first; others/none: default.
    expect(dueSortForSlaFilter('overdue')).toBe('due_asc');
    expect(dueSortForSlaFilter('near_due')).toBe('due_asc');
    expect(dueSortForSlaFilter('on_time')).toBe('none');
    expect(dueSortForSlaFilter('no_sla')).toBe('none');
    expect(dueSortForSlaFilter('paused')).toBe('none');
    expect(dueSortForSlaFilter(null)).toBe('none');
  });
  it('rejects unknown values', () => {
    expect(parseDueSort('due_asc')).toBe('due_asc');
    expect(parseDueSort('drop table')).toBe('none');
    expect(parseInboxSlaState('overdue')).toBe('overdue');
    expect(parseInboxSlaState('x')).toBeNull();
  });
  it('labels the remaining time the same way on every row', () => {
    expect(formatRemaining(-18)).toBe('Vencida hace 2 d');
    expect(formatRemaining(3)).toBe('Vence en 3 h');
  });
});

describe('matchesGeneralStatus (same semantics as the general-requests API)', () => {
  it('empty = open only; groups; numeric ids; all', () => {
    expect(matchesGeneralStatus(1, '')).toBe(true);
    expect(matchesGeneralStatus(4, null)).toBe(false);
    expect(matchesGeneralStatus(7, 'pending')).toBe(true);
    expect(matchesGeneralStatus(2, 'done')).toBe(true);
    expect(matchesGeneralStatus(3, 'pending')).toBe(false);
    expect(matchesGeneralStatus(7, '7')).toBe(true);
    expect(matchesGeneralStatus(3, 'all')).toBe(true);
  });
});

describe('pageGeneralList («Solicitudes generales»: card == filter)', () => {
  // Newest first, as the API lists them. 6 = Devuelta (paused), 7 = Resuelto.
  const rows = [
    { id: 7, statusReq: 2 },
    { id: 6, statusReq: 7 },
    { id: 5, statusReq: 1 },
    { id: 4, statusReq: 1 },
    { id: 3, statusReq: 4 },
    { id: 2, statusReq: 1 },
    { id: 1, statusReq: 5 },
  ];
  const base = { statusKey: 'all', slaFilter: null, sort: 'none' as const, page: 1, pageSize: 100 };

  it('SLA cards add up to the pending rows and ignore the status filter', () => {
    const r = pageGeneralList(rows, byRequest, { ...base, statusKey: 'done' });
    expect(r.sla.counts).toEqual({ overdue: 2, near_due: 1, on_time: 1, no_sla: 1, paused: 1 });
    expect(r.sla.total).toBe(6);
    expect(r.statusCounts.pending).toBe(r.sla.total);
  });

  it('each SLA filter lists exactly as many rows as its card says', () => {
    const all = pageGeneralList(rows, byRequest, base);
    for (const state of ['overdue', 'near_due', 'on_time', 'no_sla', 'paused'] as const) {
      const r = pageGeneralList(rows, byRequest, { ...base, slaFilter: state });
      expect(r.total).toBe(all.sla.counts[state]);
      expect(r.statusCounts.all).toBe(all.sla.counts[state]);
    }
  });

  it('sorts by due time across pages, rows without a running SLA last', () => {
    const p1 = pageGeneralList(rows, byRequest, { ...base, sort: 'due_asc', pageSize: 3 });
    const p2 = pageGeneralList(rows, byRequest, { ...base, sort: 'due_asc', page: 2, pageSize: 3 });
    const p3 = pageGeneralList(rows, byRequest, { ...base, sort: 'due_asc', page: 3, pageSize: 3 });
    expect([...p1.pageIds, ...p2.pageIds, ...p3.pageIds]).toEqual([1, 2, 3, 4, 7, 6, 5]);
    expect(p1.total).toBe(7);
  });

  it('combines the SLA filter, the status filter and the sort', () => {
    const r = pageGeneralList(rows, byRequest, { ...base, statusKey: 'pending', slaFilter: 'overdue', sort: 'due_desc' });
    expect(r.pageIds).toEqual([2, 1]);
  });
});
