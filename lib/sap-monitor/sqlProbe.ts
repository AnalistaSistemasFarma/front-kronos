import 'server-only';
import type mssql from 'mssql';
import { sql } from '../mssqlPool';
import {
  SAP_THRESHOLDS,
  aggregateViewCosts,
  type QueryStatRow,
  type SapBlockerSession,
  type SapOpenTx,
  type SapRequestRow,
  type ViewCost,
  type WaitStatRow,
} from './analysis';
import type { SapSqlConfig } from './config';

/**
 * READ-ONLY probes against the SQL Server of SAP. Minimal impact is the #1 rule:
 *  - its own pool with ONE connection (max 1), app name "SynerLink-MonitorSAP" (visible in SAP's DMVs);
 *  - 5 s query timeout, LOCK_TIMEOUT 1000, READ UNCOMMITTED, DEADLOCK_PRIORITY LOW;
 *  - single attempt per cycle (the job skips a cycle if the previous one is still running);
 *  - only DMVs (no table of SAP is read), no Extended Events, no traces.
 */

const PREAMBLE = `SET NOCOUNT ON; SET LOCK_TIMEOUT 1000; SET DEADLOCK_PRIORITY LOW; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;`;

declare global {
  var __sapMonitorPool: Promise<mssql.ConnectionPool> | undefined;
  var __sapMonitorPoolKey: string | undefined;
}

export async function getSapPool(config: SapSqlConfig): Promise<mssql.ConnectionPool> {
  const key = `${config.server}:${config.port}/${config.database}/${config.user}`;
  if (globalThis.__sapMonitorPool && globalThis.__sapMonitorPoolKey === key) return globalThis.__sapMonitorPool;
  const pool = new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { encrypt: config.encrypt, trustServerCertificate: config.trustServerCertificate, appName: 'SynerLink-MonitorSAP' },
    connectionTimeout: 5000,
    requestTimeout: 5000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 120_000 },
  });
  const promise = pool.connect().catch((error) => {
    globalThis.__sapMonitorPool = undefined;
    throw error;
  });
  globalThis.__sapMonitorPool = promise;
  globalThis.__sapMonitorPoolKey = key;
  return promise;
}

export async function closeSapPool(): Promise<void> {
  const p = globalThis.__sapMonitorPool;
  globalThis.__sapMonitorPool = undefined;
  if (p) await p.then((pool) => pool.close()).catch(() => undefined);
}

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const s = (v: unknown) => (v == null ? null : String(v));
const clean = (v: unknown, max = 400) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max));

export type SqlSnapshot = {
  probeMs: number;
  hasServerState: boolean;
  userSessions: number;
  activeRequests: number;
  requests: SapRequestRow[];
  blockers: SapBlockerSession[];
  openTx: SapOpenTx[];
  waits: WaitStatRow[];
};

/**
 * The 60-second probe: one round trip, several small result sets.
 *  1. permission check + counters
 *  2. requests that are blocked, block others, or run >= longRequestSec
 *  3. head blockers that have no running request (sleeping with an open transaction)
 *  4. user transactions open >= openTxSec (+ lock count only for those sessions)
 *  5. cumulative wait stats of the interesting families (delta is computed in memory)
 */
