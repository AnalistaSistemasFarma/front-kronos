import 'server-only';
import { sql } from '../mssqlPool';
import { RANGES, type RangeKey } from '../system-metrics/store';

/** Reads for GET /api/system-metrics/sap (three tabs of the Monitor del sistema). */

type Pool = Awaited<ReturnType<typeof import('../mssqlPool').getPool>>;
type Row = Record<string, unknown>;

const bucketExpr = (column: string) =>
  `DATEADD(minute, (DATEDIFF(minute, '2020-01-01', ${column}) / @bucket) * @bucket, CAST('2020-01-01' AS DATETIME2(0)))`;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const num = (v: unknown) => (v == null ? null : Number(v));
const int = (v: unknown) => Number(v) || 0;

function req(pool: Pool, range: RangeKey) {
  const { minutes, bucket } = RANGES[range];
  return pool.request().input('minutes', sql.Int, minutes).input('bucket', sql.Int, bucket);
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export async function readSapDatabase(pool: Pool, range: RangeKey) {
  const latest = await pool.request().query(`
    SELECT TOP 1 sampled_at, probe_ms, user_sessions, active_requests, blocked, max_block_s, long_requests,
      max_request_s, open_tx, max_tx_s, waits_json, detail_json, error
    FROM dbo.sap_monitor_sample ORDER BY sampled_at DESC`);
  const l = latest.recordset[0] as Row | undefined;

  const series = await req(pool, range).query(`
    SELECT ${bucketExpr('sampled_at')} AS bucket,
      MAX(blocked) AS blocked, MAX(max_block_s) AS max_block_s, MAX(long_requests) AS long_requests,
      MAX(max_request_s) AS max_request_s, MAX(open_tx) AS open_tx, MAX(max_tx_s) AS max_tx_s,
      AVG(CAST(user_sessions AS FLOAT)) AS user_sessions, AVG(CAST(probe_ms AS FLOAT)) AS probe_ms,
      SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS errors
    FROM dbo.sap_monitor_sample
    WHERE sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    GROUP BY ${bucketExpr('sampled_at')}
    ORDER BY bucket`);

  const incidents = await req(pool, range).query(`
    SELECT TOP 100 id, kind, first_seen, last_seen, max_seconds, max_blocked, session_id, database_name, host_name,
      login_name, program_name, wait_resource, statement
    FROM dbo.sap_monitor_incident
    WHERE last_seen >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    ORDER BY last_seen DESC`);

  const alerts = await req(pool, range).query(`
    SELECT TOP 50 raised_at, [rule], severity, title, happening, notified
    FROM dbo.system_metric_alert
    WHERE [rule] LIKE 'sap-%' AND raised_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    ORDER BY raised_at DESC`).catch(() => ({ recordset: [] as Row[] }));

  return {
    latest: l
      ? {
          sampledAt: iso(l.sampled_at),
          probeMs: num(l.probe_ms),
          userSessions: num(l.user_sessions),
          activeRequests: num(l.active_requests),
          blocked: num(l.blocked),
          maxBlockSec: num(l.max_block_s),
          longRequests: num(l.long_requests),
          maxRequestSec: num(l.max_request_s),
          openTx: num(l.open_tx),
          maxTxSec: num(l.max_tx_s),
          waits: parseJson(l.waits_json, [] as unknown[]),
          detail: parseJson(l.detail_json, null as unknown),
          error: (l.error as string | null) ?? null,
        }
      : null,
    series: (series.recordset as Row[]).map((r) => ({
      bucket: iso(r.bucket)!,
      blocked: num(r.blocked),
      maxBlockSec: num(r.max_block_s),
      longRequests: num(r.long_requests),
      maxRequestSec: num(r.max_request_s),
      openTx: num(r.open_tx),
      maxTxSec: num(r.max_tx_s),
      userSessions: num(r.user_sessions),
      probeMs: num(r.probe_ms),
      errors: int(r.errors),
    })),
    incidents: (incidents.recordset as Row[]).map((r) => ({
      id: int(r.id),
      kind: String(r.kind),
      firstSeen: iso(r.first_seen),
      lastSeen: iso(r.last_seen),
      maxSeconds: int(r.max_seconds),
      maxBlocked: num(r.max_blocked),
      sessionId: num(r.session_id),
      databaseName: (r.database_name as string) ?? null,
      hostName: (r.host_name as string) ?? null,
      loginName: (r.login_name as string) ?? null,
      programName: (r.program_name as string) ?? null,
      waitResource: (r.wait_resource as string) ?? null,
      statement: (r.statement as string) ?? null,
    })),
    alerts: (alerts.recordset as Row[]).map((r) => ({
      raisedAt: iso(r.raised_at),
      rule: String(r.rule),
      severity: String(r.severity),
      title: String(r.title),
      happening: String(r.happening),
      notified: int(r.notified),
    })),
  };
}

export async function readSapViews(pool: Pool, range: RangeKey) {
  const sqlSide = await req(pool, range).query(`
    SELECT database_name, view_name, SUM(delta_executions) AS executions, SUM(delta_elapsed_ms) AS elapsed_ms,
      SUM(delta_cpu_ms) AS cpu_ms, SUM(delta_reads) AS reads, MAX(max_elapsed_ms) AS max_elapsed_ms,
      MAX(last_execution_at) AS last_execution_at
    FROM dbo.sap_monitor_view_stat
    WHERE sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    GROUP BY database_name, view_name`);

  const slSide = await req(pool, range).query(`
    SELECT view_name, source_ip, ISNULL(company, '') AS company, SUM(calls) AS calls, SUM(errors) AS errors,
      SUM(timeouts) AS timeouts, SUM(total_ms) AS total_ms, MAX(max_ms) AS max_ms, SUM(bytes) AS bytes,
      MAX(bucket_at) AS last_call
    FROM dbo.sap_monitor_sl_view
    WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    GROUP BY view_name, source_ip, ISNULL(company, '')`);

  const trend = await req(pool, range).query(`
    SELECT ${bucketExpr('bucket_at')} AS bucket, view_name, SUM(calls) AS calls, SUM(timeouts) AS timeouts, SUM(total_ms) AS total_ms
    FROM dbo.sap_monitor_sl_view
    WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    GROUP BY ${bucketExpr('bucket_at')}, view_name
    ORDER BY bucket`);

  const inventory = await pool
    .request()
    .query(`SELECT COUNT(*) AS views, COUNT(DISTINCT database_name) AS dbs, MAX(last_seen) AS refreshed FROM dbo.sap_monitor_view_inventory`);
  const lastSnapshot = await pool.request().query(`SELECT MAX(sampled_at) AS at FROM dbo.sap_monitor_view_stat`);

  return {
    sql: (sqlSide.recordset as Row[]).map((r) => ({
      databaseName: String(r.database_name),
      viewName: String(r.view_name),
      executions: int(r.executions),
      elapsedMs: int(r.elapsed_ms),
      cpuMs: int(r.cpu_ms),
      reads: int(r.reads),
      maxElapsedMs: int(r.max_elapsed_ms),
      lastExecutionAt: iso(r.last_execution_at),
    })),
    sl: (slSide.recordset as Row[]).map((r) => ({
      viewName: String(r.view_name),
      sourceIp: String(r.source_ip),
      company: (r.company as string) || null,
      calls: int(r.calls),
      errors: int(r.errors),
      timeouts: int(r.timeouts),
      totalMs: int(r.total_ms),
      maxMs: int(r.max_ms),
      bytes: int(r.bytes),
      lastCall: iso(r.last_call),
    })),
    trend: (trend.recordset as Row[]).map((r) => ({
      bucket: iso(r.bucket)!,
      viewName: String(r.view_name),
      calls: int(r.calls),
      timeouts: int(r.timeouts),
      totalMs: int(r.total_ms),
    })),
    inventory: {
      views: int((inventory.recordset[0] as Row)?.views),
      databases: int((inventory.recordset[0] as Row)?.dbs),
      refreshedAt: iso((inventory.recordset[0] as Row)?.refreshed),
    },
    lastSnapshotAt: iso((lastSnapshot.recordset[0] as Row)?.at),
  };
}

export async function readSapServiceLayer(pool: Pool, range: RangeKey) {
  const nodes = await pool.request().query(`
    SELECT service, pid, handles, mem_mb, threads, started_at, sampled_at
    FROM dbo.sap_monitor_sl_node
    WHERE sampled_at = (SELECT MAX(sampled_at) FROM dbo.sap_monitor_sl_node)
    ORDER BY service, pid`);

  const series = await req(pool, range).query(`
    SELECT ${bucketExpr('sampled_at')} AS bucket, MAX(handles) AS max_handles, MAX(mem_mb) AS max_mem,
      AVG(CAST(handles AS FLOAT)) AS avg_handles
    FROM dbo.sap_monitor_sl_node
    WHERE sampled_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME()) AND service <> 'b1s50000'
    GROUP BY ${bucketExpr('sampled_at')}
    ORDER BY bucket`);

  const sessions = await req(pool, range).query(`
    SELECT source_ip, company, sl_user, SUM(logins) AS logins, SUM(logouts) AS logouts, SUM(restores) AS restores,
      SUM(failures) AS failures
    FROM dbo.sap_monitor_sl_session
    WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    GROUP BY source_ip, company, sl_user
    ORDER BY SUM(logins) - SUM(logouts) DESC`);

  const hourly = await req(pool, range)
    .input('hourBucket', sql.Int, Math.max(60, RANGES[range].bucket)).query(`
    SELECT DATEADD(minute, (DATEDIFF(minute, '2020-01-01', bucket_at) / @hourBucket) * @hourBucket, CAST('2020-01-01' AS DATETIME2(0))) AS bucket,
      SUM(logins) AS logins, SUM(logouts) AS logouts, SUM(restores) AS restores
    FROM dbo.sap_monitor_sl_session
    WHERE bucket_at >= DATEADD(minute, -@minutes, SYSUTCDATETIME())
    GROUP BY DATEADD(minute, (DATEDIFF(minute, '2020-01-01', bucket_at) / @hourBucket) * @hourBucket, CAST('2020-01-01' AS DATETIME2(0)))
    ORDER BY bucket`);

  return {
    nodes: (nodes.recordset as Row[]).map((r) => ({
      service: String(r.service),
      pid: int(r.pid),
      handles: int(r.handles),
      memMb: int(r.mem_mb),
      threads: num(r.threads),
      startedAt: iso(r.started_at),
      sampledAt: iso(r.sampled_at),
    })),
    series: (series.recordset as Row[]).map((r) => ({
      bucket: iso(r.bucket)!,
      maxHandles: num(r.max_handles),
      avgHandles: num(r.avg_handles),
      maxMemMb: num(r.max_mem),
    })),
    sessions: (sessions.recordset as Row[]).map((r) => ({
      sourceIp: String(r.source_ip),
      company: String(r.company),
      user: String(r.sl_user),
      logins: int(r.logins),
      logouts: int(r.logouts),
      restores: int(r.restores),
      failures: int(r.failures),
    })),
    hourly: (hourly.recordset as Row[]).map((r) => ({
      bucket: iso(r.bucket)!,
      logins: int(r.logins),
      logouts: int(r.logouts),
      restores: int(r.restores),
    })),
  };
}
