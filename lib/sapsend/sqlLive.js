import { withMonitorSqlPool } from './monitorPool.js';
import { classifyProgram } from './companyMap.js';

/**
 * Lecturas SOLO LECTURA (DMVs) para el Monitor SAPSEND.
 * Requiere VIEW SERVER STATE (ya otorgado al login de Kronos).
 */

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn('[sapsend/sqlLive]', err?.message || err);
    return null;
  }
}

function num(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @typedef {{
 *   database: string,
 *   sessions: number,
 *   running: number,
 *   blocked: number,
 *   byProgram: { serviceLayer: number, sapsend: number, sapClient: number, kronos: number, other: number }
 * }} DbConcurrency
 */

/**
 * Concurrencia por base (sesiones de usuario) + desglose por tipo de programa.
 * @returns {Promise<{ hasServerState: boolean, byDatabase: Map<string, DbConcurrency> }>}
 */
export async function readSapsendSapConcurrency() {
  return withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    const hasServerState = perm.recordset[0]?.ok === 1;
    /** @type {Map<string, DbConcurrency>} */
    const byDatabase = new Map();

    if (!hasServerState) return { hasServerState, byDatabase };

    const r = await safe(() =>
      pool.request().query(`
        SELECT
          ISNULL(DB_NAME(s.database_id), '(sin-db)') AS database_name,
          s.program_name,
          COUNT(*) AS sessions,
          SUM(CASE WHEN s.status IN ('running', 'runnable', 'suspended') THEN 1 ELSE 0 END) AS running,
          SUM(CASE WHEN ISNULL(r.blocking_session_id, 0) > 0 THEN 1 ELSE 0 END) AS blocked
        FROM sys.dm_exec_sessions s
        LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
        WHERE s.is_user_process = 1
          AND s.session_id <> @@SPID
        GROUP BY s.database_id, s.program_name
      `)
    );

    for (const row of r?.recordset ?? []) {
      const database = String(row.database_name);
      const kind = classifyProgram(row.program_name);
      let cur = byDatabase.get(database);
      if (!cur) {
        cur = {
          database,
          sessions: 0,
          running: 0,
          blocked: 0,
          byProgram: { serviceLayer: 0, sapsend: 0, sapClient: 0, kronos: 0, other: 0 },
        };
        byDatabase.set(database, cur);
      }
      const sessions = num(row.sessions);
      cur.sessions += sessions;
      cur.running += num(row.running);
      cur.blocked += num(row.blocked);
      cur.byProgram[kind] = (cur.byProgram[kind] || 0) + sessions;
    }

    return { hasServerState, byDatabase };
  });
}

/**
 * Cadenas de bloqueo actuales en todo el SQL (solo lectura).
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readBlockingChains() {
  return withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];

    const r = await safe(() =>
      pool.request().query(`
        SELECT TOP 40
          DB_NAME(r.database_id) AS database_name,
          r.session_id AS blocked_session_id,
          r.blocking_session_id,
          r.wait_type,
          r.wait_time AS wait_ms,
          r.command,
          bs.program_name AS blocked_program,
          bk.program_name AS blocking_program,
          bs.login_name AS blocked_login,
          bk.login_name AS blocking_login,
          SUBSTRING(
            ISNULL(bt.text, N''),
            (r.statement_start_offset / 2) + 1,
            CASE
              WHEN r.statement_end_offset <= 0 THEN 4000
              ELSE (r.statement_end_offset - r.statement_start_offset) / 2 + 1
            END
          ) AS blocked_sql,
          SUBSTRING(ISNULL(kt.text, N''), 1, 4000) AS blocking_sql
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions bs ON bs.session_id = r.session_id
        LEFT JOIN sys.dm_exec_sessions bk ON bk.session_id = r.blocking_session_id
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) bt
        OUTER APPLY (
          SELECT sql_handle
          FROM sys.dm_exec_requests
          WHERE session_id = r.blocking_session_id
        ) bkReq
        OUTER APPLY sys.dm_exec_sql_text(bkReq.sql_handle) kt
        WHERE r.blocking_session_id > 0
        ORDER BY r.wait_time DESC
      `)
    );

    return (r?.recordset ?? []).map((row) => ({
      database: row.database_name ? String(row.database_name) : null,
      blockedSessionId: num(row.blocked_session_id),
      blockingSessionId: num(row.blocking_session_id),
      waitType: row.wait_type ? String(row.wait_type) : null,
      waitMs: num(row.wait_ms),
      blockedProgram: row.blocked_program ? String(row.blocked_program) : null,
      blockingProgram: row.blocking_program ? String(row.blocking_program) : null,
      blockedLogin: row.blocked_login ? String(row.blocked_login) : null,
      blockingLogin: row.blocking_login ? String(row.blocking_login) : null,
      blockedSql: row.blocked_sql ? String(row.blocked_sql).slice(0, 2000) : null,
      blockingSql: row.blocking_sql ? String(row.blocking_sql).slice(0, 2000) : null,
    }));
  });
}

/**
 * Consultas activas con más de `minMs` de elapsed (por defecto 5 s).
 */
