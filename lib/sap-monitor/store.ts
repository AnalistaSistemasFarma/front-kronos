import 'server-only';
import { sql } from '../mssqlPool';
import type { IncidentObservation, SlNodeSample, ViewCostDelta, WaitDelta } from './analysis';

/**
 * Tables of the SAP monitor in KRONOSDB (prisma/manual/2026-11-20-monitor-sap-*.sql). No Prisma
 * model: without the tables the writes fail with error 208 and the job pauses (isMissingTableError).
 */

type Pool = Awaited<ReturnType<typeof import('../mssqlPool').getPool>>;

export type SapSampleRow = {
  sampledAt: string;
  probeMs: number | null;
  userSessions: number | null;
  activeRequests: number | null;
  blocked: number | null;
  maxBlockSec: number | null;
  longRequests: number | null;
  maxRequestSec: number | null;
  openTx: number | null;
  maxTxSec: number | null;
  waits: WaitDelta[];
  detail: unknown | null;
  error: string | null;
};

export async function insertSapSample(
  pool: Pool,
  at: Date,
  s: Omit<SapSampleRow, 'sampledAt' | 'waits' | 'detail'> & { waits: WaitDelta[]; detail: unknown | null }
): Promise<void> {
  await pool
    .request()
    .input('at', sql.DateTime2(0), at)
    .input('probe_ms', sql.Int, s.probeMs)
    .input('user_sessions', sql.Int, s.userSessions)
    .input('active_requests', sql.Int, s.activeRequests)
    .input('blocked', sql.Int, s.blocked)
    .input('max_block_s', sql.Int, s.maxBlockSec)
    .input('long_requests', sql.Int, s.longRequests)
    .input('max_request_s', sql.Int, s.maxRequestSec)
    .input('open_tx', sql.Int, s.openTx)
    .input('max_tx_s', sql.Int, s.maxTxSec)
    .input('waits', sql.NVarChar(2000), s.waits.length ? JSON.stringify(s.waits).slice(0, 2000) : null)
    .input('detail', sql.NVarChar(sql.MAX), s.detail == null ? null : JSON.stringify(s.detail))
    .input('error', sql.NVarChar(300), s.error?.slice(0, 300) ?? null).query(`
      INSERT INTO dbo.sap_monitor_sample (sampled_at, probe_ms, user_sessions, active_requests, blocked, max_block_s,
        long_requests, max_request_s, open_tx, max_tx_s, waits_json, detail_json, error)
      VALUES (@at, @probe_ms, @user_sessions, @active_requests, @blocked, @max_block_s,
        @long_requests, @max_request_s, @open_tx, @max_tx_s, @waits, @detail, @error)`);
}

export async function upsertIncidents(pool: Pool, at: Date, list: IncidentObservation[]): Promise<void> {
  for (const o of list.slice(0, 40)) {
    await pool
      .request()
      .input('at', sql.DateTime2(0), at)
      .input('key', sql.NVarChar(120), o.key)
      .input('kind', sql.VarChar(20), o.kind)
      .input('seconds', sql.Int, Math.round(o.seconds))
      .input('blocked', sql.Int, o.blocked)
      .input('session_id', sql.Int, o.sessionId)
      .input('db', sql.NVarChar(128), o.databaseName?.slice(0, 128) ?? null)
      .input('host', sql.NVarChar(128), o.hostName?.slice(0, 128) ?? null)
      .input('login', sql.NVarChar(128), o.loginName?.slice(0, 128) ?? null)
      .input('program', sql.NVarChar(128), o.programName?.slice(0, 128) ?? null)
      .input('wait_resource', sql.NVarChar(256), o.waitResource?.slice(0, 256) ?? null)
      .input('statement', sql.NVarChar(400), o.statement?.slice(0, 400) ?? null).query(`
        UPDATE dbo.sap_monitor_incident
          SET last_seen = @at,
              max_seconds = CASE WHEN @seconds > max_seconds THEN @seconds ELSE max_seconds END,
              max_blocked = CASE WHEN @blocked > ISNULL(max_blocked, 0) THEN @blocked ELSE max_blocked END,
              statement = COALESCE(@statement, statement)
          WHERE incident_key = @key;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.sap_monitor_incident (incident_key, kind, first_seen, last_seen, max_seconds, max_blocked,
            session_id, database_name, host_name, login_name, program_name, wait_resource, statement)
          VALUES (@key, @kind, DATEADD(second, -@seconds, @at), @at, @seconds, @blocked,
            @session_id, @db, @host, @login, @program, @wait_resource, @statement);`);
  }
}

