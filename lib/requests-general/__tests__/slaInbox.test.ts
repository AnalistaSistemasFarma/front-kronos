import { describe, expect, it } from 'vitest';
import { countInboxSla, inboxItemSlaState, type InboxSlaItem, type SlaStateByRequest } from '../slaInbox';

/**
 * Fixture = real prod inbox of Nicolás Rivera on 2026-11-19 06:44 (read-only query V01/V04):
 * 5 open requests + 1 returned in his processes, 4 open tasks assigned to him and 1 resolved
 * task (8639) of an overdue request.
 */
const byRequest: SlaStateByRequest = {
  5949: { state: 'no_sla' },
  6229: { state: 'overdue' },
  6282: { state: 'no_sla' },
  6507: { state: 'no_sla' },
  6535: { state: 'overdue' },
  // 6487 is returned (status 7): clock stopped, not in byRequest.
};
const rows: Array<InboxSlaItem & { id: string }> = [
  { id: 'req-5949', kind: 'request', requestId: 5949, group: 'pending' },
  { id: 'req-6229', kind: 'request', requestId: 6229, group: 'pending' },
  { id: 'req-6282', kind: 'request', requestId: 6282, group: 'pending' },
  { id: 'req-6487', kind: 'request', requestId: 6487, group: 'returned' },
  { id: 'req-6507', kind: 'request', requestId: 6507, group: 'pending' },
  { id: 'req-6535', kind: 'request', requestId: 6535, group: 'pending' },
  { id: 'task-8662', kind: 'task', requestId: 5949, group: 'pending' },
  { id: 'task-8073', kind: 'task', requestId: 6282, group: 'pending' },
  { id: 'task-8641', kind: 'task', requestId: 6507, group: 'pending' },
  { id: 'task-8825', kind: 'task', requestId: 6535, group: 'pending' },
  { id: 'task-8639', kind: 'task', requestId: 6229, group: 'done' },
];

describe('countInboxSla (inbox scope)', () => {
  it('counts every pending inbox row once, so buckets add up to the «Pendientes» card', () => {
    const { counts, breakdown, total } = countInboxSla(rows, byRequest);
    const pending = rows.filter((r) => r.group === 'pending').length;
    expect(total).toBe(pending); // 9 = 5 requests + 4 tasks
    expect(counts).toEqual({ overdue: 3, near_due: 0, on_time: 0, no_sla: 6, paused: 0 });
    expect(breakdown.overdue).toEqual({ requests: 2, tasks: 1 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('the «Vencidos» filter selects exactly the rows the counter counts (no resolved task 8639)', () => {
    const filtered = rows.filter((r) => inboxItemSlaState(r, byRequest) === 'overdue').map((r) => r.id);
    expect(filtered).toEqual(['req-6229', 'req-6535', 'task-8825']);
    expect(filtered.length).toBe(countInboxSla(rows, byRequest).counts.overdue);
  });

  it('every bucket filter matches its counter', () => {
    const { counts } = countInboxSla(rows, byRequest);
    for (const state of ['overdue', 'near_due', 'on_time', 'no_sla', 'paused'] as const) {
      expect(rows.filter((r) => inboxItemSlaState(r, byRequest) === state).length).toBe(counts[state]);
    }
  });

  it('returned, done and cancelled rows are outside the widget', () => {
    expect(inboxItemSlaState(rows[3], byRequest)).toBeNull();
    expect(inboxItemSlaState({ kind: 'request', requestId: 1, group: 'cancelled' }, byRequest)).toBeNull();
  });

  it('a pending task whose request clock is stopped (returned request) is «paused»', () => {
    const item: InboxSlaItem = { kind: 'task', requestId: 6487, group: 'pending' };
    expect(inboxItemSlaState(item, byRequest)).toBe('paused');
    expect(countInboxSla([item], byRequest).counts.paused).toBe(1);
  });
});