export async function readHeavyRequests(minMs = 5000) {
  return withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];

    const r = await safe(() =>
      pool
        .request()
        .input('minMs', minMs)
        .query(`
          SELECT TOP 40
            DB_NAME(r.database_id) AS database_name,
            r.session_id,
            s.program_name,
            s.login_name,
            r.status,
            r.wait_type,
            r.total_elapsed_time AS elapsed_ms,
            r.cpu_time AS cpu_ms,
            SUBSTRING(
              ISNULL(t.text, N''),
              (r.statement_start_offset / 2) + 1,
              CASE
                WHEN r.statement_end_offset <= 0 THEN 4000
                ELSE (r.statement_end_offset - r.statement_start_offset) / 2 + 1
              END
            ) AS sql_text
          FROM sys.dm_exec_requests r
          INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
          OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
          WHERE s.is_user_process = 1
            AND r.session_id <> @@SPID
            AND r.total_elapsed_time >= @minMs
          ORDER BY r.total_elapsed_time DESC
        `)
    );

    return (r?.recordset ?? []).map((row) => ({
      database: row.database_name ? String(row.database_name) : null,
      sessionId: num(row.session_id),
      programName: row.program_name ? String(row.program_name) : null,
      loginName: row.login_name ? String(row.login_name) : null,
      status: row.status ? String(row.status) : null,
      waitType: row.wait_type ? String(row.wait_type) : null,
      elapsedMs: num(row.elapsed_ms),
      cpuMs: num(row.cpu_ms),
      sqlText: row.sql_text ? String(row.sql_text).slice(0, 2000) : null,
    }));
  });
}

/**
 * Equipos / programas / usuarios SQL conectados a las bases SAPSEND* y de SAP
 * visibles en este SQL (SBO-COMMON, SLDModel). Solo lectura (DMVs).
 * @returns {Promise<Array<{ database: string, host: string, program: string, kind: string, login: string, sessions: number, running: number, lastRequestAt: string | null }>>}
 */
export async function readSapsendConnections() {
  return withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];

    const r = await safe(() =>
      pool.request().query(`
        SELECT TOP 300
          DB_NAME(s.database_id) AS database_name,
          ISNULL(NULLIF(LTRIM(RTRIM(s.host_name)), ''), '(sin equipo)') AS host_name,
          ISNULL(s.program_name, '') AS program_name,
          ISNULL(s.login_name, '') AS login_name,
          COUNT(*) AS sessions,
          SUM(CASE WHEN s.status IN ('running', 'runnable', 'suspended') THEN 1 ELSE 0 END) AS running,
          MAX(s.last_request_end_time) AS last_request_at
        FROM sys.dm_exec_sessions s
        WHERE s.is_user_process = 1
          AND s.session_id <> @@SPID
          AND (
            DB_NAME(s.database_id) LIKE 'SAPSEND%'
            OR DB_NAME(s.database_id) IN ('SBO-COMMON', 'SLDModel')
          )
        GROUP BY s.database_id, s.host_name, s.program_name, s.login_name
        ORDER BY COUNT(*) DESC
      `)
    );

    return (r?.recordset ?? []).map((row) => ({
      database: String(row.database_name || ''),
      host: String(row.host_name || ''),
      program: String(row.program_name || ''),
      kind: classifyProgram(row.program_name),
      login: String(row.login_name || ''),
      sessions: num(row.sessions),
      running: num(row.running),
      lastRequestAt: row.last_request_at ? new Date(row.last_request_at).toISOString() : null,
    }));
  });
}

