import 'server-only';
import { sql } from '../mssqlPool';
import { readLogContext } from './dbProbe';
import { judgeLog } from './logHealth';
import {
  buildOverviewGraph,
  environmentLabel,
  quoteIdent,
  sqlLiteral,
  startOfLocalDayUtc,
  type DatabaseInfo,
  type OrionPeople,
  type OverviewEnvironment,
  type SessionGroup,
  type SqlServerInfo,
  type SystemOverview,
} from './overviewModel';

/**
 * Lecturas de la Vista general (overviewModel.ts). Todo es SOLO LECTURA: vistas del sistema de
 * SQL Server y las tablas del monitor / bitácoras de cada base, con NOLOCK para no bloquear a
 * nadie. Cada base se lee por su nombre de tres partes desde la conexión de Kronos, así que solo
 * aparecen las bases a las que su usuario tiene acceso (HAS_DBACCESS).
 *
 * El servidor es SQL Server 2016: nada de STRING_AGG ni funciones de 2017+.
 */

type Pool = Awaited<ReturnType<typeof import('../mssqlPool').getPool>>;

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
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type DbFlags = DatabaseInfo & { metrics: boolean; people: boolean; alerts: boolean; orion: boolean };

async function readDatabases(pool: Pool): Promise<{ list: DbFlags[]; inaccessible: string[] }> {
  const r = await pool.request().query<{ name: string; access: number }>(`
    SELECT name, HAS_DBACCESS(name) AS access
    FROM sys.databases
    WHERE database_id > 4 AND state_desc = 'ONLINE'
    ORDER BY name`);
  const accessible = r.recordset.filter((d) => d.access === 1).map((d) => d.name);
  const inaccessible = r.recordset.filter((d) => d.access !== 1).map((d) => d.name);
  if (!accessible.length) return { list: [], inaccessible };

  const obj = (db: string, table: string) => `CASE WHEN OBJECT_ID(${sqlLiteral(`${quoteIdent(db)}.dbo.${quoteIdent(table)}`)}, 'U') IS NULL THEN 0 ELSE 1 END`;
  const parts = accessible.map(
    (db) => `SELECT ${sqlLiteral(db)} AS name,
      ${obj(db, 'system_metric_sample')} AS metrics,
      ${obj(db, 'system_metric_user')} AS people,
      ${obj(db, 'system_metric_alert')} AS alerts,
      ${obj(db, 'subprocess_user_company')} AS kronos_like,
      CASE WHEN ${obj(db, 'audit_logs')} = 1 AND ${obj(db, 'users')} = 1 THEN 1 ELSE 0 END AS orion`
  );
  const flags = await pool.request().query(parts.join('\nUNION ALL\n'));
  return {
    list: flags.recordset.map((f) => ({
      name: String(f.name),
      accessible: true,
      kronosLike: f.kronos_like === 1,
      metrics: f.metrics === 1,
      people: f.people === 1,
      alerts: f.alerts === 1,
      orion: f.orion === 1 && /^oriondb/i.test(String(f.name)),
    })),
    inaccessible,
  };
}

