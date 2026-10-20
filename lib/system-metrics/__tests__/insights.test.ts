import { describe, expect, it } from 'vitest';
import {
  buildHighlights,
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
    // 15:00–18:00 UTC = 10:00–13:00 en Bogotá: fuera del reinicio programado.
    const lifetimes = [15, 16, 17, 18].map((h, pid) => ({
      host: 'srv',
      instance: '0',
      pid,
      firstSeen: `2026-10-05T${h}:00:00.000Z`,
    }));
    const insights = buildInsights(base({ lifetimes }));
    const r = insights.find((i) => i.id.startsWith('restarts'));
    expect(r?.title).toContain('3 veces');
    expect(r?.severity).toBe('warning');
  });

  it('reinicios: el programado de las 00:02 (pm2 cron_restart) no cuenta', () => {
    // 05:02 UTC = 00:02 en Bogotá, seis noches seguidas.
    const lifetimes = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      host: 'srv',
      instance: '0',
      pid: d,
      firstSeen: `2026-10-0${d + 1}T05:02:00.000Z`,
    }));
    const insights = buildInsights(base({ lifetimes }));
    expect(insights.find((i) => i.id.startsWith('restarts'))).toBeUndefined();
  });

  it('pool con peticiones esperando conexión: crítico solo si fue reciente', () => {
    const now = buildInsights(base({ processSeries: [point(0, { poolPending: 6 })] }));
    expect(now.find((i) => i.id === 'pool-pending')?.severity).toBe('critical');

    // Pasó al comienzo del rango y ya no: queda como información.
    const old = buildInsights(
      base({ processSeries: [point(0, { poolPending: 6 }), ...Array.from({ length: 30 }, (_, i) => point(i + 1))] })
    );
    const pool = old.find((i) => i.id === 'pool-pending');
    expect(pool?.severity).toBe('info');
    expect(pool?.title).toContain('no en los últimos 15 min');
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

describe('buildHighlights', () => {
  it('sin problemas muestra lo que va bien', () => {
    const input = base({
      processSeries: [point(0)],
      db: [{ hasServerState: true, sqlCpuPct: 10, blockedRequests: 0, longestWaitMs: 0, logUsedPct: 10 }],
    });
    const ids = buildHighlights(input, buildInsights(input)).map((h) => h.id);
    expect(ids).toEqual(['good-errors', 'good-speed', 'good-server', 'good-db']);
  });

  it('servicios externos: cualquier falla (aunque sean pocas llamadas) impide decir que van bien', () => {
    const outbound = [
      { key: 'graph.microsoft.com', label: 'Microsoft Graph', requests: 300, errors: 0, throttled: 0, p95Ms: 200 },
      { key: 'sap:50000', label: 'SAP Service Layer', requests: 10, errors: 10, throttled: 0, p95Ms: 900 },
    ];
    const input = base({ processSeries: [point(0)], outbound });
    const ids = buildHighlights(input, buildInsights(input)).map((h) => h.id);
    expect(ids).not.toContain('good-external');

    const ok = base({ processSeries: [point(0)], outbound: [outbound[0]] });
    const good = buildHighlights(ok, buildInsights(ok)).find((h) => h.id === 'good-external');
    expect(good?.detail).toContain('Microsoft Graph');
  });

  it('no dice "100 %" sin error si hubo errores (trunca, no redondea)', () => {
    const input = base({ summary: { current: summary({ requests: 10000, errors: 4 }), previous: summary() } });
    const h = buildHighlights(input, buildInsights(input)).find((x) => x.id === 'good-errors');
    expect(h?.title).toContain('99,9 %');
  });

  it('no compara contra un periodo anterior con pocos datos', () => {
    // El anterior solo tiene 10 minutos con dato frente a 360: "subió 400 %" sería falso.
    const input = base({
      summary: {
        current: summary({ requests: 36000, minutes: 360 }),
        previous: summary({ requests: 1000, minutes: 10 }),
      },
    });
    expect(buildInsights(input).find((i) => i.id === 'traffic-change')).toBeUndefined();
  });

  it('no celebra un área que tiene un problema', () => {
    const input = base({
      summary: { current: summary({ errors: 100 }), previous: summary() },
      processSeries: [point(0, { hostCpuPct: 95 })],
    });
    const ids = buildHighlights(input, buildInsights(input)).map((h) => h.id);
    expect(ids).not.toContain('good-errors');
    expect(ids).not.toContain('good-server');
    expect(ids).toContain('good-speed');
  });
});
