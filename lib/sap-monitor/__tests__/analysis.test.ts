import { describe, expect, it } from 'vitest';
import {
  aggregateViewCosts,
  buildBlockingChains,
  evaluateSlNodeAlerts,
  evaluateSqlAlerts,
  evaluateViewTimeoutAlerts,
  observeIncidents,
  viewCostDeltas,
  viewNamesIn,
  waitDeltas,
  type SapRequestRow,
} from '../analysis';
import { alertsToNotify } from '../../system-metrics/earlyWarnings';

const req = (over: Partial<SapRequestRow>): SapRequestRow => ({
  sessionId: 1,
  blockingSessionId: 0,
  status: 'suspended',
  command: 'SELECT',
  waitType: null,
  waitMs: 0,
  waitResource: null,
  runningSec: 1,
  databaseName: 'ONELATAMPHARMA_PROD',
  openTransactions: 0,
  hostName: 'h',
  loginName: 'l',
  programName: 'p',
  statement: 'SELECT 1',
  sessionStart: '100',
  requestStart: '200',
  ...over,
});

describe('buildBlockingChains', () => {
  it('walks victims up to an idle head blocker (sleeping session with open transaction)', () => {
    const chains = buildBlockingChains(
      [
        req({ sessionId: 200, blockingSessionId: 150, waitMs: 754_000, waitType: 'LCK_M_S', waitResource: 'OITW' }),
        req({ sessionId: 150, blockingSessionId: 125, waitMs: 120_000 }),
        req({ sessionId: 300, blockingSessionId: 125, waitMs: 30_000 }),
      ],
      [{ sessionId: 125, status: 'sleeping', hostName: 'POR0026', loginName: 'sa', programName: 'SAP Business One', databaseName: 'ONELATAMPHARMA_PROD', openTransactions: 1, idleSec: 720, lastStatement: 'UPDATE OITW', sessionStart: '42' }]
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].head.sessionId).toBe(125);
    expect(chains[0].head.hostName).toBe('POR0026');
    expect(chains[0].blockedCount).toBe(3);
    expect(chains[0].maxWaitSec).toBe(754);
  });

  it('stops on a cycle instead of looping forever', () => {
    const chains = buildBlockingChains([req({ sessionId: 1, blockingSessionId: 2, waitMs: 5000 }), req({ sessionId: 2, blockingSessionId: 1, waitMs: 4000 })], []);
    expect(chains.length).toBeGreaterThan(0);
  });

  it('returns nothing when nobody is blocked', () => {
    expect(buildBlockingChains([req({ runningSec: 500 })], [])).toEqual([]);
  });
});

describe('waitDeltas', () => {
  it('needs a previous snapshot, ignores benign waits and counter resets', () => {
    const prev = [
      { waitType: 'LCK_M_S', tasks: 10, waitMs: 1000 },
      { waitType: 'PAGEIOLATCH_SH', tasks: 5, waitMs: 9000 },
      { waitType: 'SLEEP_TASK', tasks: 1, waitMs: 1 },
    ];
    const cur = [
      { waitType: 'LCK_M_S', tasks: 12, waitMs: 61_000 },
      { waitType: 'PAGEIOLATCH_SH', tasks: 1, waitMs: 10 },
      { waitType: 'SLEEP_TASK', tasks: 9, waitMs: 99_999 },
    ];
    expect(waitDeltas(null, cur)).toEqual([]);
    expect(waitDeltas(prev, cur)).toEqual([{ waitType: 'LCK_M_S', tasks: 2, waitMs: 60_000 }]);
  });
});

