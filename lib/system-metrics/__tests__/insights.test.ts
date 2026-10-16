import { describe, expect, it } from 'vitest';
import {
  buildInsights,
  looksLikeMemoryLeak,
  mainTableOf,
  verdictFrom,
  type InsightInput,
} from '../insights';

const summary = (over: Partial<NonNullable<InsightInput['summary']>['current']> = {}) => ({
  samples: 60,
  requests: 1000,
  errors: 0,
  p95Ms: 200,
  outRequests: 0,
  outErrors: 0,
  outThrottled: 0,
  maxPoolPending: 0,
  ...over,
});

const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  rangeLabel: '6 horas',
  summary: { current: summary(), previous: summary() },
  processSeries: [],
  db: [],
  outbound: [],
  dbLive: null,
  lifetimes: [],
  now: new Date('2026-10-06T12:00:00Z'),
  ...over,
});

const point = (i: number, over: Record<string, number | null> = {}) => ({
  bucket: new Date(Date.UTC(2026, 9, 6, 6, i)).toISOString(),
  host: 'srv',
  instance: '0',
  rssMb: 300,
  hostCpuPct: 20,
  hostMemUsedPct: 40,
  eventLoopP99Ms: 20,
  poolPending: 0,
  ...over,
});

describe('buildInsights', () => {
  it('sin problemas no genera hallazgos y el veredicto es "normal"', () => {
    const insights = buildInsights(base({ processSeries: [point(0)] }));
    expect(insights).toEqual([]);
    expect(verdictFrom(insights, true).severity).toBe('ok');
  });

  it('CPU y memoria del servidor por umbral', () => {
    const insights = buildInsights(base({ processSeries: [point(0, { hostCpuPct: 90, hostMemUsedPct: 80 })] }));
    expect(insights.find((i) => i.id === 'host-cpu')?.severity).toBe('critical');
    expect(insights.find((i) => i.id === 'host-mem')?.severity).toBe('warning');
    expect(insights[0].severity).toBe('critical');
  });

  it('tasa de errores solo con tráfico suficiente', () => {
    const few = buildInsights(base({ summary: { current: summary({ requests: 10, errors: 5 }), previous: summary() } }));
    expect(few.find((i) => i.id === 'error-rate')).toBeUndefined();
    const many = buildInsights(base({ summary: { current: summary({ requests: 1000, errors: 60 }), previous: summary() } }));
    expect(many.find((i) => i.id === 'error-rate')?.severity).toBe('critical');
  });

  it('avisa si responde mucho más lento que el periodo anterior', () => {
    const insights = buildInsights(
      base({ summary: { current: summary({ p95Ms: 900 }), previous: summary({ p95Ms: 400 }) } })
    );
    expect(insights.find((i) => i.id === 'slower')?.title).toContain('125 %');
  });

  it('detecta memoria que solo crece', () => {
    const rows = Array.from({ length: 30 }, (_, i) => point(i, { rssMb: 300 + i * 10 }));
    const insights = buildInsights(base({ processSeries: rows }));
    expect(insights.find((i) => i.id.startsWith('memory-leak'))).toBeDefined();
  });

  it('reinicios: varios pid en la misma instancia', () => {
    const lifetimes = [1, 2, 3, 4].map((pid) => ({ host: 'srv', instance: '0', pid, firstSeen: '' }));
    const insights = buildInsights(base({ lifetimes }));
    const r = insights.find((i) => i.id.startsWith('restarts'));
    expect(r?.title).toContain('3 veces');
    expect(r?.severity).toBe('warning');
  });

  it('pool con peticiones esperando conexión', () => {
    const insights = buildInsights(base({ summary: { current: summary({ maxPoolPending: 6 }), previous: summary() } }));
    expect(insights.find((i) => i.id === 'pool-pending')?.severity).toBe('critical');
  });

  it('SQL: bloqueos, log y Query Store', () => {
    const insights = buildInsights(
      base({
        db: [{ hasServerState: true, sqlCpuPct: 10, blockedRequests: 2, longestWaitMs: 4000, logUsedPct: 88 }],
        dbLive: { hasServerState: true, queryStore: 'OFF', sqlServerStartedAt: null, connections: [], topQueries: [] },
      })
    );
    expect(insights.find((i) => i.id === 'blocked')?.severity).toBe('warning');
    expect(insights.find((i) => i.id === 'log-used')?.title).toContain('88 %');
    expect(insights.find((i) => i.id === 'query-store')).toBeDefined();
  });

  it('log: usa la foto en vivo y su contexto (misma regla que los mapas)', () => {
    const insights = buildInsights(
      base({
        db: [{ hasServerState: true, sqlCpuPct: 10, blockedRequests: 0, longestWaitMs: 0, logUsedPct: 80 }],
        dbLive: {
          hasServerState: true,
          queryStore: 'READ_WRITE',
          sqlServerStartedAt: null,
          connections: [],
          topQueries: [],
          logUsedPct: 96.9,
          log: {
            database: 'KRONOSDB',
            recoveryModel: 'FULL',
            reuseWait: 'LOG_BACKUP',
            sizeMb: 264,
            canGrow: true,
            roomMb: 385_000,
            volumeFreeMb: 385_000,
            lastLogBackupHours: null,
            backupHistoryKnown: true,
          },
        },
      })
    );
    const log = insights.find((i) => i.id === 'log-used');
    expect(log?.severity).toBe('warning');
    expect(log?.title).toContain('falta el respaldo del log');
  });

  it('caso real: consulta del chat muy frecuente y conexiones de Prisma', () => {
    const insights = buildInsights(
      base({
        dbLive: {
          hasServerState: true,
          queryStore: 'READ_WRITE',
          sqlServerStartedAt: '2026-10-06T10:00:00Z',
          connections: [{ programName: 'tiberius', sessions: 28 }],
          topQueries: [
            {
              statement: 'SELECT [dbo].[chat_message].[id] FROM [dbo].[chat_message] WHERE ([dbo].[chat_message].[id] > @P1)',
              executions: 60_000,
              totalCpuMs: 30_000,
            },
          ],
        },
      })
    );
    expect(insights.find((i) => i.id === 'hot-query')?.title).toBe(
      'La consulta a chat_message se ejecuta ~500 veces por minuto'
    );
    expect(insights.find((i) => i.id === 'prisma-connections')?.title).toContain('28');
  });

  it('servicios externos: 429 y fallas', () => {
    const insights = buildInsights(
      base({
        outbound: [{ key: 'graph.microsoft.com', label: 'Microsoft Graph', requests: 100, errors: 30, throttled: 25, p95Ms: 800 }],
      })
    );
    expect(insights.find((i) => i.id.startsWith('throttled'))?.severity).toBe('warning');
    expect(insights.find((i) => i.id.startsWith('outbound-errors'))?.severity).toBe('critical');
  });
});

describe('ayudas', () => {
  it('mainTableOf', () => {
    expect(mainTableOf('SELECT a FROM [dbo].[chat_message] WHERE x')).toBe('chat_message');
    expect(mainTableOf('DELETE FROM notifications WHERE email = @email')).toBe('notifications');
    expect(mainTableOf('UPDATE dbo.request SET x = 1')).toBe('request');
    expect(mainTableOf('EXEC sp_who')).toBeNull();
  });

  it('looksLikeMemoryLeak ignora memoria que sube y baja', () => {
    const sawtooth = Array.from({ length: 30 }, (_, i) => 300 + (i % 10) * 20);
    expect(looksLikeMemoryLeak(sawtooth)).toBeNull();
    expect(looksLikeMemoryLeak([1, 2, 3])).toBeNull();
  });

  it('verdictFrom sin datos', () => {
    expect(verdictFrom([], false).headline).toBe('Esperando los primeros datos');
  });
});