export async function insertViewStats(pool: Pool, at: Date, views: ViewCostDelta[]): Promise<void> {
  for (const v of views.slice(0, 200)) {
    await pool
      .request()
      .input('at', sql.DateTime2(0), at)
      .input('db', sql.NVarChar(128), v.databaseName.slice(0, 128))
      .input('view', sql.NVarChar(128), v.viewName.slice(0, 128))
      .input('plans', sql.Int, v.plans)
      .input('exec', sql.BigInt, v.executions)
      .input('elapsed', sql.BigInt, Math.round(v.totalElapsedMs))
      .input('cpu', sql.BigInt, Math.round(v.totalCpuMs))
      .input('reads', sql.BigInt, Math.round(v.totalReads))
      .input('max', sql.BigInt, Math.round(v.maxElapsedMs))
      .input('last', sql.DateTime2(0), v.lastExecutionAt ? new Date(v.lastExecutionAt) : null)
      .input('d_exec', sql.BigInt, v.deltaExecutions)
      .input('d_elapsed', sql.BigInt, v.deltaElapsedMs == null ? null : Math.round(v.deltaElapsedMs))
      .input('d_cpu', sql.BigInt, v.deltaCpuMs == null ? null : Math.round(v.deltaCpuMs))
      .input('d_reads', sql.BigInt, v.deltaReads == null ? null : Math.round(v.deltaReads)).query(`
        INSERT INTO dbo.sap_monitor_view_stat (sampled_at, database_name, view_name, plans, executions, total_elapsed_ms,
          total_cpu_ms, total_reads, max_elapsed_ms, last_execution_at, delta_executions, delta_elapsed_ms, delta_cpu_ms, delta_reads)
        VALUES (@at, @db, @view, @plans, @exec, @elapsed, @cpu, @reads, @max, @last, @d_exec, @d_elapsed, @d_cpu, @d_reads)`);
  }
}

export async function upsertViewInventory(
  pool: Pool,
  at: Date,
  views: Array<{ databaseName: string; viewName: string; modifiedAt: string | null }>
): Promise<void> {
  for (const v of views.slice(0, 2000)) {
    await pool
      .request()
      .input('at', sql.DateTime2(0), at)
      .input('db', sql.NVarChar(128), v.databaseName.slice(0, 128))
      .input('view', sql.NVarChar(128), v.viewName.slice(0, 128))
      .input('mod', sql.DateTime2(0), v.modifiedAt ? new Date(v.modifiedAt) : null).query(`
        UPDATE dbo.sap_monitor_view_inventory SET last_seen = @at, modified_at = @mod WHERE database_name = @db AND view_name = @view;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.sap_monitor_view_inventory (database_name, view_name, modified_at, first_seen, last_seen)
          VALUES (@db, @view, @mod, @at, @at);`);
  }
}

// ---------------------------------------------------------------------------
// Service Layer (from the collector on the horus Mac, via the ingest API)
// ---------------------------------------------------------------------------

export type SlViewCall = {
  bucketAt: string;
  view: string;
  sourceIp: string;
  company: string | null;
  calls: number;
  errors: number;
  timeouts: number;
  totalMs: number;
  maxMs: number;
  bytes: number;
};

export type SlViewCallDetail = {
  at: string;
  view: string;
  sourceIp: string;
  status: number;
  durationMs: number;
  timeout: boolean;
  query: string | null;
  node: string | null;
  company: string | null;
  user: string | null;
  bytes: number;
};

export type SlSessionCount = {
  bucketAt: string;
  sourceIp: string;
  company: string;
  user: string;
  logins: number;
  logouts: number;
  restores: number;
  failures: number;
};

export async function insertSlNodes(pool: Pool, at: Date, nodes: SlNodeSample[]): Promise<void> {
  for (const nd of nodes.slice(0, 64)) {
    await pool
      .request()
      .input('at', sql.DateTime2(0), at)
      .input('service', sql.NVarChar(40), nd.service.slice(0, 40))
      .input('pid', sql.Int, nd.pid)
      .input('handles', sql.Int, nd.handles)
      .input('mem', sql.Int, nd.memMb)
      .input('threads', sql.Int, nd.threads)
      .input('started', sql.DateTime2(0), nd.startedAt ? new Date(nd.startedAt) : null).query(`
        INSERT INTO dbo.sap_monitor_sl_node (sampled_at, service, pid, handles, mem_mb, threads, started_at)
        VALUES (@at, @service, @pid, @handles, @mem, @threads, @started)`);
  }
}

export async function insertSlViewCalls(pool: Pool, rows: SlViewCall[]): Promise<void> {
  for (const v of rows.slice(0, 2000)) {
    await pool
      .request()
      .input('bucket', sql.DateTime2(0), new Date(v.bucketAt))
      .input('view', sql.NVarChar(128), v.view.slice(0, 128))
      .input('ip', sql.VarChar(45), v.sourceIp.slice(0, 45))
      .input('company', sql.NVarChar(128), v.company?.slice(0, 128) ?? null)
      .input('calls', sql.Int, v.calls)
      .input('errors', sql.Int, v.errors)
      .input('timeouts', sql.Int, v.timeouts)
      .input('total', sql.BigInt, Math.round(v.totalMs))
      .input('max', sql.Int, Math.round(v.maxMs))
      .input('bytes', sql.BigInt, Math.round(v.bytes)).query(`
        INSERT INTO dbo.sap_monitor_sl_view (bucket_at, view_name, source_ip, company, calls, errors, timeouts, total_ms, max_ms, bytes)
        VALUES (@bucket, @view, @ip, @company, @calls, @errors, @timeouts, @total, @max, @bytes)`);
  }
}