/* ------------------------------------------------------------------------ */
/* Consultas por SAPSEND (caché de planes + en ejecución)                    */
/* ------------------------------------------------------------------------ */

/** Lectura (SELECT) o escritura (INSERT/UPDATE/DELETE/MERGE) según el texto de la consulta. */
export function statementKind(sqlText) {
  const t = String(sqlText || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/^\s*\([^)]*\)\s*/, '') // parámetros de sp_executesql: (@P1 int,...)
    .trim()
    .toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|MERGE)\b/.test(t)) return 'escritura';
  if (/^WITH\b/.test(t)) return /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(t) ? 'escritura' : 'lectura';
  if (/^SELECT\b/.test(t)) return 'lectura';
  if (/^(EXEC|EXECUTE)\b/.test(t)) return 'procedimiento';
  return 'otro';
}

/** Actividad por base SAPSEND entre lecturas (diferencias), última hora. */
const DB_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;
/** @type {Array<{ at: number, database: string, executions: number, cpuMs: number, elapsedMs: number, reads: number, writes: number }>} */
const dbActivity = [];

/** Lo que hizo cada SAPSEND en la última hora (desde que el monitor empezó a leer). */
export function getSapsendDbActivity() {
  return dbActivity.slice();
}

const QUERY_STATS_CACHE_MS = 30_000;
/** @type {{ at: number, rows: Array<Record<string, unknown>> } | null} */
let queryStatsCache = null;
/** @type {Promise<Array<Record<string, unknown>>> | null} */
let queryStatsInflight = null;
/**
 * Totales anteriores por (base|query_hash) para calcular ejecuciones/min "ahora".
 * @type {Map<string, { at: number, executions: number, totalMs: number, cpuMs?: number }>}
 */
const prevTotals = new Map();

/**
 * Ranking de consultas de cada base SAPSEND* desde la caché de planes del SQL Server
 * (sys.dm_exec_query_stats). SOLO LECTURA; no requiere acceso a las bases SAPSEND.
 *
 * - Agrupa por query_hash (misma consulta con distintos parámetros = una fila).
 * - Solo planes usados en la última hora (limita el costo de la consulta).
 * - Caché de 30 s: varias personas mirando el monitor no repiten la consulta.
 * - perMin / avgMsNow salen de la diferencia contra la lectura anterior (tiempo real).
 */