export async function probeSapSql(pool: mssql.ConnectionPool): Promise<SqlSnapshot> {
  const t0 = Date.now();
  const r = await pool
    .request()
    .input('longSec', sql.Int, SAP_THRESHOLDS.longRequestSec)
    .input('txSec', sql.Int, SAP_THRESHOLDS.openTxSec).query(`${PREAMBLE}
SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS vss,
  (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND session_id <> @@SPID) AS user_sessions,
  (SELECT COUNT(*) FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    WHERE s.is_user_process = 1 AND r.session_id <> @@SPID) AS active_requests;

SELECT TOP (60)
  r.session_id, r.blocking_session_id, r.status, r.command, r.wait_type, r.wait_time, r.wait_resource,
  DATEDIFF(second, r.start_time, GETDATE()) AS running_s, DB_NAME(r.database_id) AS database_name,
  r.open_transaction_count, s.host_name, s.login_name, s.program_name,
  DATEDIFF(second, '2020-01-01', s.login_time) AS session_start, DATEDIFF(second, '2020-01-01', r.start_time) AS request_start,
  LEFT(SUBSTRING(t.text, (r.statement_start_offset / 2) + 1,
    ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE r.statement_end_offset END - r.statement_start_offset) / 2) + 1), 400) AS statement
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE s.is_user_process = 1 AND r.session_id <> @@SPID
  AND (r.blocking_session_id > 0
       OR r.start_time < DATEADD(second, -@longSec, GETDATE())
       OR r.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0))
ORDER BY r.start_time;

SELECT TOP (20)
  s.session_id, s.status, s.host_name, s.login_name, s.program_name, DB_NAME(s.database_id) AS database_name,
  s.open_transaction_count, DATEDIFF(second, s.last_request_end_time, GETDATE()) AS idle_s,
  DATEDIFF(second, '2020-01-01', s.login_time) AS session_start, LEFT(t.text, 400) AS last_statement
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id AND c.parent_connection_id IS NULL
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t
WHERE s.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0)
  AND s.session_id NOT IN (SELECT session_id FROM sys.dm_exec_requests);

SELECT TOP (30)
  st.session_id, DATEDIFF(second, at.transaction_begin_time, GETDATE()) AS open_s, at.name,
  s.host_name, s.login_name, s.program_name, s.status, DB_NAME(s.database_id) AS database_name,
  DATEDIFF(second, '2020-01-01', s.login_time) AS session_start, LEFT(t.text, 400) AS last_statement
FROM sys.dm_tran_session_transactions st
JOIN sys.dm_tran_active_transactions at ON at.transaction_id = st.transaction_id
JOIN sys.dm_exec_sessions s ON s.session_id = st.session_id
LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id AND c.parent_connection_id IS NULL
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t
WHERE st.is_user_transaction = 1 AND s.is_user_process = 1 AND st.session_id <> @@SPID
  AND at.transaction_begin_time < DATEADD(second, -@txSec, GETDATE())
ORDER BY at.transaction_begin_time;

SELECT wait_type, waiting_tasks_count, wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 0
  AND (wait_type LIKE 'LCK[_]%' OR wait_type LIKE 'PAGEIOLATCH[_]%' OR wait_type LIKE 'PAGELATCH[_]%'
       OR wait_type LIKE 'RESOURCE_SEMAPHORE%' OR wait_type IN ('WRITELOG', 'ASYNC_NETWORK_IO', 'CXPACKET',
       'SOS_SCHEDULER_YIELD', 'THREADPOOL', 'IO_COMPLETION', 'LATCH_EX', 'LATCH_SH', 'CMEMTHREAD'));`);

  const sets = r.recordsets as unknown as Array<Array<Record<string, unknown>>>;
  const head = sets[0]?.[0] ?? {};
  const requests: SapRequestRow[] = (sets[1] ?? []).map((x) => ({
    sessionId: n(x.session_id),
    blockingSessionId: n(x.blocking_session_id),
    status: s(x.status),
    command: s(x.command),
    waitType: s(x.wait_type),
    waitMs: n(x.wait_time),
    waitResource: clean(x.wait_resource, 256),
    runningSec: Math.max(0, n(x.running_s)),
    databaseName: s(x.database_name),
    openTransactions: n(x.open_transaction_count),
    hostName: s(x.host_name),
    loginName: s(x.login_name),
    programName: clean(x.program_name, 128),
    statement: clean(x.statement),
    sessionStart: x.session_start == null ? null : String(x.session_start),
    requestStart: x.request_start == null ? null : String(x.request_start),
  }));
  const blockers: SapBlockerSession[] = (sets[2] ?? []).map((x) => ({
    sessionId: n(x.session_id),
    status: s(x.status),
    hostName: s(x.host_name),
    loginName: s(x.login_name),
    programName: clean(x.program_name, 128),
    databaseName: s(x.database_name),
    openTransactions: n(x.open_transaction_count),
    idleSec: x.idle_s == null ? null : n(x.idle_s),
    lastStatement: clean(x.last_statement),
    sessionStart: x.session_start == null ? null : String(x.session_start),
  }));
  const openTx: SapOpenTx[] = (sets[3] ?? []).map((x) => ({
    sessionId: n(x.session_id),
    openSec: n(x.open_s),
    name: s(x.name),
    hostName: s(x.host_name),
    loginName: s(x.login_name),
    programName: clean(x.program_name, 128),
    databaseName: s(x.database_name),
    sessionStatus: s(x.status),
    lastStatement: clean(x.last_statement),
    sessionStart: x.session_start == null ? null : String(x.session_start),
    locks: null,
  }));
  const waits: WaitStatRow[] = (sets[4] ?? []).map((x) => ({
    waitType: String(x.wait_type),
    tasks: n(x.waiting_tasks_count),
    waitMs: n(x.wait_time_ms),
  }));

  return {
    probeMs: Date.now() - t0,
    hasServerState: n(head.vss) === 1,
    userSessions: n(head.user_sessions),
    activeRequests: n(head.active_requests),
    requests,
    blockers,
    openTx,
    waits,
  };
}

