import { describe, expect, it, vi } from 'vitest';

// The real pool module reads dbconfig (not in CI); only the `sql` types are needed here.
vi.mock('@/lib/mssqlPool', async () => ({ sql: (await import('mssql')).default }));
import { INBOX_ITEMS_SQL, loadSlaScope } from '../slaScope';

const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('INBOX_ITEMS_SQL (same scope as the assigned-requests inbox)', () => {
  const q = norm(INBOX_ITEMS_SQL(''));
  it('includes the requests of the processes OR categories the user manages', () => {
    expect(q).toContain('upcrg.id_process_category = pc.id AND upcrg.id_user = @idUser');
    expect(q).toContain('ucrg.id_category = cr.id AND ucrg.id_user = @idUser');
  });
  it('includes the tasks assigned to the user (activities-assigned)', () => {
    expect(q).toContain("SELECT 'task' AS kind");
    expect(q).toContain('trg.id_assigned = @idUser');
  });
  it('excludes only the closed states (2 Resuelto, 3 Cancelado), for requests and tasks', () => {
    expect(q).toContain('rg.status_req NOT IN (2, 3)');
    expect(q).toContain('trg.id_status NOT IN (2, 3)');
  });
  it('applies the company filter to both parts', () => {
    expect(norm(INBOX_ITEMS_SQL(' AND rg.id_company = @company')).match(/@company/g)?.length).toBe(2);
  });
});

/** Fake mssql pool: answers each query by its shape. */
function fakePool(items: unknown[], requests: unknown[], pauses: unknown[] = []) {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q: string) => {
        if (q.includes("'request' AS kind")) return { recordset: items };
        if (q.includes('request_sla_pause')) return { recordset: pauses };
        return { recordset: requests };
      },
    };
    return r;
  };
  return { request } as never;
}

const w = (s: string) => new Date(`${s}Z`);

describe('loadSlaScope', () => {
  it('counts inbox rows (requests + tasks); tasks inherit the request state', async () => {
    const items = [
      { kind: 'request', request_id: 6229, status_id: 1, status_name: 'Abierto' },
      { kind: 'request', request_id: 6535, status_id: 1, status_name: 'Abierto' },
      { kind: 'request', request_id: 5949, status_id: 1, status_name: 'Abierto' },
      { kind: 'request', request_id: 6487, status_id: 7, status_name: 'Devuelta' },
      { kind: 'task', request_id: 6535, status_id: 4, status_name: 'Sin Empezar' },
      { kind: 'task', request_id: 5949, status_id: 4, status_name: 'Sin Empezar' },
    ];
    const requests = [
      { id: 6229, created_at: w('2026-10-19T11:52:58'), status_req: 1, sla_value: 27, sla_unit: 'business_hours', sla_warn_pct: null },
      { id: 6535, created_at: w('2026-11-03T09:15:43'), status_req: 1, sla_value: 81, sla_unit: 'business_hours', sla_warn_pct: null },
      { id: 5949, created_at: w('2026-10-01T07:48:32'), status_req: 1, sla_value: null, sla_unit: null, sla_warn_pct: null },
    ];
    // 2026-11-19 06:44 Bogotá = 11:44 UTC
    const s = await loadSlaScope(fakePool(items, requests), 'u1', { now: new Date('2026-11-19T11:44:00Z') });
    expect(s.counts).toEqual({ overdue: 3, near_due: 0, on_time: 0, no_sla: 2, paused: 0 });
    expect(s.total).toBe(5); // the returned request is not «Pendientes»
    expect(s.byRequest[6487]).toBeUndefined();
  });

  it('reports unavailable when the SLA columns do not exist', async () => {
    const pool = {
      request: () => {
        const r = { input: () => r, query: async () => Promise.reject(Object.assign(new Error('x'), { number: 207 })) };
        return r;
      },
    } as never;
    const s = await loadSlaScope(pool, 'u1');
    expect(s.available).toBe(false);
    expect(s.total).toBe(0);
  });
});