export async function readSapsendQueryStats() {
  if (queryStatsCache && Date.now() - queryStatsCache.at < QUERY_STATS_CACHE_MS) {
    return queryStatsCache.rows;
  }
  if (queryStatsInflight) return queryStatsInflight;

  queryStatsInflight = withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];

    const r = await safe(() =>
      pool.request().query(`
        WITH q AS (
          SELECT
            CONVERT(int, pa.value) AS dbid,
            qs.query_hash,
            qs.execution_count,
            qs.total_elapsed_time,
            qs.max_elapsed_time,
            qs.total_worker_time,
            qs.total_logical_reads,
            qs.total_rows,
            qs.last_execution_time,
            qs.creation_time,
            qs.sql_handle,
            qs.statement_start_offset,
            qs.statement_end_offset,
            ROW_NUMBER() OVER (
              PARTITION BY CONVERT(int, pa.value), qs.query_hash
              ORDER BY qs.last_execution_time DESC
            ) AS rn
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_plan_attributes(qs.plan_handle) pa
          WHERE pa.attribute = 'dbid'
            AND qs.last_execution_time >= DATEADD(HOUR, -1, GETDATE())
        ),
        f AS (
          SELECT * FROM q WHERE DB_NAME(dbid) LIKE 'SAPSEND%'
        ),
        agg AS (
          SELECT
            dbid,
            query_hash,
            SUM(execution_count) AS executions,
            SUM(total_elapsed_time) / 1000.0 AS total_ms,
            MAX(max_elapsed_time) / 1000.0 AS max_ms,
            SUM(total_worker_time) / 1000.0 AS cpu_ms,
            SUM(total_logical_reads) AS reads,
            SUM(total_rows) AS rows_out,
            MAX(last_execution_time) AS last_exec,
            MIN(creation_time) AS since
          FROM f
          GROUP BY dbid, query_hash
        )
        SELECT TOP 300
          DB_NAME(a.dbid) AS database_name,
          CONVERT(varchar(20), a.query_hash, 1) AS query_hash,
          a.executions, a.total_ms, a.max_ms, a.cpu_ms, a.reads, a.rows_out,
          a.last_exec, a.since,
          SUBSTRING(
            ISNULL(t.text, N''),
            (s.statement_start_offset / 2) + 1,
            CASE
              WHEN s.statement_end_offset <= 0 THEN 4000
              ELSE (s.statement_end_offset - s.statement_start_offset) / 2 + 1
            END
          ) AS sql_text
        FROM agg a
        INNER JOIN f s ON s.dbid = a.dbid AND s.query_hash = a.query_hash AND s.rn = 1
        OUTER APPLY sys.dm_exec_sql_text(s.sql_handle) t
        ORDER BY a.total_ms DESC
      `)
    );

    const now = Date.now();
    /** Actividad de cada SAPSEND desde la lectura anterior (para "Tiempo de CPU" por hora). */
    const perDb = new Map();
    const rows = (r?.recordset ?? []).map((row) => {
      const database = String(row.database_name || '');
      const hash = String(row.query_hash || '');
      const executions = num(row.executions);
      const totalMs = num(row.total_ms);
      const cpuMs = num(row.cpu_ms);
      const sqlText = row.sql_text ? String(row.sql_text).trim().slice(0, 2000) : null;
      const kind = statementKind(sqlText);
      const key = `${database}|${hash}`;
      const prev = prevTotals.get(key);
      let perMin = null;
      let avgMsNow = null;
      if (prev && executions >= prev.executions && now > prev.at) {
        const dExec = executions - prev.executions;
        perMin = Math.round((dExec / ((now - prev.at) / 60000)) * 10) / 10;
        avgMsNow = dExec > 0 ? Math.round((totalMs - prev.totalMs) / dExec) : null;
        const acc = perDb.get(database) ?? { executions: 0, cpuMs: 0, elapsedMs: 0, reads: 0, writes: 0 };
        acc.executions += dExec;
        acc.cpuMs += Math.max(0, cpuMs - (prev.cpuMs ?? cpuMs));
        acc.elapsedMs += Math.max(0, totalMs - prev.totalMs);
        if (kind === 'escritura') acc.writes += dExec;
        else if (kind === 'lectura') acc.reads += dExec;
        perDb.set(database, acc);
      }
      prevTotals.set(key, { at: now, executions, totalMs, cpuMs });
      return {
        database,
        queryHash: hash,
        kind,
        executions,
        totalMs: Math.round(totalMs),
        avgMs: executions > 0 ? Math.round(totalMs / executions) : null,
        maxMs: Math.round(num(row.max_ms)),
        cpuMs: Math.round(num(row.cpu_ms)),
        reads: num(row.reads),
        rows: num(row.rows_out),
        lastExecAt: row.last_exec ? new Date(row.last_exec).toISOString() : null,
        since: row.since ? new Date(row.since).toISOString() : null,
        perMin,
        avgMsNow,
        sqlText,
      };
    });
    for (const [database, acc] of perDb) dbActivity.push({ at: now, database, ...acc });
    const cut = now - DB_ACTIVITY_WINDOW_MS;
    while (dbActivity.length && dbActivity[0].at < cut) dbActivity.shift();
    return rows;
  })
    .then((rows) => {
      queryStatsCache = { at: Date.now(), rows };
      // No dejar crecer el mapa con consultas que ya salieron de la caché de planes.
      if (prevTotals.size > 3000) prevTotals.clear();
      return rows;
    })
    .finally(() => {
      queryStatsInflight = null;
    });

  return queryStatsInflight;
}

const SQL_CPU_CACHE_MS = 60_000;
/** @type {{ at: number, rows: Array<{ at: string, sqlCpuPct: number | null, otherCpuPct: number | null }> } | null} */
let sqlCpuCache = null;