async function readEnvironment(pool: Pool, db: DbFlags, currentDb: string | null): Promise<OverviewEnvironment> {
  const Q = quoteIdent(db.name);
  const base: OverviewEnvironment = {
    database: db.name,
    label: environmentLabel(db.name),
    isCurrent: currentDb?.toLowerCase() === db.name.toLowerCase(),
    state: 'sin-metricas',
    lastSampleAt: null,
    processes: [],
    host: null,
    reqPerMin: null,
    errorPct: null,
    p95Ms: null,
    people: null,
    alerts: null,
    log: null,
  };
  if (!db.metrics) return base;

  const r = await pool.request().query(`
    SELECT MAX(sampled_at) AS last_at
    FROM ${Q}.dbo.system_metric_sample WITH (NOLOCK)
    WHERE sampled_at >= DATEADD(day, -14, SYSUTCDATETIME());

    SELECT s.host, s.instance, s.pid, s.cpu_pct, s.rss_mb, s.event_loop_p99_ms,
      s.host_cpu_pct, s.host_mem_used_pct, s.host_mem_total_mb
    FROM ${Q}.dbo.system_metric_sample s WITH (NOLOCK)
    JOIN (
      SELECT host, pid, MAX(sampled_at) AS at
      FROM ${Q}.dbo.system_metric_sample WITH (NOLOCK)
      WHERE sampled_at >= DATEADD(minute, -5, SYSUTCDATETIME())
      GROUP BY host, pid
    ) last ON last.host = s.host AND last.pid = s.pid AND last.at = s.sampled_at
    ORDER BY s.host, s.instance;

    SELECT SUM(CAST(http_requests AS BIGINT)) AS req, SUM(CAST(http_errors AS BIGINT)) AS err,
      SUM(CAST(http_p95_ms AS BIGINT) * http_requests) / NULLIF(SUM(CAST(http_requests AS BIGINT)), 0) AS p95,
      COUNT(DISTINCT sampled_at) AS minutes
    FROM ${Q}.dbo.system_metric_sample WITH (NOLOCK)
    WHERE sampled_at >= DATEADD(minute, -15, SYSUTCDATETIME());`);
  const sets = r.recordsets as unknown as Array<Array<Record<string, unknown>>>;
  const lastAt = iso(sets[0]?.[0]?.last_at);
  const procs = sets[1] ?? [];
  const traffic = sets[2]?.[0] ?? {};
  const minutes = Number(traffic.minutes) || 0;
  const req = Number(traffic.req) || 0;

  const env: OverviewEnvironment = {
    ...base,
    state: procs.length ? 'activo' : 'sin-datos',
    lastSampleAt: lastAt,
    processes: procs.map((p) => ({
      host: String(p.host),
      instance: String(p.instance),
      pid: Number(p.pid),
      cpuPct: num(p.cpu_pct),
      rssMb: num(p.rss_mb),
      eventLoopP99Ms: num(p.event_loop_p99_ms),
    })),
    host: procs.length
      ? {
          name: String(procs[0].host),
          cpuPct: num(procs.reduce((a, p) => a + (Number(p.host_cpu_pct) || 0), 0) / procs.length),
          memPct: num(procs.reduce((a, p) => a + (Number(p.host_mem_used_pct) || 0), 0) / procs.length),
          memTotalMb: num(procs[0].host_mem_total_mb),
        }
      : null,
    reqPerMin: minutes ? num(req / minutes) : null,
    errorPct: req ? num(((Number(traffic.err) || 0) / req) * 100) : null,
    p95Ms: num(traffic.p95),
  };

  if (db.people) {
    const p = await safe(() =>
      pool.request().query(`
        SELECT COUNT(DISTINCT user_email) AS active_now
        FROM ${Q}.dbo.system_metric_user WITH (NOLOCK)
        WHERE bucket_at >= DATEADD(minute, -15, SYSUTCDATETIME());

        SELECT COUNT(*) AS recent FROM (
          SELECT TOP 1 1 AS x FROM ${Q}.dbo.system_metric_user WITH (NOLOCK)
          WHERE bucket_at >= DATEADD(day, -1, SYSUTCDATETIME())
        ) t;

        SELECT TOP 6 user_email, MAX(user_name) AS user_name
        FROM ${Q}.dbo.system_metric_user WITH (NOLOCK)
        WHERE bucket_at >= DATEADD(minute, -15, SYSUTCDATETIME())
        GROUP BY user_email
        ORDER BY SUM(total_ms) DESC;`)
    );
    if (p) {
      const ps = p.recordsets as unknown as Array<Array<Record<string, unknown>>>;
      env.people = {
        activeNow: Number(ps[0]?.[0]?.active_now) || 0,
        hasData: (Number(ps[1]?.[0]?.recent) || 0) > 0,
        top: (ps[2] ?? []).map((u) => ({ email: String(u.user_email), name: u.user_name ? String(u.user_name) : null })),
      };
    }
  }

  if (db.alerts) {
    const a = await safe(() =>
      pool.request().query(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical
        FROM ${Q}.dbo.system_metric_alert WITH (NOLOCK)
        WHERE raised_at >= DATEADD(hour, -24, SYSUTCDATETIME())`)
    );
    const row = a?.recordset?.[0];
    if (row) env.alerts = { last24h: Number(row.total) || 0, critical: Number(row.critical) || 0 };
  }
  return env;
}

async function readOrionPeople(pool: Pool, db: DbFlags, since: Date): Promise<OrionPeople | null> {
  const Q = quoteIdent(db.name);
  const r = await safe(() =>
    pool.request().input('since', sql.DateTime2(0), since).query(`
      SELECT
        (SELECT COUNT(DISTINCT userId) FROM ${Q}.dbo.audit_logs WITH (NOLOCK)
          WHERE createdAt >= DATEADD(minute, -60, SYSUTCDATETIME()) AND userId IS NOT NULL) AS active_1h,
        (SELECT COUNT(*) FROM ${Q}.dbo.users WITH (NOLOCK)
          WHERE lastLoginAt >= @since AND ISNULL(isDeleted, 0) = 0) AS logins_today;

      SELECT TOP 6 email, displayName
      FROM ${Q}.dbo.users WITH (NOLOCK)
      WHERE lastLoginAt >= @since AND ISNULL(isDeleted, 0) = 0
      ORDER BY lastLoginAt DESC;`)
  );
  if (!r) return null;
  const sets = r.recordsets as unknown as Array<Array<Record<string, unknown>>>;
  return {
    database: db.name,
    activeLastHour: Number(sets[0]?.[0]?.active_1h) || 0,
    loginsToday: Number(sets[0]?.[0]?.logins_today) || 0,
    recent: (sets[1] ?? []).map((u) => ({ email: String(u.email), name: u.displayName ? String(u.displayName) : null })),
  };
}

// Las horas de las DMV vienen en hora local del servidor y el driver las leería como UTC; por eso
// se miden en SQL como segundos transcurridos y se convierten aquí.
function secondsAgo(now: Date, seconds: unknown): string | null {
  if (seconds == null) return null;
  const n = Number(seconds);
  return Number.isFinite(n) ? new Date(now.getTime() - n * 1000).toISOString() : null;
}

async function readSessions(pool: Pool, now: Date): Promise<SessionGroup[]> {
  const r = await pool.request().query(`
    SELECT TOP 300
      DB_NAME(s.database_id) AS database_name, s.host_name, c.client_net_address AS ip, s.program_name, s.login_name,
      COUNT(*) AS sessions,
      SUM(CASE WHEN s.status IN ('running', 'runnable', 'suspended') THEN 1 ELSE 0 END) AS running,
      SUM(CAST(s.cpu_time AS BIGINT)) AS cpu_ms,
      DATEDIFF(second, MAX(s.last_request_end_time), GETDATE()) AS idle_seconds
    FROM sys.dm_exec_sessions s
    LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id AND c.parent_connection_id IS NULL
    WHERE s.is_user_process = 1 AND s.session_id <> @@SPID
    GROUP BY s.database_id, s.host_name, c.client_net_address, s.program_name, s.login_name
    ORDER BY COUNT(*) DESC`);
  return r.recordset.map((row) => ({
    database: row.database_name ? String(row.database_name) : '',
    hostName: row.host_name ? String(row.host_name) : null,
    ip: row.ip ? String(row.ip) : null,
    programName: row.program_name ? String(row.program_name) : null,
    loginName: row.login_name ? String(row.login_name) : null,
    sessions: Number(row.sessions) || 0,
    running: Number(row.running) || 0,
    cpuMs: Number(row.cpu_ms) || 0,
    lastActivity: secondsAgo(now, row.idle_seconds),
  }));
}

async function readSqlServer(pool: Pool, now: Date): Promise<SqlServerInfo> {
  const basic = await pool.request().query(`
    SELECT CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(128)) AS machine,
      CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(64)) AS version,
      HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS server_state`);
  const b = basic.recordset[0] ?? {};
  const info: SqlServerInfo = {
    machine: String(b.machine ?? 'SQL Server'),
    version: b.version ? String(b.version) : null,
    cpus: null,
    startedAt: null,
    sqlCpuPct: null,
    otherCpuPct: null,
    memTotalMb: null,
    memAvailableMb: null,
    sqlMemoryMb: null,
    hasServerState: b.server_state === 1,
    disks: [],
  };
  if (!info.hasServerState) return info;

  const sys = await safe(() =>
    pool.request().query(`
      SELECT
        (SELECT cpu_count FROM sys.dm_os_sys_info) AS cpus,
        (SELECT DATEDIFF(second, sqlserver_start_time, GETDATE()) FROM sys.dm_os_sys_info) AS uptime_seconds,
        (SELECT total_physical_memory_kb FROM sys.dm_os_sys_memory) AS total_kb,
        (SELECT available_physical_memory_kb FROM sys.dm_os_sys_memory) AS avail_kb,
        (SELECT physical_memory_in_use_kb FROM sys.dm_os_process_memory) AS sql_kb`)
  );
  const s = sys?.recordset?.[0];
  if (s) {
    info.cpus = num(s.cpus);
    info.startedAt = secondsAgo(now, s.uptime_seconds);
    info.memTotalMb = s.total_kb != null ? Math.round(Number(s.total_kb) / 1024) : null;
    info.memAvailableMb = s.avail_kb != null ? Math.round(Number(s.avail_kb) / 1024) : null;
    info.sqlMemoryMb = s.sql_kb != null ? Math.round(Number(s.sql_kb) / 1024) : null;
  }

  const cpu = await safe(() =>
    pool.request().query<{ sql_cpu: number; idle: number }>(`
      SELECT TOP 1
        rec.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu,
        rec.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS idle
      FROM (
        SELECT CONVERT(XML, record) AS rec, [timestamp]
        FROM sys.dm_os_ring_buffers
        WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR' AND record LIKE N'%<SystemHealth>%'
      ) AS x
      ORDER BY [timestamp] DESC`)
  );
  const c = cpu?.recordset?.[0];
  if (c) {
    info.sqlCpuPct = num(c.sql_cpu);
    info.otherCpuPct = c.sql_cpu != null && c.idle != null ? Math.max(0, 100 - c.idle - c.sql_cpu) : null;
  }

  const disks = await safe(() =>
    pool.request().query<{ mount: string; total_mb: number; free_mb: number }>(`
      SELECT DISTINCT v.volume_mount_point AS mount, v.total_bytes / 1048576 AS total_mb, v.available_bytes / 1048576 AS free_mb
      FROM sys.master_files f
      CROSS APPLY sys.dm_os_volume_stats(f.database_id, f.file_id) v`)
  );
  info.disks = (disks?.recordset ?? [])
    .map((d) => ({ mount: String(d.mount), totalMb: Number(d.total_mb) || 0, freeMb: Number(d.free_mb) || 0 }))
    .sort((a, b) => a.mount.localeCompare(b.mount));
  return info;
}

/** Uso del log de todas las bases a la vez (lo mismo que sys.dm_db_log_space_usage, pero de todas). */
async function readLogSpace(pool: Pool): Promise<Map<string, number>> {
  const r = await safe(() => pool.request().query('DBCC SQLPERF(LOGSPACE) WITH NO_INFOMSGS'));
  const map = new Map<string, number>();
  for (const row of (r?.recordset ?? []) as Array<Record<string, unknown>>) {
    const name = row['Database Name'];
    const pct = num(row['Log Space Used (%)']);
    if (typeof name === 'string' && pct != null) map.set(name.toLowerCase(), pct);
  }
  return map;
}

async function readEnvironmentLog(
  pool: Pool,
  database: string,
  logSpace: Map<string, number>
): Promise<OverviewEnvironment['log']> {
  const usedPct = logSpace.get(database.toLowerCase()) ?? null;
  const context = await safe(() => readLogContext(pool, database));
  return { usedPct, context, verdict: judgeLog(usedPct, context) };
}

export async function readSystemOverview(pool: Pool, now: Date = new Date()): Promise<SystemOverview> {
  const current = await pool.request().query<{ db: string }>('SELECT DB_NAME() AS db');
  const currentDb = current.recordset[0]?.db ?? null;

  const [{ list, inaccessible }, sessions, sqlServer] = await Promise.all([
    readDatabases(pool),
    safe(() => readSessions(pool, now)),
    readSqlServer(pool, now),
  ]);

  const kronosDbs = list.filter((d) => d.metrics || d.kronosLike);
  const logSpace = sqlServer.hasServerState ? await readLogSpace(pool) : new Map<string, number>();
  const environments = (
    await Promise.all(
      kronosDbs.map((d) =>
        safe(async () => {
          const env = await readEnvironment(pool, d, currentDb);
          return { ...env, log: await readEnvironmentLog(pool, d.name, logSpace) };
        })
      )
    )
  ).filter((e): e is OverviewEnvironment => e != null);
  environments.sort((a, b) => Number(b.state === 'activo') - Number(a.state === 'activo') || a.database.localeCompare(b.database));

  const since = startOfLocalDayUtc(now);
  const orion = (await Promise.all(list.filter((d) => d.orion).map((d) => readOrionPeople(pool, d, since)))).filter(
    (o): o is OrionPeople => o != null
  );

  const graph = buildOverviewGraph({
    sessions: sessions ?? [],
    databases: list,
    environments,
    orion,
    sqlMachine: sqlServer.machine,
    now,
  });

  return {
    generatedAt: now.toISOString(),
    sqlServer,
    environments,
    ...graph,
    inaccessible,
  };
}
