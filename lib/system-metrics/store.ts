import 'server-only';
import { sql } from '../mssqlPool';
import type { DbSample } from './dbProbe';
import type { RouteSummary } from './stats';

/**
 * Lectura/escritura de las tablas del Monitor del sistema (prisma/manual/2026-10-05-system-metrics.sql).
 * Sin modelo Prisma: si las tablas no existen, las escrituras fallan con el error 208 y el
 * colector se pausa (ver isMissingTableError) en vez de llenar el log.
 */

type Pool = Awaited<ReturnType<typeof import('../mssqlPool').getPool>>;

export function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 208;
}

export type ProcessSample = {
  sampledAt: Date;
  host: string;
  instance: string;
  pid: number;
  cpuPct: number;
  rssMb: number;
  heapUsedMb: number;
  eventLoopP50Ms: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  hostCpuPct: number;
  hostMemUsedPct: number;
  hostMemTotalMb: number;
  httpRequests: number;
  httpErrors: number;
  httpP95Ms: number;
  outRequests: number;
  outErrors: number;
  outThrottled: number;
  poolSize: number | null;
  poolAvailable: number | null;
  poolBorrowed: number | null;
  poolPending: number | null;
};

export async function insertProcessSample(pool: Pool, s: ProcessSample): Promise<void> {
  await pool
    .request()
    .input('sampled_at', sql.DateTime2(0), s.sampledAt)
    .input('host', sql.NVarChar(128), s.host.slice(0, 128))
    .input('instance', sql.NVarChar(16), s.instance.slice(0, 16))
    .input('pid', sql.Int, s.pid)
    .input('cpu_pct', sql.Decimal(6, 2), s.cpuPct)
    .input('rss_mb', sql.Int, s.rssMb)
    .input('heap_used_mb', sql.Int, s.heapUsedMb)
    .input('el_p50', sql.Decimal(9, 2), s.eventLoopP50Ms)
    .input('el_p99', sql.Decimal(9, 2), s.eventLoopP99Ms)
    .input('el_max', sql.Decimal(9, 2), Math.min(s.eventLoopMaxMs, 9_999_999))
    .input('host_cpu_pct', sql.Decimal(6, 2), s.hostCpuPct)
    .input('host_mem_used_pct', sql.Decimal(5, 2), s.hostMemUsedPct)
    .input('host_mem_total_mb', sql.Int, s.hostMemTotalMb)
    .input('http_requests', sql.Int, s.httpRequests)
    .input('http_errors', sql.Int, s.httpErrors)
    .input('http_p95_ms', sql.Int, s.httpP95Ms)
    .input('out_requests', sql.Int, s.outRequests)
    .input('out_errors', sql.Int, s.outErrors)
    .input('out_throttled', sql.Int, s.outThrottled)
    .input('pool_size', sql.SmallInt, s.poolSize)
    .input('pool_available', sql.SmallInt, s.poolAvailable)
    .input('pool_borrowed', sql.SmallInt, s.poolBorrowed)
    .input('pool_pending', sql.SmallInt, s.poolPending).query(`
      INSERT INTO dbo.system_metric_sample (
        sampled_at, host, instance, pid, cpu_pct, rss_mb, heap_used_mb,
        event_loop_p50_ms, event_loop_p99_ms, event_loop_max_ms,
        host_cpu_pct, host_mem_used_pct, host_mem_total_mb,
        http_requests, http_errors, http_p95_ms,
        out_requests, out_errors, out_throttled,
        pool_size, pool_available, pool_borrowed, pool_pending
      ) VALUES (
        @sampled_at, @host, @instance, @pid, @cpu_pct, @rss_mb, @heap_used_mb,
        @el_p50, @el_p99, @el_max,
        @host_cpu_pct, @host_mem_used_pct, @host_mem_total_mb,
        @http_requests, @http_errors, @http_p95_ms,
        @out_requests, @out_errors, @out_throttled,
        @pool_size, @pool_available, @pool_borrowed, @pool_pending
      )`);
}

/** 13 parámetros por fila → 100 filas por INSERT queda lejos del límite de 2100 de SQL Server. */
const ROUTE_CHUNK = 100;