export async function insertSlSessions(pool: Pool, rows: SlSessionCount[]): Promise<void> {
  for (const v of rows.slice(0, 2000)) {
    await pool
      .request()
      .input('bucket', sql.DateTime2(0), new Date(v.bucketAt))
      .input('ip', sql.VarChar(45), v.sourceIp.slice(0, 45))
      .input('company', sql.NVarChar(128), v.company.slice(0, 128))
      .input('user', sql.NVarChar(128), v.user.slice(0, 128))
      .input('logins', sql.Int, v.logins)
      .input('logouts', sql.Int, v.logouts)
      .input('restores', sql.Int, v.restores)
      .input('failures', sql.Int, v.failures).query(`
        INSERT INTO dbo.sap_monitor_sl_session (bucket_at, source_ip, company, sl_user, logins, logouts, restores, failures)
        VALUES (@bucket, @ip, @company, @user, @logins, @logouts, @restores, @failures)`);
  }
}

export async function insertSlViewCallDetails(pool: Pool, rows: SlViewCallDetail[]): Promise<void> {
  for (const v of rows.slice(0, 1000)) {
    await pool
      .request()
      .input('at', sql.DateTime2(0), new Date(v.at))
      .input('view', sql.NVarChar(128), v.view.slice(0, 128))
      .input('ip', sql.VarChar(45), v.sourceIp.slice(0, 45))
      .input('status', sql.SmallInt, v.status)
      .input('dur', sql.Int, Math.round(v.durationMs))
      .input('timeout', sql.Bit, v.timeout ? 1 : 0)
      .input('query', sql.NVarChar(1000), v.query?.slice(0, 1000) ?? null)
      .input('node', sql.VarChar(40), v.node?.slice(0, 40) ?? null)
      .input('company', sql.NVarChar(128), v.company?.slice(0, 128) ?? null)
      .input('user', sql.NVarChar(128), v.user?.slice(0, 128) ?? null)
      .input('bytes', sql.BigInt, Math.round(v.bytes)).query(`
        INSERT INTO dbo.sap_monitor_sl_view_call (called_at, view_name, source_ip, status, duration_ms, timed_out, query, node, company, sl_user, bytes)
        VALUES (@at, @view, @ip, @status, @dur, @timeout, @query, @node, @company, @user, @bytes)`);
  }
}

/** Timeouts per view in the last `minutes` (for the alert rule). */
export async function readRecentViewTimeouts(
  pool: Pool,
  minutes: number
): Promise<Array<{ viewName: string; timeouts: number; calls: number; sources: string[]; maxMs: number }>> {
  const r = await pool.request().input('min', sql.Int, minutes).query(`
    SELECT view_name, source_ip, SUM(timeouts) AS timeouts, SUM(calls) AS calls, MAX(max_ms) AS max_ms
    FROM dbo.sap_monitor_sl_view
    WHERE bucket_at >= DATEADD(minute, -@min, SYSUTCDATETIME())
    GROUP BY view_name, source_ip`);
  const map = new Map<string, { viewName: string; timeouts: number; calls: number; sources: string[]; maxMs: number }>();
  for (const x of r.recordset as Array<Record<string, unknown>>) {
    const name = String(x.view_name);
    const v = map.get(name) ?? { viewName: name, timeouts: 0, calls: 0, sources: [], maxMs: 0 };
    v.timeouts += Number(x.timeouts) || 0;
    v.calls += Number(x.calls) || 0;
    v.maxMs = Math.max(v.maxMs, Number(x.max_ms) || 0);
    if ((Number(x.timeouts) || 0) > 0) v.sources.push(String(x.source_ip));
    map.set(name, v);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export async function deleteOldSapMetrics(pool: Pool, retentionDays: number): Promise<number> {
  const tables: Array<[string, string]> = [
    ['dbo.sap_monitor_sample', 'sampled_at'],
    ['dbo.sap_monitor_incident', 'last_seen'],
    ['dbo.sap_monitor_view_stat', 'sampled_at'],
    ['dbo.sap_monitor_view_inventory', 'last_seen'],
    ['dbo.sap_monitor_sl_view', 'bucket_at'],
    ['dbo.sap_monitor_sl_node', 'sampled_at'],
    ['dbo.sap_monitor_sl_session', 'bucket_at'],
    ['dbo.sap_monitor_sl_view_call', 'called_at'],
  ];
  let total = 0;
  for (const [table, column] of tables) {
    // Small batches: never hold long locks on KRONOSDB.
    for (let i = 0; i < 50; i++) {
      const r = await pool
        .request()
        .input('days', sql.Int, retentionDays)
        .query(`DELETE TOP (5000) FROM ${table} WHERE ${column} < DATEADD(day, -@days, SYSUTCDATETIME())`);
      const n = r.rowsAffected?.[0] ?? 0;
      total += n;
      if (n < 5000) break;
    }
  }
  return total;
}
