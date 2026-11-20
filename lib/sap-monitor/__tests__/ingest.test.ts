import { afterEach, describe, expect, it } from 'vitest';
import { validateIngestPayload } from '../ingest';
import { isValidIngestKey, parseSqlConnectionString } from '../config';
import { rankViews } from '../viewRank';

const now = new Date().toISOString();

describe('validateIngestPayload', () => {
  it('accepts aggregated metrics', () => {
    const r = validateIngestPayload({
      source: 'serfarma07',
      collectedAt: now,
      dryRun: true,
      nodes: [{ service: 'b1s50001', pid: 1, handles: 6000, memMb: 1100, threads: 50, startedAt: now }],
      viewCalls: [{ bucketAt: now, view: 'OLP_IND_VentasB1SLQuery', sourceIp: '192.168.10.11', calls: 2, timeouts: 2, totalMs: 600000, maxMs: 300000 }],
      sessions: [{ bucketAt: now, sourceIp: '192.168.10.5', company: 'FARMALOGICA_PROD', user: 'ServiceLayer', logins: 3, logouts: 1 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ dryRun: true, nodes: [{ handles: 6000 }], viewCalls: [{ timeouts: 2 }], sessions: [{ logins: 3, restores: 0 }] });
  });

  it('drops (and counts) rows with bad names, services or IPs; rejects a bad envelope', () => {
    const r = validateIngestPayload({
      source: 'serfarma07',
      collectedAt: now,
      nodes: [{ service: 'httpd', pid: 1, handles: 1, memMb: 1 }],
      viewCalls: [
        { bucketAt: now, view: "x'; DROP TABLE", sourceIp: '1.1.1.1', calls: 1 },
        { bucketAt: now, view: 'OITM', sourceIp: '1.1.1.1', calls: 1 },
        { bucketAt: now, view: 'A_B1SLQuery', sourceIp: '1.1.1.1', calls: 1 },
      ],
      sessions: [{ bucketAt: now, sourceIp: '999.1.1.1', company: 'A', user: 'u' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.skipped).toBe(4);
      expect(r.payload.viewCalls.map((v) => v.view)).toEqual(['A_B1SLQuery']);
    }
    expect(validateIngestPayload({ source: 'serfarma07', collectedAt: '2020-01-01T00:00:00Z' }).ok).toBe(false);
    expect(validateIngestPayload({ source: 'bad source', collectedAt: now }).ok).toBe(false);
    expect(validateIngestPayload(null).ok).toBe(false);
  });
});

describe('config', () => {
  const prev = process.env.SAP_MONITOR_INGEST_KEYS;
  afterEach(() => {
    process.env.SAP_MONITOR_INGEST_KEYS = prev;
  });

  it('parses Prisma-style and ADO-style connection strings', () => {
    expect(parseSqlConnectionString('sqlserver://10.0.0.7:1433;database=master;user=mon;password=p;encrypt=true;trustServerCertificate=true')).toMatchObject({
      server: '10.0.0.7',
      port: 1433,
      database: 'master',
      user: 'mon',
      encrypt: true,
    });
    expect(parseSqlConnectionString('Server=tcp:sap,1433;User Id=mon;Password=p;Encrypt=false')).toMatchObject({ server: 'sap', port: 1433, encrypt: false, database: 'master' });
    expect(parseSqlConnectionString('')).toBeNull();
    expect(parseSqlConnectionString('sqlserver://host;database=x')).toBeNull();
  });

  it('ingest keys: short keys are ignored, comparison is exact', () => {
    process.env.SAP_MONITOR_INGEST_KEYS = 'short,abcdefghijklmnopqrstuvwxyz0123';
    expect(isValidIngestKey('short')).toBe(false);
    expect(isValidIngestKey('abcdefghijklmnopqrstuvwxyz0123')).toBe(true);
    expect(isValidIngestKey('abcdefghijklmnopqrstuvwxyz012')).toBe(false);
    expect(isValidIngestKey(null)).toBe(false);
  });
});

describe('rankViews', () => {
  it('joins SQL cost and Service Layer calls by view name, ignoring case', () => {
    const [v] = rankViews({
      sql: [{ databaseName: 'OLP', viewName: 'OLP_IND_VentasB1SLQuery', executions: 5, elapsedMs: 1500, cpuMs: 1000, reads: 9, maxElapsedMs: 300, lastExecutionAt: null }],
      sl: [
        { viewName: 'olp_ind_ventasb1slquery', sourceIp: '192.168.10.11', company: null, calls: 3, errors: 3, timeouts: 3, totalMs: 900_000, maxMs: 300_000, bytes: 0, lastCall: null },
        { viewName: 'OLP_IND_VentasB1SLQuery', sourceIp: '192.168.10.5', company: null, calls: 1, errors: 0, timeouts: 0, totalMs: 10, maxMs: 10, bytes: 0, lastCall: null },
      ],
    });
    expect(v).toMatchObject({ databases: ['OLP'], slCalls: 4, slTimeouts: 3, sqlExecutions: 5 });
    expect(v.sources[0]).toEqual({ ip: '192.168.10.11', calls: 3, timeouts: 3 });
  });
});