export async function insertRouteSummaries(
  pool: Pool,
  bucketAt: Date,
  host: string,
  instance: string,
  rows: RouteSummary[]
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROUTE_CHUNK) {
    const chunk = rows.slice(start, start + ROUTE_CHUNK);
    const req = pool
      .request()
      .input('bucket_at', sql.DateTime2(0), bucketAt)
      .input('host', sql.NVarChar(128), host.slice(0, 128))
      .input('instance', sql.NVarChar(16), instance.slice(0, 16));
    const values: string[] = [];
    chunk.forEach((r, i) => {
      req
        .input(`d${i}`, sql.Char(3), r.direction)
        .input(`k${i}`, sql.NVarChar(300), r.key.slice(0, 300))
        .input(`m${i}`, sql.NVarChar(80), r.module.slice(0, 80))
        .input(`rq${i}`, sql.Int, r.requests)
        .input(`e${i}`, sql.Int, r.errors)
        .input(`ce${i}`, sql.Int, r.clientErrors)
        .input(`t${i}`, sql.Int, r.throttled)
        .input(`tm${i}`, sql.BigInt, r.totalMs)
        .input(`mx${i}`, sql.Int, Math.min(r.maxMs, 2_000_000_000))
        .input(`p${i}`, sql.Int, Math.min(r.p95Ms, 2_000_000_000));
      values.push(
        `(@bucket_at, @host, @instance, @d${i}, @k${i}, @m${i}, @rq${i}, @e${i}, @ce${i}, @t${i}, @tm${i}, @mx${i}, @p${i})`
      );
    });
    await req.query(`
      INSERT INTO dbo.system_metric_route (
        bucket_at, host, instance, direction, route_key, module,
        requests, errors, client_errors, throttled, total_ms, max_ms, p95_ms
      ) VALUES ${values.join(',\n')}`);
  }
}

export async function insertDbSample(pool: Pool, sampledAt: Date, s: DbSample): Promise<void> {
  await pool
    .request()
    .input('sampled_at', sql.DateTime2(0), sampledAt)
    .input('has_server_state', sql.Bit, s.hasServerState)
    .input('sql_cpu_pct', sql.Decimal(6, 2), s.sqlCpuPct)
    .input('other_cpu_pct', sql.Decimal(6, 2), s.otherCpuPct)
    .input('user_connections', sql.Int, s.userConnections)
    .input('db_sessions', sql.Int, s.dbSessions)
    .input('active_requests', sql.Int, s.activeRequests)
    .input('blocked_requests', sql.Int, s.blockedRequests)
    .input('longest_wait_ms', sql.Int, s.longestWaitMs)
    .input('db_size_mb', sql.Int, s.dbSizeMb)
    .input('log_used_pct', sql.Decimal(5, 2), s.logUsedPct).query(`
      INSERT INTO dbo.system_metric_db (
        sampled_at, has_server_state, sql_cpu_pct, other_cpu_pct, user_connections, db_sessions,
        active_requests, blocked_requests, longest_wait_ms, db_size_mb, log_used_pct
      ) VALUES (
        @sampled_at, @has_server_state, @sql_cpu_pct, @other_cpu_pct, @user_connections, @db_sessions,
        @active_requests, @blocked_requests, @longest_wait_ms, @db_size_mb, @log_used_pct
      )`);
}

/**
 * Borra datos viejos en lotes pequeños (no bloquea la tabla mucho tiempo). Tope de lotes por
 * corrida: si queda algo, lo termina la corrida del día siguiente.
 */
