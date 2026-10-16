import 'server-only';
import type mssql from 'mssql';
import { sql } from '../mssqlPool';
import type { LogContext } from './logHealth';

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

// Las horas de las DMV vienen en hora local del servidor y el driver las leería como UTC; por eso
// se piden como segundos transcurridos.
function secondsAgoIso(seconds: unknown, now = Date.now()): string | null {
  const n = num(seconds);
  return n == null ? null : new Date(now - n * 1000).toISOString();
}

/**
 * Estado del log de transacciones de una base (por defecto, la de Kronos): modelo de
 * recuperación, por qué no se libera, si puede crecer y cuánto disco le queda. Lo juzga
 * judgeLog (logHealth.ts). Solo lectura; el disco y el historial de respaldos pueden faltar
 * por permisos y entonces quedan en null.
 */
export async function readLogContext(pool: mssql.ConnectionPool, database?: string): Promise<LogContext | null> {
  const name =
    database ?? (await safe(() => pool.request().query<{ db: string }>('SELECT DB_NAME() AS db')))?.recordset?.[0]?.db;
  if (!name) return null;

  const files = await safe(() =>
    pool.request().input('name', sql.NVarChar(128), name).query<{
      recovery: string;
      reuse_wait: string;
      size_mb: number;
      can_grow: number;
      unlimited: number;
      file_room_mb: number | null;
    }>(`
      SELECT d.recovery_model_desc AS recovery, d.log_reuse_wait_desc AS reuse_wait,
        SUM(CAST(f.size AS BIGINT)) * 8 / 1024 AS size_mb,
        MAX(CASE WHEN f.growth > 0 AND (f.max_size = -1 OR f.size < f.max_size) THEN 1 ELSE 0 END) AS can_grow,
        MAX(CASE WHEN f.growth > 0 AND f.max_size = -1 THEN 1 ELSE 0 END) AS unlimited,
        SUM(CASE WHEN f.growth > 0 AND f.max_size > 0 AND f.size < f.max_size
          THEN CAST(f.max_size - f.size AS BIGINT) * 8 / 1024 END) AS file_room_mb
      FROM sys.databases d
      JOIN sys.master_files f ON f.database_id = d.database_id AND f.type_desc = 'LOG'
      WHERE d.name = @name
      GROUP BY d.recovery_model_desc, d.log_reuse_wait_desc`)
  );
  const f = files?.recordset?.[0];
  if (!f) return null;

  const volume = await safe(() =>
    pool.request().input('name', sql.NVarChar(128), name).query<{ free_mb: number }>(`
      SELECT MIN(v.available_bytes) / 1048576 AS free_mb
      FROM sys.master_files mf
      CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) v
      WHERE mf.database_id = DB_ID(@name) AND mf.type_desc = 'LOG'`)
  );
  const backups = await safe(() =>
    pool.request().input('name', sql.NVarChar(128), name).query<{ minutes: number | null }>(`
      SELECT DATEDIFF(minute, MAX(backup_finish_date), GETDATE()) AS minutes
      FROM msdb.dbo.backupset
      WHERE database_name = @name AND type = 'L'`)
  );

  const volumeFreeMb = num(volume?.recordset?.[0]?.free_mb);
  const canGrow = f.can_grow === 1;
  const fileRoom = f.unlimited === 1 ? null : num(f.file_room_mb);
  const roomMb = !canGrow
    ? 0
    : fileRoom != null && volumeFreeMb != null
      ? Math.min(fileRoom, volumeFreeMb)
      : fileRoom ?? volumeFreeMb;
  const minutes = num(backups?.recordset?.[0]?.minutes);
  return {
    database: name,
    recoveryModel: f.recovery ?? null,
    reuseWait: f.reuse_wait ?? null,
    sizeMb: num(f.size_mb),
    canGrow,
    roomMb,
    volumeFreeMb,
    lastLogBackupHours: minutes == null ? null : Math.round((minutes / 60) * 10) / 10,
    backupHistoryKnown: backups != null,
  };
}

export async function hasViewServerState(pool: mssql.ConnectionPool): Promise<boolean> {
  const r = await safe(() =>
    pool.request().query<{ p: number }>(`SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS p`)
  );
  return r?.recordset?.[0]?.p === 1;
}

