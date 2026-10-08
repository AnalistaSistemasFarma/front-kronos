import 'server-only';
import type sql from 'mssql';

/**
 * Lecturas de SOLO LECTURA sobre las vistas del sistema de SQL Server (DMVs) para el Monitor
 * del sistema. Varias requieren el permiso VIEW SERVER STATE: sin él SQL Server solo deja ver
 * la propia sesión, así que esos valores se devuelven en `null` (no en 0, que confundiría) y
 * `hasServerState` queda en false para que la pantalla lo explique.
 *
 * Cada lectura va en su propio try: si una vista no existe (p. ej. Azure SQL) o falla, las
 * demás siguen.
 */

export type DbSample = {
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

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function hasViewServerState(pool: sql.ConnectionPool): Promise<boolean> {
  const r = await safe(() =>
    pool.request().query<{ p: number }>(`SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS p`)
  );
  return r?.recordset?.[0]?.p === 1;
}

/** Foto periódica (la guarda el colector cada 5 minutos). */
export async function probeDatabase(pool: sql.ConnectionPool): Promise<DbSample> {
  const hasServerState = await hasViewServerState(pool);

  const size = await safe(() =>
    pool
      .request()
      .query<{ mb: number }>(`SELECT CAST(SUM(CAST(size AS BIGINT)) * 8 / 1024 AS INT) AS mb FROM sys.database_files`)
  );
  const log = await safe(() =>
    pool
      .request()
      .query<{ pct: number }>(`SELECT CAST(used_log_space_in_percent AS DECIMAL(5,2)) AS pct FROM sys.dm_db_log_space_usage`)
  );

  const sample: DbSample = {
    hasServerState,
    sqlCpuPct: null,
    otherCpuPct: null,
    userConnections: null,
    dbSessions: null,
    activeRequests: null,
    blockedRequests: null,
    longestWaitMs: null,
    dbSizeMb: num(size?.recordset?.[0]?.mb),
    logUsedPct: num(log?.recordset?.[0]?.pct),
  };

  if (!hasServerState) return sample;

  // CPU: último registro del monitor de schedulers (se actualiza cada minuto en SQL Server).
  const cpu = await safe(() =>
    pool.request().query<{ sql_cpu: number; idle: number }>(`
      SELECT TOP 1
        rec.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu,
        rec.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS idle
      FROM (
        SELECT CONVERT(XML, record) AS rec, [timestamp]
        FROM sys.dm_os_ring_buffers
        WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
          AND record LIKE N'%<SystemHealth>%'
      ) AS x
      ORDER BY [timestamp] DESC`)
  );
  const cpuRow = cpu?.recordset?.[0];
  if (cpuRow) {
    const sqlCpu = num(cpuRow.sql_cpu);
    const idle = num(cpuRow.idle);
    sample.sqlCpuPct = sqlCpu;
    sample.otherCpuPct = sqlCpu != null && idle != null ? Math.max(0, 100 - idle - sqlCpu) : null;
  }

  const activity = await safe(() =>
    pool.request().query<{
      user_connections: number;
      db_sessions: number;
      active_requests: number;
      blocked_requests: number;
      longest_wait_ms: number | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS user_connections,
        (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND database_id = DB_ID()) AS db_sessions,
        (SELECT COUNT(*) FROM sys.dm_exec_requests r
           JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
          WHERE r.database_id = DB_ID() AND r.session_id <> @@SPID AND s.is_user_process = 1) AS active_requests,
        (SELECT COUNT(*) FROM sys.dm_exec_requests
          WHERE database_id = DB_ID() AND blocking_session_id > 0) AS blocked_requests,
        (SELECT MAX(wait_time) FROM sys.dm_exec_requests
          WHERE database_id = DB_ID() AND blocking_session_id > 0) AS longest_wait_ms`)
  );
  const a = activity?.recordset?.[0];
  if (a) {
    sample.userConnections = num(a.user_connections);
    sample.dbSessions = num(a.db_sessions);
    sample.activeRequests = num(a.active_requests);
    sample.blockedRequests = num(a.blocked_requests);
    sample.longestWaitMs = num(a.longest_wait_ms) ?? 0;
  }

  return sample;
}

export type DbConnectionOrigin = {
  hostName: string;
  programName: string;
  loginName: string;
  sessions: number;
  running: number;
};

export type DbBlockedRequest = {
  sessionId: number;
  blockingSessionId: number;
  waitType: string | null;
  waitMs: number;
  command: string | null;
  hostName: string | null;
  programName: string | null;
  statement: string | null;
};

export type DbTopQuery = {
  statement: string;
  executions: number;
  totalCpuMs: number;
  avgCpuMs: number;
  avgElapsedMs: number;
  avgLogicalReads: number;
  lastExecution: string | null;
};

export type DbLiveDetail = {
  hasServerState: boolean;
  queryStore: string | null;
  sqlServerStartedAt: string | null;
  connections: DbConnectionOrigin[];
  blocked: DbBlockedRequest[];
  topQueries: DbTopQuery[];
};

/** Detalle "en vivo" que se consulta solo cuando alguien abre la pantalla (con caché corto). */
export async function readDbLiveDetail(pool: sql.ConnectionPool): Promise<DbLiveDetail> {
  const hasServerState = await hasViewServerState(pool);

  const qs = await safe(() =>
    pool
      .request()
      .query<{ state: string }>(`SELECT actual_state_desc AS state FROM sys.database_query_store_options`)
  );

  const detail: DbLiveDetail = {
    hasServerState,
    queryStore: qs?.recordset?.[0]?.state ?? null,
    sqlServerStartedAt: null,
    connections: [],
    blocked: [],
    topQueries: [],
  };

  if (!hasServerState) return detail;

  const started = await safe(() =>
    pool.request().query<{ t: Date }>(`SELECT sqlserver_start_time AS t FROM sys.dm_os_sys_info`)
  );
  const startedAt = started?.recordset?.[0]?.t;
  detail.sqlServerStartedAt = startedAt ? new Date(startedAt).toISOString() : null;

  const conns = await safe(() =>
    pool.request().query<{
      host_name: string | null;
      program_name: string | null;
      login_name: string | null;
      sessions: number;
      running: number;
    }>(`
      SELECT TOP 25
        host_name, program_name, login_name,
        COUNT(*) AS sessions,
        SUM(CASE WHEN status IN ('running', 'runnable', 'suspended') THEN 1 ELSE 0 END) AS running
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1 AND database_id = DB_ID()
      GROUP BY host_name, program_name, login_name
      ORDER BY COUNT(*) DESC`)
  );
  detail.connections = (conns?.recordset ?? []).map((r) => ({
    hostName: r.host_name ?? '(sin nombre)',
    programName: r.program_name ?? '(sin nombre)',
    loginName: r.login_name ?? '',
    sessions: Number(r.sessions) || 0,
    running: Number(r.running) || 0,
  }));

  const blocked = await safe(() =>
    pool.request().query<{
      session_id: number;
      blocking_session_id: number;
      wait_type: string | null;
      wait_time: number;
      command: string | null;
      host_name: string | null;
      program_name: string | null;
      statement: string | null;
    }>(`
      SELECT TOP 20
        r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, r.command,
        s.host_name, s.program_name,
        LEFT(t.text, 300) AS statement
      FROM sys.dm_exec_requests r
      JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE r.blocking_session_id > 0
      ORDER BY r.wait_time DESC`)
  );
  detail.blocked = (blocked?.recordset ?? []).map((r) => ({
    sessionId: r.session_id,
    blockingSessionId: r.blocking_session_id,
    waitType: r.wait_type,
    waitMs: Number(r.wait_time) || 0,
    command: r.command,
    hostName: r.host_name,
    programName: r.program_name,
    statement: r.statement,
  }));

  // Consultas de ESTA base que más CPU han consumido desde que su plan está en caché.
  const top = await safe(() =>
    pool.request().query<{
      statement: string | null;
      execution_count: number;
      total_cpu_ms: number;
      avg_cpu_ms: number;
      avg_elapsed_ms: number;
      avg_logical_reads: number;
      last_execution_time: Date | null;
    }>(`
      SELECT TOP 15
        LEFT(SUBSTRING(st.text, (qs.statement_start_offset / 2) + 1,
          ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text) ELSE qs.statement_end_offset END
            - qs.statement_start_offset) / 2) + 1), 400) AS statement,
        qs.execution_count,
        qs.total_worker_time / 1000 AS total_cpu_ms,
        qs.total_worker_time / 1000 / NULLIF(qs.execution_count, 0) AS avg_cpu_ms,
        qs.total_elapsed_time / 1000 / NULLIF(qs.execution_count, 0) AS avg_elapsed_ms,
        qs.total_logical_reads / NULLIF(qs.execution_count, 0) AS avg_logical_reads,
        qs.last_execution_time
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
      CROSS APPLY (
        SELECT CONVERT(INT, value) AS dbid
        FROM sys.dm_exec_plan_attributes(qs.plan_handle)
        WHERE attribute = N'dbid'
      ) pa
      WHERE pa.dbid = DB_ID()
      ORDER BY qs.total_worker_time DESC`)
  );
  detail.topQueries = (top?.recordset ?? []).map((r) => ({
    statement: (r.statement ?? '').replace(/\s+/g, ' ').trim(),
    executions: Number(r.execution_count) || 0,
    totalCpuMs: Number(r.total_cpu_ms) || 0,
    avgCpuMs: Number(r.avg_cpu_ms) || 0,
    avgElapsedMs: Number(r.avg_elapsed_ms) || 0,
    avgLogicalReads: Number(r.avg_logical_reads) || 0,
    lastExecution: r.last_execution_time ? new Date(r.last_execution_time).toISOString() : null,
  }));

  return detail;
}