describe('incidents and SQL alerts', () => {
  const chains = buildBlockingChains(
    [req({ sessionId: 200, blockingSessionId: 125, waitMs: 180_000 })],
    [{ sessionId: 125, status: 'sleeping', hostName: 'POR0026', loginName: 'u', programName: 'SAP', databaseName: 'X', openTransactions: 1, idleSec: 1, lastStatement: null, sessionStart: '7' }]
  );

  it('keys are stable across minutes for the same incident', () => {
    const a = observeIncidents({ chains, requests: [], openTx: [] });
    const b = observeIncidents({ chains, requests: [], openTx: [] });
    expect(a[0].key).toBe(b[0].key);
    expect(a[0].key).toBe('sap-bloqueo:125:7');
  });

  it('blocking >= 2 min, query >= 5 min and transaction >= 5 min alert; shorter ones do not', () => {
    const obs = observeIncidents({
      chains,
      requests: [req({ sessionId: 9, runningSec: 301 }), req({ sessionId: 10, runningSec: 130 })],
      openTx: [
        { sessionId: 11, openSec: 301, name: 'user_transaction', hostName: 'h', loginName: 'l', programName: 'p', databaseName: 'd', sessionStatus: 'sleeping', lastStatement: null, sessionStart: '1', locks: null },
        { sessionId: 12, openSec: 90, name: 'user_transaction', hostName: 'h', loginName: 'l', programName: 'p', databaseName: 'd', sessionStatus: 'sleeping', lastStatement: null, sessionStart: '1', locks: null },
      ],
    });
    const rules = evaluateSqlAlerts(obs).map((w) => `${w.rule}:${w.severity}`);
    expect(rules).toEqual(['sap-bloqueo:warning', 'sap-consulta:warning', 'sap-transaccion:warning']);
  });

  it('the same incident is notified once inside the cooldown, again when it escalates', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const [w] = evaluateSqlAlerts(observeIncidents({ chains, requests: [], openTx: [] }));
    const last = new Map([[w.key, { severity: 'warning' as const, raisedAt: '2026-11-20T11:55:00Z' }]]);
    expect(alertsToNotify([w], last, now)).toHaveLength(0);
    expect(alertsToNotify([{ ...w, severity: 'critical' }], last, now)).toHaveLength(1);
  });
});

describe('view costs', () => {
  it('finds view names in Service Layer statements', () => {
    expect(viewNamesIn('SELECT T0."Fecha" FROM "OLP_IND_VentasB1SLQuery" T0 WHERE T0."Fecha" >= @P1')).toEqual(['OLP_IND_VentasB1SLQuery']);
    expect(viewNamesIn('SELECT 1 FROM OITM')).toEqual([]);
  });

  it('aggregates by database and view, and computes deltas (with plan eviction)', () => {
    const rows = [
      { databaseName: 'OLP', text: 'select * from "OLP_IND_VentasB1SLQuery"', executions: 4, totalElapsedMs: 1_200_000, totalCpuMs: 900_000, totalReads: 9e8, maxElapsedMs: 300_000, lastExecutionAt: '2026-11-20T12:00:00Z' },
      { databaseName: 'OLP', text: 'select * from "OLP_IND_VentasB1SLQuery" where x', executions: 1, totalElapsedMs: 100, totalCpuMs: 50, totalReads: 10, maxElapsedMs: 100, lastExecutionAt: '2026-11-20T12:05:00Z' },
    ];
    const [v] = aggregateViewCosts(rows);
    expect(v).toMatchObject({ plans: 2, executions: 5, maxElapsedMs: 300_000, lastExecutionAt: '2026-11-20T12:05:00Z' });
    const [first] = viewCostDeltas(null, [v]);
    expect(first.deltaExecutions).toBeNull();
    const [later] = viewCostDeltas([v], [{ ...v, executions: 8, totalElapsedMs: 1_500_100 }]);
    expect(later.deltaExecutions).toBe(3);
    expect(later.deltaElapsedMs).toBe(300_000);
    const [evicted] = viewCostDeltas([v], [{ ...v, executions: 2, totalElapsedMs: 10 }]);
    expect(evicted.deltaExecutions).toBe(2);
  });
});

describe('Service Layer alerts', () => {
  it('handles: warning from 5.000, critical from 6.000, one key per node process', () => {
    const w = evaluateSlNodeAlerts([
      { service: 'b1s50001', pid: 1, handles: 4999, memMb: 1, threads: 1, startedAt: null },
      { service: 'b1s50004', pid: 2, handles: 5200, memMb: 1, threads: 1, startedAt: null },
      { service: 'b1s50010', pid: 3, handles: 6735, memMb: 1, threads: 1, startedAt: null },
    ]);
    expect(w.map((x) => `${x.key}:${x.severity}`)).toEqual(['sap-sl-handles:b1s50004:2:warning', 'sap-sl-handles:b1s50010:3:critical']);
  });

  it('views: 3 timeouts in the window alert, 2 do not', () => {
    const w = evaluateViewTimeoutAlerts([
      { viewName: 'OLP_IND_VentasB1SLQuery', timeouts: 3, calls: 3, sources: ['192.168.10.11'], maxMs: 300_007 },
      { viewName: 'OLP_VentaNegadaB1SLQuery', timeouts: 2, calls: 9, sources: [], maxMs: 1 },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].key).toBe('sap-vista-timeouts:OLP_IND_VentasB1SLQuery');
    expect(w[0].happening).toContain('192.168.10.11');
  });
});