/**
 * Cost of the *B1SLQuery views from the plan cache (every 15 min). Only the TOP 400 statements by
 * elapsed time executed in the last 6 h are looked at (the text is fetched for those only).
 */
export async function probeViewCosts(pool: mssql.ConnectionPool): Promise<{ probeMs: number; views: ViewCost[] }> {
  const t0 = Date.now();
  const r = await pool.request().query(`${PREAMBLE}
SELECT q.execution_count, q.total_elapsed_time / 1000 AS total_elapsed_ms, q.total_worker_time / 1000 AS total_cpu_ms,
  q.total_logical_reads, q.max_elapsed_time / 1000 AS max_elapsed_ms,
  DATEDIFF(second, q.last_execution_time, GETDATE()) AS last_s,
  DB_NAME(CONVERT(INT, pa.value)) AS database_name, LEFT(st.text, 4000) AS text
FROM (
  SELECT TOP (400) sql_handle, plan_handle, execution_count, total_elapsed_time, total_worker_time,
    total_logical_reads, max_elapsed_time, last_execution_time
  FROM sys.dm_exec_query_stats
  WHERE last_execution_time >= DATEADD(hour, -6, GETDATE())
  ORDER BY total_elapsed_time DESC
) q
CROSS APPLY sys.dm_exec_sql_text(q.sql_handle) st
OUTER APPLY (SELECT value FROM sys.dm_exec_plan_attributes(q.plan_handle) WHERE attribute = N'dbid') pa
WHERE st.text LIKE N'%B1SLQuery%';`);
  const now = Date.now();
  const rows: QueryStatRow[] = (r.recordset as Array<Record<string, unknown>>).map((x) => ({
    databaseName: s(x.database_name),
    text: String(x.text ?? ''),
    executions: n(x.execution_count),
    totalElapsedMs: n(x.total_elapsed_ms),
    totalCpuMs: n(x.total_cpu_ms),
    totalReads: n(x.total_logical_reads),
    maxElapsedMs: n(x.max_elapsed_ms),
    lastExecutionAt: x.last_s == null ? null : new Date(now - n(x.last_s) * 1000).toISOString(),
  }));
  return { probeMs: Date.now() - t0, views: aggregateViewCosts(rows) };
}

/** *B1SLQuery views of every company database the login can reach (needs CONNECT ANY DATABASE). Every 6 h. */
export async function probeViewInventory(
  pool: mssql.ConnectionPool
): Promise<Array<{ databaseName: string; viewName: string; modifiedAt: string | null }>> {
  const r = await pool.request().query(`${PREAMBLE}
CREATE TABLE #v (database_name SYSNAME, view_name SYSNAME, modify_s INT);
DECLARE @q NVARCHAR(MAX) = N'';
SELECT @q = @q + N'BEGIN TRY INSERT INTO #v SELECT ' + QUOTENAME(name, '''') + N', v.name, DATEDIFF(second, v.modify_date, GETDATE()) FROM '
  + QUOTENAME(name) + N'.sys.views v WHERE v.name LIKE N''%B1SLQuery''; END TRY BEGIN CATCH END CATCH; '
FROM sys.databases
WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1 AND name NOT IN (N'SBO-COMMON');
IF LEN(@q) > 0 EXEC sys.sp_executesql @q;
SELECT database_name, view_name, modify_s FROM #v;
DROP TABLE #v;`);
  const now = Date.now();
  return (r.recordset as Array<Record<string, unknown>>).map((x) => ({
    databaseName: String(x.database_name),
    viewName: String(x.view_name),
    modifiedAt: x.modify_s == null ? null : new Date(now - n(x.modify_s) * 1000).toISOString(),
  }));
}

/**
 * Lock count per session, only for the few sessions that already matter (head blockers, open
 * transactions). Runs only when there is something to explain, never on a quiet minute.
 */
export async function probeLockCounts(pool: mssql.ConnectionPool, sessionIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(sessionIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 20);
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const r = await pool.request().query(`${PREAMBLE}
SELECT request_session_id AS session_id, COUNT(*) AS locks
FROM sys.dm_tran_locks
WHERE request_session_id IN (${ids.join(',')}) AND resource_type <> 'DATABASE'
GROUP BY request_session_id;`);
  for (const x of r.recordset as Array<Record<string, unknown>>) out.set(n(x.session_id), n(x.locks));
  return out;
}