/** Foto periódica (la guarda el colector cada 5 minutos). */
export async function probeDatabase(pool: mssql.ConnectionPool): Promise<DbSample> {
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

export type DbServerOrigin = DbConnectionOrigin & {
  databaseName: string;
  /** CPU acumulada de sus sesiones abiertas (desde que cada una se conectó). */
  cpuMs: number;
  lastActivity: string | null;
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
  /** Base a la que está conectado Kronos (para separar sus conexiones de las de otras apps). */
  databaseName: string | null;
  sqlServerStartedAt: string | null;
  connections: DbConnectionOrigin[];
  /** Todo lo conectado al servidor SQL (todas las bases), agrupado por máquina/programa. */
  origins: DbServerOrigin[];
  blocked: DbBlockedRequest[];
  topQueries: DbTopQuery[];
  /** Log de transacciones de la base de Kronos, ahora. */
  logUsedPct: number | null;
  log: LogContext | null;
};

/** Detalle "en vivo" que se consulta solo cuando alguien abre la pantalla (con caché corto). */
export async function readDbLiveDetail(pool: mssql.ConnectionPool): Promise<DbLiveDetail> {
  const hasServerState = await hasViewServerState(pool);

  const qs = await safe(() =>
    pool
      .request()
      .query<{ state: string; db: string }>(
        `SELECT actual_state_desc AS state, DB_NAME() AS db FROM sys.database_query_store_options`
      )
  );

  const detail: DbLiveDetail = {
    hasServerState,
    queryStore: qs?.recordset?.[0]?.state ?? null,
    databaseName: qs?.recordset?.[0]?.db ?? null,
    sqlServerStartedAt: null,
    connections: [],
    origins: [],
    blocked: [],
    topQueries: [],
    logUsedPct: null,
    log: null,
  };

  const logPct = await safe(() =>
    pool
      .request()
      .query<{ pct: number }>(`SELECT CAST(used_log_space_in_percent AS DECIMAL(5,2)) AS pct FROM sys.dm_db_log_space_usage`)
  );
  detail.logUsedPct = num(logPct?.recordset?.[0]?.pct);
  detail.log = await safe(() => readLogContext(pool));

  if (!hasServerState) return detail;

  const started = await safe(() =>
    pool
      .request()
      .query<{ s: number }>(`SELECT DATEDIFF(second, sqlserver_start_time, GETDATE()) AS s FROM sys.dm_os_sys_info`)
  );
  detail.sqlServerStartedAt = secondsAgoIso(started?.recordset?.[0]?.s);

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

  // Todo lo que está conectado al SQL Server (no solo a esta base ni solo Kronos), para el mapa.
  // Misma vista liviana que la consulta de arriba; la respuesta queda en caché 30 s.
  const origins = await safe(() =>
    pool.request().query<{
      host_name: string | null;
      program_name: string | null;
      login_name: string | null;
      database_name: string | null;
      sessions: number;
      running: number;
      cpu_ms: number | null;
      idle_seconds: number | null;
    }>(`
      SELECT TOP 40
        host_name, program_name, login_name, DB_NAME(database_id) AS database_name,
        COUNT(*) AS sessions,
        SUM(CASE WHEN status IN ('running', 'runnable', 'suspended') THEN 1 ELSE 0 END) AS running,
        SUM(CAST(cpu_time AS BIGINT)) AS cpu_ms,
        DATEDIFF(second, MAX(last_request_end_time), GETDATE()) AS idle_seconds
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1 AND session_id <> @@SPID
      GROUP BY host_name, program_name, login_name, database_id
      ORDER BY COUNT(*) DESC`)
  );
  detail.origins = (origins?.recordset ?? []).map((r) => ({
    hostName: r.host_name ?? '(sin nombre)',
    programName: r.program_name ?? '(sin nombre)',
    loginName: r.login_name ?? '',
    databaseName: r.database_name ?? '',
    sessions: Number(r.sessions) || 0,
    running: Number(r.running) || 0,
    cpuMs: Number(r.cpu_ms) || 0,
    lastActivity: secondsAgoIso(r.idle_seconds),
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
      last_execution_seconds: number | null;
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
        DATEDIFF(second, qs.last_execution_time, GETDATE()) AS last_execution_seconds
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
    lastExecution: secondsAgoIso(r.last_execution_seconds),
  }));

  return detail;
}