export async function deleteOldMetrics(pool: Pool, retentionDays: number): Promise<number> {
  const targets: Array<[string, string]> = [
    ['dbo.system_metric_sample', 'sampled_at'],
    ['dbo.system_metric_route', 'bucket_at'],
    ['dbo.system_metric_db', 'sampled_at'],
  ];
  let deleted = 0;
  for (const [table, column] of targets) {
    for (let batch = 0; batch < 40; batch += 1) {
      const r = await pool
        .request()
        .input('days', sql.Int, retentionDays)
        .query(`DELETE TOP (5000) FROM ${table} WHERE ${column} < DATEADD(day, -@days, SYSUTCDATETIME())`);
      const n = r.rowsAffected?.[0] ?? 0;
      deleted += n;
      if (n < 5000) break;
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Lecturas para la API
// ---------------------------------------------------------------------------

export const RANGES = {
  '1h': { minutes: 60, bucket: 1 },
  '6h': { minutes: 360, bucket: 5 },
  '24h': { minutes: 1440, bucket: 15 },
  '7d': { minutes: 10080, bucket: 60 },
} as const;

export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | null | undefined): RangeKey {
  return value && value in RANGES ? (value as RangeKey) : '6h';
}

/** Expresión SQL que redondea una fecha al inicio de su ventana de @bucket minutos. */
const bucketExpr = (column: string) =>
  `DATEADD(minute, (DATEDIFF(minute, '2020-01-01', ${column}) / @bucket) * @bucket, CAST('2020-01-01' AS DATETIME2(0)))`;

export type ProcessSeriesRow = {
  bucket: string;
  host: string;
  instance: string;
  cpuPct: number | null;
  rssMb: number | null;
  heapUsedMb: number | null;
  eventLoopP99Ms: number | null;
  hostCpuPct: number | null;
  hostMemUsedPct: number | null;
  httpRequests: number;
  httpErrors: number;
  httpP95Ms: number | null;
  outRequests: number;
  outErrors: number;
  outThrottled: number;
  poolBorrowed: number | null;
  poolPending: number | null;
  poolSize: number | null;
};

export async function readProcessSeries(pool: Pool, range: RangeKey): Promise<ProcessSeriesRow[]> {
  const { minutes, bucket } = RANGES[range];
  const r = await pool
    .request()
    .input('minutes', sql.Int, minutes)
    .input('bucket', sql.Int, bucket).query(`
      SELECT
        ${bucketExpr('sampled_at')} AS bucket,
        host, instance,
        AVG(cpu_pct) AS cpu_pct,
        MAX(rss_mb) AS rss_mb,
        MAX(heap_used_mb) AS heap_used_mb,
        MAX(event_loop_p99_ms) AS event_loop_p99_ms,
        AVG(host_cpu_pct) AS host_cpu_pct,
        AVG(host_mem_used_pct) AS host_mem_used_pct,
        SUM(http_requests) AS http_requests,
        SUM(http_errors) AS http_errors,
        MAX(http_p95_ms) AS http_p95_ms,
        SUM(out_requests) AS out_requests,
        SUM(out_errors) AS out_errors,
        SUM(out_throttled) AS out_throttled,
        MAX(pool_borrowed) AS pool_borrowed,
        MAX(pool_pending) AS pool_pending,
        MAX(pool_size) AS pool_size
      FROM dbo.system_metric_sample
      WHERE sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
      GROUP BY ${bucketExpr('sampled_at')}, host, instance
      ORDER BY bucket, host, instance`);
  return r.recordset.map((row) => ({
    bucket: new Date(row.bucket).toISOString(),
    host: row.host,
    instance: row.instance,
    cpuPct: nullableNumber(row.cpu_pct),
    rssMb: nullableNumber(row.rss_mb),
    heapUsedMb: nullableNumber(row.heap_used_mb),
    eventLoopP99Ms: nullableNumber(row.event_loop_p99_ms),
    hostCpuPct: nullableNumber(row.host_cpu_pct),
    hostMemUsedPct: nullableNumber(row.host_mem_used_pct),
    httpRequests: Number(row.http_requests) || 0,
    httpErrors: Number(row.http_errors) || 0,
    httpP95Ms: nullableNumber(row.http_p95_ms),
    outRequests: Number(row.out_requests) || 0,
    outErrors: Number(row.out_errors) || 0,
    outThrottled: Number(row.out_throttled) || 0,
    poolBorrowed: nullableNumber(row.pool_borrowed),
    poolPending: nullableNumber(row.pool_pending),
    poolSize: nullableNumber(row.pool_size),
  }));
}

export type RouteRankingRow = {
  direction: 'in' | 'out';
  key: string;
  module: string;
  requests: number;
  errors: number;
  clientErrors: number;
  throttled: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
  /** Promedio ponderado de los p95 de cada ventana de 5 min (aproximado). */
  p95Ms: number;
};

export async function readRouteRanking(
  pool: Pool,
  range: RangeKey,
  direction: 'in' | 'out',
  limit = 40
): Promise<RouteRankingRow[]> {
  const { minutes } = RANGES[range];
  const r = await pool
    .request()
    .input('minutes', sql.Int, minutes)
    .input('direction', sql.Char(3), direction)
    .input('limit', sql.Int, limit).query(`
      SELECT TOP (@limit)
        route_key, module,
        SUM(CAST(requests AS BIGINT)) AS requests,
        SUM(CAST(errors AS BIGINT)) AS errors,
        SUM(CAST(client_errors AS BIGINT)) AS client_errors,
        SUM(CAST(throttled AS BIGINT)) AS throttled,
        SUM(total_ms) AS total_ms,
        MAX(max_ms) AS max_ms,
        SUM(CAST(p95_ms AS BIGINT) * requests) / NULLIF(SUM(CAST(requests AS BIGINT)), 0) AS p95_ms
      FROM dbo.system_metric_route
      WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
        AND direction = @direction
      GROUP BY route_key, module
      ORDER BY SUM(total_ms) DESC, SUM(CAST(requests AS BIGINT)) DESC`);
  return r.recordset.map((row) => {
    const requests = Number(row.requests) || 0;
    const totalMs = Number(row.total_ms) || 0;
    return {
      direction,
      key: row.route_key,
      module: row.module,
      requests,
      errors: Number(row.errors) || 0,
      clientErrors: Number(row.client_errors) || 0,
      throttled: Number(row.throttled) || 0,
      totalMs,
      maxMs: Number(row.max_ms) || 0,
      avgMs: requests ? Math.round(totalMs / requests) : 0,
      p95Ms: Number(row.p95_ms) || 0,
    };
  });
}

export type ModuleShareRow = { module: string; requests: number; totalMs: number; errors: number };

export async function readModuleShare(pool: Pool, range: RangeKey): Promise<ModuleShareRow[]> {
  const { minutes } = RANGES[range];
  const r = await pool.request().input('minutes', sql.Int, minutes).query(`
      SELECT module,
        SUM(CAST(requests AS BIGINT)) AS requests,
        SUM(total_ms) AS total_ms,
        SUM(CAST(errors AS BIGINT)) AS errors
      FROM dbo.system_metric_route
      WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME()) AND direction = 'in'
      GROUP BY module
      ORDER BY SUM(total_ms) DESC`);
  return r.recordset.map((row) => ({
    module: row.module,
    requests: Number(row.requests) || 0,
    totalMs: Number(row.total_ms) || 0,
    errors: Number(row.errors) || 0,
  }));
}

export type DbSeriesRow = {
  bucket: string;
  hasServerState: boolean;
  sqlCpuPct: number | null;
  otherCpuPct: number | null;
  userConnections: number | null;
  dbSessions: number | null;
  activeRequests: number | null;
  blockedRequests: number | null;
  longestWaitMs: number | null;
  dbSizeMb: number | null;
  logUsedPct: number | null;
};

export async function readDbSeries(pool: Pool, range: RangeKey): Promise<DbSeriesRow[]> {
  const { minutes, bucket } = RANGES[range];
  // La foto de SQL es cada 5 minutos: no tiene sentido agrupar en ventanas más chicas.
  const dbBucket = Math.max(bucket, 5);
  const r = await pool
    .request()
    .input('minutes', sql.Int, minutes)
    .input('bucket', sql.Int, dbBucket).query(`
      SELECT
        ${bucketExpr('sampled_at')} AS bucket,
        CAST(MAX(CAST(has_server_state AS INT)) AS BIT) AS has_server_state,
        AVG(sql_cpu_pct) AS sql_cpu_pct,
        AVG(other_cpu_pct) AS other_cpu_pct,
        MAX(user_connections) AS user_connections,
        MAX(db_sessions) AS db_sessions,
        MAX(active_requests) AS active_requests,
        MAX(blocked_requests) AS blocked_requests,
        MAX(longest_wait_ms) AS longest_wait_ms,
        MAX(db_size_mb) AS db_size_mb,
        MAX(log_used_pct) AS log_used_pct
      FROM dbo.system_metric_db
      WHERE sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
      GROUP BY ${bucketExpr('sampled_at')}
      ORDER BY bucket`);
  return r.recordset.map((row) => ({
    bucket: new Date(row.bucket).toISOString(),
    hasServerState: Boolean(row.has_server_state),
    sqlCpuPct: nullableNumber(row.sql_cpu_pct),
    otherCpuPct: nullableNumber(row.other_cpu_pct),
    userConnections: nullableNumber(row.user_connections),
    dbSessions: nullableNumber(row.db_sessions),
    activeRequests: nullableNumber(row.active_requests),
    blockedRequests: nullableNumber(row.blocked_requests),
    longestWaitMs: nullableNumber(row.longest_wait_ms),
    dbSizeMb: nullableNumber(row.db_size_mb),
    logUsedPct: nullableNumber(row.log_used_pct),
  }));
}

export type PeriodSummary = {
  samples: number;
  requests: number;
  errors: number;
  /** p95 promedio ponderado por peticiones (las ventanas con más tráfico pesan más). */
  p95Ms: number | null;
  hostCpuPct: number | null;
  hostMemUsedPct: number | null;
  maxRssMb: number | null;
  maxEventLoopP99Ms: number | null;
  outRequests: number;
  outErrors: number;
  outThrottled: number;
  maxPoolPending: number | null;
};

/** Resumen del rango actual y del rango inmediatamente anterior (para mostrar la variación). */
export async function readPeriodSummaries(
  pool: Pool,
  range: RangeKey
): Promise<{ current: PeriodSummary; previous: PeriodSummary }> {
  const { minutes } = RANGES[range];
  const r = await pool.request().input('minutes', sql.Int, minutes).query(`
      SELECT
        CASE WHEN sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME()) THEN 'current' ELSE 'previous' END AS period,
        COUNT(*) AS samples,
        SUM(CAST(http_requests AS BIGINT)) AS requests,
        SUM(CAST(http_errors AS BIGINT)) AS errors,
        SUM(CAST(http_p95_ms AS BIGINT) * http_requests) / NULLIF(SUM(CAST(http_requests AS BIGINT)), 0) AS p95_ms,
        AVG(host_cpu_pct) AS host_cpu_pct,
        AVG(host_mem_used_pct) AS host_mem_used_pct,
        MAX(rss_mb) AS max_rss_mb,
        MAX(event_loop_p99_ms) AS max_event_loop_p99_ms,
        SUM(CAST(out_requests AS BIGINT)) AS out_requests,
        SUM(CAST(out_errors AS BIGINT)) AS out_errors,
        SUM(CAST(out_throttled AS BIGINT)) AS out_throttled,
        MAX(pool_pending) AS max_pool_pending
      FROM dbo.system_metric_sample
      WHERE sampled_at >= DATEADD(minute, -2 * @minutes, SYSUTCDATETIME())
      GROUP BY CASE WHEN sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME()) THEN 'current' ELSE 'previous' END`);
  const empty: PeriodSummary = {
    samples: 0,
    requests: 0,
    errors: 0,
    p95Ms: null,
    hostCpuPct: null,
    hostMemUsedPct: null,
    maxRssMb: null,
    maxEventLoopP99Ms: null,
    outRequests: 0,
    outErrors: 0,
    outThrottled: 0,
    maxPoolPending: null,
  };
  const out = { current: { ...empty }, previous: { ...empty } };
  for (const row of r.recordset) {
    const target = row.period === 'current' ? out.current : out.previous;
    Object.assign(target, {
      samples: Number(row.samples) || 0,
      requests: Number(row.requests) || 0,
      errors: Number(row.errors) || 0,
      p95Ms: nullableNumber(row.p95_ms),
      hostCpuPct: nullableNumber(row.host_cpu_pct),
      hostMemUsedPct: nullableNumber(row.host_mem_used_pct),
      maxRssMb: nullableNumber(row.max_rss_mb),
      maxEventLoopP99Ms: nullableNumber(row.max_event_loop_p99_ms),
      outRequests: Number(row.out_requests) || 0,
      outErrors: Number(row.out_errors) || 0,
      outThrottled: Number(row.out_throttled) || 0,
      maxPoolPending: nullableNumber(row.max_pool_pending),
    });
  }
  return out;
}

export type ModuleSeriesRow = { bucket: string; module: string; requests: number; totalMs: number };

/** Tiempo de servidor por módulo y por ventana (para las barras apiladas "Tiempo de servidor"). */
export async function readModuleSeries(pool: Pool, range: RangeKey): Promise<ModuleSeriesRow[]> {
  const { minutes, bucket } = RANGES[range];
  // Las rutas se guardan cada 5 minutos: ventanas más chicas quedarían con huecos.
  const routeBucket = Math.max(bucket, 5);
  const r = await pool
    .request()
    .input('minutes', sql.Int, minutes)
    .input('bucket', sql.Int, routeBucket).query(`
      SELECT ${bucketExpr('bucket_at')} AS bucket, module,
        SUM(CAST(requests AS BIGINT)) AS requests,
        SUM(total_ms) AS total_ms
      FROM dbo.system_metric_route
      WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME()) AND direction = 'in'
      GROUP BY ${bucketExpr('bucket_at')}, module
      ORDER BY bucket`);
  return r.recordset.map((row) => ({
    bucket: new Date(row.bucket).toISOString(),
    module: row.module,
    requests: Number(row.requests) || 0,
    totalMs: Number(row.total_ms) || 0,
  }));
}

export type RouteSeriesRow = {
  bucket: string;
  requests: number;
  errors: number;
  throttled: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
};

/** Historia de UNA ruta o servicio externo (hoja de detalle). */
export async function readRouteSeries(
  pool: Pool,
  range: RangeKey,
  direction: 'in' | 'out',
  key: string
): Promise<RouteSeriesRow[]> {
  const { minutes, bucket } = RANGES[range];
  const r = await pool
    .request()
    .input('minutes', sql.Int, minutes)
    .input('bucket', sql.Int, Math.max(bucket, 5))
    .input('direction', sql.Char(3), direction)
    .input('key', sql.NVarChar(300), key.slice(0, 300)).query(`
      SELECT ${bucketExpr('bucket_at')} AS bucket,
        SUM(CAST(requests AS BIGINT)) AS requests,
        SUM(CAST(errors AS BIGINT)) AS errors,
        SUM(CAST(throttled AS BIGINT)) AS throttled,
        SUM(total_ms) AS total_ms,
        SUM(CAST(p95_ms AS BIGINT) * requests) / NULLIF(SUM(CAST(requests AS BIGINT)), 0) AS p95_ms,
        MAX(max_ms) AS max_ms
      FROM dbo.system_metric_route
      WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
        AND direction = @direction AND route_key = @key
      GROUP BY ${bucketExpr('bucket_at')}
      ORDER BY bucket`);
  return r.recordset.map((row) => {
    const requests = Number(row.requests) || 0;
    return {
      bucket: new Date(row.bucket).toISOString(),
      requests,
      errors: Number(row.errors) || 0,
      throttled: Number(row.throttled) || 0,
      avgMs: requests ? Math.round((Number(row.total_ms) || 0) / requests) : 0,
      p95Ms: Number(row.p95_ms) || 0,
      maxMs: Number(row.max_ms) || 0,
    };
  });
}

export type ProcessLifetimeRow = {
  host: string;
  instance: string;
  pid: number;
  firstSeen: string;
  lastSeen: string;
};

/**
 * Cada proceso (pid) visto en el rango. Si una instancia tiene varios pid, se reinició
 * (pm2 por caída, por memoria o por el cron_restart de las 00:02).
 */
export async function readProcessLifetimes(pool: Pool, range: RangeKey): Promise<ProcessLifetimeRow[]> {
  const { minutes } = RANGES[range];
  const r = await pool.request().input('minutes', sql.Int, minutes).query(`
      SELECT host, instance, pid, MIN(sampled_at) AS first_seen, MAX(sampled_at) AS last_seen
      FROM dbo.system_metric_sample
      WHERE sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
      GROUP BY host, instance, pid
      ORDER BY MIN(sampled_at)`);
  return r.recordset.map((row) => ({
    host: row.host,
    instance: row.instance,
    pid: Number(row.pid),
    firstSeen: new Date(row.first_seen).toISOString(),
    lastSeen: new Date(row.last_seen).toISOString(),
  }));
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