/**
 * CPU del SQL Server minuto a minuto (última hora), del monitor de schedulers que el propio
 * SQL Server guarda en memoria (sys.dm_os_ring_buffers): no hace falta tabla propia.
 * Mismo cálculo que lib/system-metrics/dbProbe.ts. Caché de 60 s (el dato es por minuto).
 */
export async function readSqlCpuSeries() {
  if (sqlCpuCache && Date.now() - sqlCpuCache.at < SQL_CPU_CACHE_MS) return sqlCpuCache.rows;
  const rows = await withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];
    const r = await safe(() =>
      pool.request().query(`
        DECLARE @now BIGINT = (SELECT ms_ticks FROM sys.dm_os_sys_info);
        SELECT TOP 60
          DATEADD(ms, -1 * (@now - x.[timestamp]), SYSUTCDATETIME()) AS at,
          rec.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu,
          rec.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS idle
        FROM (
          SELECT CONVERT(XML, record) AS rec, [timestamp]
          FROM sys.dm_os_ring_buffers
          WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
            AND record LIKE N'%<SystemHealth>%'
        ) AS x
        ORDER BY x.[timestamp] DESC
      `)
    );
    return (r?.recordset ?? [])
      .map((row) => {
        const sqlCpu = row.sql_cpu == null ? null : num(row.sql_cpu);
        const idle = row.idle == null ? null : num(row.idle);
        return {
          at: new Date(row.at).toISOString(),
          sqlCpuPct: sqlCpu,
          otherCpuPct: sqlCpu != null && idle != null ? Math.max(0, 100 - idle - sqlCpu) : null,
        };
      })
      .reverse();
  });
  sqlCpuCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Consultas ejecutándose AHORA en bases SAPSEND* (sin umbral de tiempo).
 */
export async function readSapsendRunningNow() {
  return withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];

    const r = await safe(() =>
      pool.request().query(`
        SELECT TOP 100
          DB_NAME(r.database_id) AS database_name,
          r.session_id,
          s.host_name,
          s.program_name,
          r.status,
          r.command,
          r.wait_type,
          r.blocking_session_id,
          r.total_elapsed_time AS elapsed_ms,
          r.cpu_time AS cpu_ms,
          r.logical_reads,
          SUBSTRING(
            ISNULL(t.text, N''),
            (r.statement_start_offset / 2) + 1,
            CASE
              WHEN r.statement_end_offset <= 0 THEN 4000
              ELSE (r.statement_end_offset - r.statement_start_offset) / 2 + 1
            END
          ) AS sql_text
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE s.is_user_process = 1
          AND r.session_id <> @@SPID
          AND DB_NAME(r.database_id) LIKE 'SAPSEND%'
        ORDER BY r.total_elapsed_time DESC
      `)
    );

    return (r?.recordset ?? []).map((row) => ({
      database: String(row.database_name || ''),
      sessionId: num(row.session_id),
      host: row.host_name ? String(row.host_name) : null,
      programName: row.program_name ? String(row.program_name) : null,
      status: row.status ? String(row.status) : null,
      command: row.command ? String(row.command) : null,
      waitType: row.wait_type ? String(row.wait_type) : null,
      blockingSessionId: num(row.blocking_session_id),
      elapsedMs: num(row.elapsed_ms),
      cpuMs: num(row.cpu_ms),
      reads: num(row.logical_reads),
      sqlText: row.sql_text ? String(row.sql_text).trim().slice(0, 2000) : null,
    }));
  });
}

/**
 * Bases SAPSEND* que existen en el SQL Server monitoreado (no depende de SynerLink).
 * sys.databases es visible para cualquier login.
 */
export async function readSapsendDatabases() {
  return withMonitorSqlPool(async (pool) => {
    const r = await safe(() =>
      pool.request().query(`
        SELECT name, state_desc FROM sys.databases WHERE name LIKE 'SAPSEND%' ORDER BY name
      `)
    );
    return (r?.recordset ?? []).map((row) => ({
      name: String(row.name),
      online: String(row.state_desc || '').toUpperCase() === 'ONLINE',
    }));
  });
}

/** Herramientas que usa una persona a mano (no un servicio). */
const INTERACTIVE_TOOLS =
  /Management Studio|Azure Data Studio|DBeaver|DataGrip|HeidiSQL|LINQPad|Toad|SQLCMD|Microsoft Office|Excel|Access|Power BI|Mashup Engine|Visual Studio|Report Builder|Query Analyzer/i;

/** Prefijos de los servidores autorizados (por defecto SERFARMA); configurable. */
function serviceHostPrefixes() {
  const raw = process.env.SAPSEND_MONITOR_SERVICE_HOSTS || 'SERFARMA';
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * ¿La conexión es de un servicio o de una persona con su propia cuenta?
 * - persona: usa una herramienta interactiva (SSMS, Excel, Power BI…) o entra con una cuenta de
 *   Windows (DOMINIO\usuario) desde un equipo que no es un servidor autorizado.
 * - servicio: viene de un servidor autorizado (SERFARMA*) con un programa que no es interactivo.
 * - revisar: cualquier otro caso (por ejemplo, un usuario SQL desde otra máquina).
 * @returns {{ type: 'servicio' | 'persona' | 'revisar', reason: string }}
 */
export function classifyAccount(login, host, program) {
  const h = String(host || '').toUpperCase();
  const p = String(program || '');
  const l = String(login || '');
  const fromServiceHost = serviceHostPrefixes().some((pre) => h.startsWith(pre));
  if (INTERACTIVE_TOOLS.test(p)) {
    const tool = p.replace(/\s*-\s*Query$/i, '').replace(/^Microsoft\s+/i, '').slice(0, 60);
    const who = l.includes('\\') ? `su cuenta ${l}` : `el usuario compartido ${l}`;
    return {
      type: 'persona',
      reason: `Entra a mano con ${tool} usando ${who}${fromServiceHost ? ' (desde el servidor)' : ''}`,
    };
  }
  if (fromServiceHost) return { type: 'servicio', reason: 'Servidor autorizado' };
  if (l.includes('\\')) return { type: 'persona', reason: `Cuenta de Windows desde el equipo ${host}` };
  return { type: 'revisar', reason: `Usuario SQL desde un equipo que no es servidor autorizado (${host})` };
}

/** Lecturas anteriores por sesión para calcular el consumo "ahora" (entre actualizaciones). */
/** @type {Map<string, { at: number, cpu: number, reads: number, writes: number }>} */
const prevSessionTotals = new Map();

/**
 * Quién consume cada SAPSEND: por usuario SQL + equipo + programa + base.
 * - Acumulado desde que cada sesión se conectó (cpu_time, logical_reads, writes).
 * - "Ahora" = diferencia contra la actualización anterior (CPU ms, lecturas y escrituras
 *   de páginas en ese intervalo).
 */
export async function readSapsendLogins() {
  return withMonitorSqlPool(async (pool) => {
    const perm = await pool.request().query(`
      SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS ok
    `);
    if (perm.recordset[0]?.ok !== 1) return [];
    const r = await safe(() =>
      pool.request().query(`
        SELECT
          s.session_id,
          CONVERT(varchar(30), s.login_time, 126) AS login_time,
          DB_NAME(s.database_id) AS database_name,
          ISNULL(NULLIF(LTRIM(RTRIM(s.login_name)), ''), '(sin usuario)') AS login_name,
          ISNULL(NULLIF(LTRIM(RTRIM(s.host_name)), ''), '(sin equipo)') AS host_name,
          ISNULL(s.program_name, '') AS program_name,
          -- Solo con autenticación de Windows: la cuenta real de la persona (dominio y usuario).
          NULLIF(LTRIM(RTRIM(s.nt_domain)), '') AS nt_domain,
          NULLIF(LTRIM(RTRIM(s.nt_user_name)), '') AS nt_user_name,
          c.client_net_address,
          s.status,
          s.cpu_time,
          s.logical_reads,
          s.writes,
          s.last_request_end_time
        FROM sys.dm_exec_sessions s
        OUTER APPLY (
          SELECT TOP 1 ec.client_net_address
          FROM sys.dm_exec_connections ec
          WHERE ec.session_id = s.session_id
        ) c
        WHERE s.is_user_process = 1
          AND s.session_id <> @@SPID
          AND DB_NAME(s.database_id) LIKE 'SAPSEND%'
      `)
    );
    const now = Date.now();
    const seen = new Set();
    /** @type {Map<string, any>} */
    const groups = new Map();
    for (const row of r?.recordset ?? []) {
      const sid = `${row.session_id}|${row.login_time}`;
      seen.add(sid);
      const cpu = num(row.cpu_time);
      const reads = num(row.logical_reads);
      const writes = num(row.writes);
      const prev = prevSessionTotals.get(sid);
      prevSessionTotals.set(sid, { at: now, cpu, reads, writes });
      const database = String(row.database_name || '');
      const login = String(row.login_name);
      const host = String(row.host_name);
      // Un mismo equipo puede tener sesiones del servicio y de una persona (p. ej. alguien abre
      // SSMS por escritorio remoto en el servidor): se separan para no marcar todo como persona.
      const manual = INTERACTIVE_TOOLS.test(String(row.program_name || ''));
      const key = `${login}|${host}|${manual ? 'manual' : 'app'}`;
      const g = groups.get(key) ?? {
        key,
        login,
        host,
        ntUsers: new Set(),
        addresses: new Set(),
        programs: new Set(),
        kinds: new Set(),
        databases: new Map(),
        sessions: 0,
        running: 0,
        cpuMs: 0,
        reads: 0,
        writes: 0,
        cpuMsNow: 0,
        readsNow: 0,
        writesNow: 0,
        lastRequestAt: 0,
      };
      g.sessions += 1;
      if (['running', 'runnable', 'suspended'].includes(String(row.status))) g.running += 1;
      g.cpuMs += cpu;
      g.reads += reads;
      g.writes += writes;
      if (prev) {
        g.cpuMsNow += Math.max(0, cpu - prev.cpu);
        g.readsNow += Math.max(0, reads - prev.reads);
        g.writesNow += Math.max(0, writes - prev.writes);
      }
      if (row.program_name) g.programs.add(String(row.program_name));
      if (row.nt_user_name) g.ntUsers.add(row.nt_domain ? `${row.nt_domain}\\${row.nt_user_name}` : String(row.nt_user_name));
      if (row.client_net_address) g.addresses.add(String(row.client_net_address));
      g.kinds.add(classifyProgram(row.program_name));
      g.databases.set(database, (g.databases.get(database) ?? 0) + cpu);
      const last = row.last_request_end_time ? new Date(row.last_request_end_time).getTime() : 0;
      g.lastRequestAt = Math.max(g.lastRequestAt, last);
      groups.set(key, g);
    }
    for (const sid of prevSessionTotals.keys()) if (!seen.has(sid)) prevSessionTotals.delete(sid);

    return [...groups.values()]
      .map((g) => {
        // La peor clasificación de sus programas (si una sesión es manual, la conexión es "persona").
        const classes = (g.programs.size ? [...g.programs] : ['']).map((p) => classifyAccount(g.login, g.host, p));
        const account =
          classes.find((c) => c.type === 'persona') ?? classes.find((c) => c.type === 'revisar') ?? classes[0];
        return { g, account };
      })
      .map(({ g, account }) => ({
        key: g.key,
        login: g.login,
        host: g.host,
        windowsUser: [...g.ntUsers][0] ?? null,
        address: [...g.addresses][0] ?? null,
        accountType: account.type,
        accountReason: account.reason,
        programs: [...g.programs],
        kind: [...g.kinds][0] ?? 'other',
        databases: [...g.databases].map(([name, cpuMs]) => ({ name, cpuMs })).sort((a, b) => b.cpuMs - a.cpuMs),
        sessions: g.sessions,
        running: g.running,
        cpuMs: g.cpuMs,
        reads: g.reads,
        writes: g.writes,
        cpuMsNow: g.cpuMsNow,
        readsNow: g.readsNow,
        writesNow: g.writesNow,
        lastRequestAt: g.lastRequestAt ? new Date(g.lastRequestAt).toISOString() : null,
      }))
      .sort((a, b) => b.cpuMs - a.cpuMs);
  });
}
