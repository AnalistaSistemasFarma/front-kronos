import os from 'node:os';
import { sql, withMssqlPool } from '../mssqlPool';
import { SAPSEND_URL } from './config.js';
import { COMPANY_SAPSEND_DBS } from './companyMap.js';
import {
  getSapsendDbActivity,
  readBlockingChains,
  readHeavyRequests,
  readSapsendConnections,
  readSapsendDatabases,
  readSapsendLogins,
  readSapsendQueryStats,
  readSapsendRunningNow,
  readSapsendSapConcurrency,
  readSqlCpuSeries,
} from './sqlLive.js';
import { monitorSqlConfigSummary } from './monitorPool.js';
import { pulseServiceLayer } from '../sap/slPulse';
import { buildSapsendHighlights, evaluateSapsendAlerts, SAPSEND_WATCH_LIST } from './earlyWarnings.js';

/**
 * Foto en vivo de los SAPSEND de producción (todas las empresas), vistos DIRECTAMENTE:
 * - Sus bases SAPSEND* en el SQL Server (vistas del sistema, solo lectura): sesiones,
 *   consultas, bloqueos, quién consume (usuario SQL / equipo / programa), CPU del SQL.
 * - El Service Layer de cada empresa: pulso HTTP sin iniciar sesión.
 * - La dirección productiva de SAPSEND: prueba de conexión.
 *
 * NO mide el tráfico de SynerLink (SynerLink ya tiene su propio Monitor del sistema).
 *
 * La foto se comparte entre todas las personas que miran el monitor (caché de 4 s): mire 1 o
 * 20, el SQL Server recibe las mismas consultas.
 */

const SNAPSHOT_CACHE_MS = 4_000;
const ENDPOINTS_CACHE_MS = 5 * 60_000;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '');
  }
}

function isTunnel(url) {
  return /trycloudflare\.com/i.test(String(url || ''));
}

function slHostOf(baseUrl) {
  try {
    const raw = String(baseUrl || '');
    return new URL(raw.includes('://') ? raw : `https://${raw}`).host.toLowerCase();
  } catch {
    return String(baseUrl || '').toLowerCase();
  }
}

/**
 * URL productiva de SAPSEND a medir. Los túneles Cloudflare (trycloudflare.com) son
 * contingencia y NO se miden.
 */
function productiveSapsendUrl() {
  for (const raw of [process.env.SAPSEND_MONITOR_URL, SAPSEND_URL]) {
    const url = String(raw || '').trim().replace(/\/$/, '');
    if (url && !isTunnel(url)) return url;
  }
  return null;
}

async function probeSapsend(base) {
  if (!base) {
    return {
      ok: false,
      skipped: true,
      status: 0,
      latencyMs: null,
      error: 'Sin URL productiva configurada (los túneles de contingencia no se miden)',
    };
  }
  const t0 = performance.now();
  try {
    const res = await fetch(base, { method: 'GET', signal: AbortSignal.timeout(8000) });
    return {
      ok: res.status > 0,
      skipped: false,
      status: res.status,
      latencyMs: Math.round(performance.now() - t0),
      error: res.status > 0 ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      status: 0,
      latencyMs: Math.round(performance.now() - t0),
      error: err?.name === 'TimeoutError' ? 'Timeout al conectar' : err?.message || 'fetch failed',
    };
  }
}

/** Dirección del Service Layer de cada empresa (tabla sap_endpoints). Caché de 5 min. */
let endpointsCache = null;
async function loadEndpoints() {
  if (endpointsCache && Date.now() - endpointsCache.at < ENDPOINTS_CACHE_MS) return endpointsCache.rows;
  try {
    const rows = await withMssqlPool(async (pool) => {
      const r = await pool.request().query(`
        SELECT c.id_company, RTRIM(c.company) AS company, e.base_url, e.client
        FROM company c
        INNER JOIN sap_endpoints e ON e.id_company = c.id_company AND e.is_active = 1
        ORDER BY c.company
      `);
      return r.recordset.map((x) => ({
        idCompany: x.id_company,
        company: String(x.company || '').trim(),
        baseUrl: String(x.base_url || '').trim(),
        companyDB: x.client ? String(x.client).trim() : null,
      }));
    });
    endpointsCache = { at: Date.now(), rows };
    return rows;
  } catch {
    return endpointsCache?.rows ?? [];
  }
}

/**
 * ¿De quién es cada equipo? Se busca el nombre del equipo (host_name de SQL Server) en el
 * inventario de activos de Kronos (assets.name o assets.label) y se toma la persona asignada
 * (user_asset.username_asset). Caché de 10 min: el inventario casi no cambia.
 */
const OWNERS_CACHE_MS = 10 * 60_000;
/** @type {Map<string, { at: number, owner: { name: string, department: string | null, asset: string } | null }>} */
const ownersCache = new Map();

async function loadAssetOwners(hosts) {
  const now = Date.now();
  const wanted = [...new Set(hosts.map((h) => String(h || '').trim().toUpperCase()).filter((h) => h && !h.startsWith('(')))];
  const missing = wanted.filter((h) => {
    const hit = ownersCache.get(h);
    return !hit || now - hit.at > OWNERS_CACHE_MS;
  });
  if (missing.length) {
    try {
      await withMssqlPool(async (pool) => {
        const req = pool.request();
        const params = missing.slice(0, 200).map((h, i) => {
          req.input(`h${i}`, sql.NVarChar(200), h);
          return `@h${i}`;
        });
        const r = await req.query(`
          SELECT
            UPPER(LTRIM(RTRIM(a.name))) AS asset_name,
            UPPER(LTRIM(RTRIM(a.label))) AS asset_label,
            ua.username_asset AS owner,
            d.department
          FROM assets a
          INNER JOIN user_asset ua ON ua.id = a.id_user_asset
          LEFT JOIN department d ON d.id_department = ua.id_department
          WHERE a.active = 1
            AND (UPPER(LTRIM(RTRIM(a.name))) IN (${params.join(',')})
              OR UPPER(LTRIM(RTRIM(a.label))) IN (${params.join(',')}))
        `);
        for (const h of missing) ownersCache.set(h, { at: now, owner: null });
        for (const row of r.recordset) {
          const owner = {
            name: String(row.owner || '').trim(),
            department: row.department ? String(row.department).trim() : null,
            asset: String(row.asset_name || row.asset_label || ''),
          };
          if (!owner.name) continue;
          for (const key of [row.asset_name, row.asset_label]) {
            if (key && missing.includes(String(key))) ownersCache.set(String(key), { at: now, owner });
          }
        }
      });
    } catch {
      // Sin acceso al inventario: se muestra solo el equipo.
    }
  }
  return (host) => ownersCache.get(String(host || '').trim().toUpperCase())?.owner ?? null;
}

/** Empresa de una base SAPSEND (por el mapa) y su nombre legible. */
function companyOfDb(dbName, endpoints) {
  const map = COMPANY_SAPSEND_DBS.find((r) => r.sapsendDb.toLowerCase() === dbName.toLowerCase());
  const ep = map ? endpoints.find((e) => e.idCompany === map.idCompany) : null;
  const fallback = dbName.replace(/^SAPSEND_?/i, '') || dbName;
  return {
    idCompany: map?.idCompany ?? null,
    company: ep?.company || (map ? fallback : fallback),
    endpoint: ep ?? null,
  };
}

function emptyConc(database) {
  return {
    database,
    sessions: 0,
    running: 0,
    blocked: 0,
    byProgram: { serviceLayer: 0, sapsend: 0, sapClient: 0, kronos: 0, other: 0 },
  };
}

function statusOfCompany({ ss, blocksForDb, sl, slowRunning }) {
  if (ss.blocked > 0 || blocksForDb > 0) return 'critical';
  if (sl && !sl.pulse.ok) return 'critical';
  if ((sl && (sl.pulse.latencyMs ?? 0) >= 3000) || ss.running >= 20 || slowRunning > 0) return 'warning';
  if (ss.sessions > 0) return 'ok';
  return 'idle';
}

/** Historial en memoria (última hora) para tendencias y señales clave. */
const HISTORY_MAX_MS = 60 * 60 * 1000;
const HISTORY_MIN_GAP_MS = 12_000;
/** @type {Array<Record<string, number | null>>} */
const history = [];

function pushHistory(point) {
  const last = history[history.length - 1];
  if (last && point.at - Number(last.at) < HISTORY_MIN_GAP_MS) return;
  history.push(point);
  const cut = point.at - HISTORY_MAX_MS;
  while (history.length && Number(history[0].at) < cut) history.shift();
}

/** "Tiempo de CPU de cada SAPSEND": bloques de 5 min con el formato de ServerTime. */
function buildDbActivity(labelOf) {
  const BUCKET_MS = 5 * 60_000;
  const series = new Map();
  const modules = new Map();
  for (const a of getSapsendDbActivity()) {
    const label = labelOf(a.database);
    const bucket = new Date(Math.floor(a.at / BUCKET_MS) * BUCKET_MS).toISOString();
    const k = `${bucket}|${label}`;
    const s = series.get(k) ?? { bucket, module: label, label, requests: 0, totalMs: 0 };
    s.requests += a.executions;
    s.totalMs += a.cpuMs;
    series.set(k, s);
    const m = modules.get(label) ?? { module: label, label, requests: 0, totalMs: 0, errors: 0 };
    m.requests += a.executions;
    m.totalMs += a.cpuMs;
    modules.set(label, m);
  }
  return {
    moduleSeries: [...series.values()].map((s) => ({ ...s, totalMs: Math.round(s.totalMs) })),
    modules: [...modules.values()].map((m) => ({ ...m, totalMs: Math.round(m.totalMs) })).sort((a, b) => b.totalMs - a.totalMs),
  };
}

async function buildSnapshot() {
  const probeUrl = productiveSapsendUrl();
  const [health, dbs, endpoints, conc, blocksAll, heavyAll, connections, queries, runningNow, sqlCpu, logins] =
    await Promise.all([
      probeSapsend(probeUrl),
      readSapsendDatabases(),
      loadEndpoints(),
      readSapsendSapConcurrency(),
      readBlockingChains(),
      readHeavyRequests(5000),
      readSapsendConnections(),
      readSapsendQueryStats(),
      readSapsendRunningNow(),
      readSqlCpuSeries(),
      readSapsendLogins(),
    ]);

  const isSapsendDb = (name) => /^SAPSEND/i.test(String(name || ''));

  // Persona detrás de cada conexión: 1) su cuenta de Windows si entró con ella; 2) a quién
  // está asignado ese equipo en el inventario de activos; 3) desconocida.
  const ownerOf = await loadAssetOwners(logins.map((l) => l.host));
  for (const l of logins) {
    const owner = ownerOf(l.host);
    if (l.windowsUser) l.person = { name: l.windowsUser, source: 'windows', department: owner?.department ?? null };
    else if (owner) l.person = { name: owner.name, source: 'inventario', department: owner.department };
    else l.person = null;
  }
  const blocks = blocksAll.filter((b) => isSapsendDb(b.database));
  const heavy = heavyAll.filter((h) => isSapsendDb(h.database));

  // Un pulso por servidor de Service Layer (varias empresas comparten el mismo).
  const pulseByUrl = new Map();
  const urls = [...new Set(endpoints.map((e) => e.baseUrl).filter(Boolean))];
  await Promise.all(urls.map(async (u) => pulseByUrl.set(u, await pulseServiceLayer(u))));

  const labelByDb = new Map();
  const companies = dbs.map((db) => {
    const info = companyOfDb(db.name, endpoints);
    labelByDb.set(db.name.toLowerCase(), info.company);
    const ss = conc.byDatabase.get(db.name) || emptyConc(db.name);
    const dbConns = connections.filter((x) => x.database.toLowerCase() === db.name.toLowerCase());
    const dbQueries = queries.filter((q) => q.database.toLowerCase() === db.name.toLowerCase());
    const blocksForDb = blocks.filter((b) => String(b.database).toLowerCase() === db.name.toLowerCase()).length;
    const slowRunning = runningNow.filter((r) => r.database.toLowerCase() === db.name.toLowerCase() && r.elapsedMs >= 10_000).length;
    const sl = info.endpoint
      ? {
          host: slHostOf(info.endpoint.baseUrl),
          companyDB: info.endpoint.companyDB,
          pulse: pulseByUrl.get(info.endpoint.baseUrl) || { ok: false, status: 0, latencyMs: null, error: 'Sin respuesta', at: Date.now() },
        }
      : null;
    const execPerMin = dbQueries.reduce((a, q) => a + (q.perMin ?? 0), 0);
    return {
      idCompany: info.idCompany,
      company: info.company,
      sapsendDb: db.name,
      online: db.online,
      status: statusOfCompany({ ss, blocksForDb, sl, slowRunning }),
      sl,
      sapsend: {
        sessions: ss.sessions,
        running: ss.running,
        blocked: ss.blocked,
        hosts: new Set(dbConns.map((x) => x.host)).size,
        logins: new Set(dbConns.map((x) => x.login)).size,
      },
      queries: {
        distinct: dbQueries.length,
        executions: dbQueries.reduce((a, q) => a + q.executions, 0),
        cpuMs: dbQueries.reduce((a, q) => a + q.cpuMs, 0),
        reads: dbQueries.filter((q) => q.kind === 'lectura').reduce((a, q) => a + q.executions, 0),
        writes: dbQueries.filter((q) => q.kind === 'escritura').reduce((a, q) => a + q.executions, 0),
        perMin: Math.round(execPerMin * 10) / 10,
        slowNow: slowRunning,
      },
      blocks: blocksForDb,
    };
  });
  const labelOf = (db) => labelByDb.get(String(db).toLowerCase()) ?? String(db);

  const totals = {
    databases: companies.length,
    sessions: companies.reduce((a, c) => a + c.sapsend.sessions, 0),
    running: companies.reduce((a, c) => a + c.sapsend.running, 0),
    blocked: blocks.length,
    hosts: new Set(connections.filter((x) => isSapsendDb(x.database)).map((x) => x.host)).size,
    logins: new Set(connections.filter((x) => isSapsendDb(x.database)).map((x) => x.login)).size,
    execPerMin: Math.round(companies.reduce((a, c) => a + c.queries.perMin, 0) * 10) / 10,
    personal: logins.filter((l) => l.accountType === 'persona').length,
    toReview: logins.filter((l) => l.accountType === 'revisar').length,
    heavyQueries: heavy.length,
    slowNow: runningNow.filter((r) => r.elapsedMs >= 10_000).length,
  };

  const pulses = companies.filter((c) => c.sl).map((c) => c.sl.pulse);
  const pulseValues = pulses.map((p) => p.latencyMs).filter((v) => v != null);
  const slDown = companies.filter((c) => c.sl && !c.sl.pulse.ok);
  const slSlow = companies.filter((c) => c.sl && c.sl.pulse.ok && (c.sl.pulse.latencyMs ?? 0) >= 3000);
  const lastCpu = sqlCpu.length ? sqlCpu[sqlCpu.length - 1] : null;

  let severity = 'ok';
  let headline = 'Los SAPSEND trabajan sin bloqueos y el Service Layer responde';
  let sub = `${totals.sessions} sesiones · ${totals.running} consultas activas · ${totals.execPerMin} consultas/min`;
  if (!conc.hasServerState) {
    severity = 'warning';
    headline = 'Sin VIEW SERVER STATE: no se ve la actividad de los SAPSEND';
    sub = 'El usuario SQL del monitor no puede leer las vistas del sistema.';
  } else if (companies.length === 0) {
    severity = 'warning';
    headline = 'No se encontraron bases SAPSEND en este SQL Server';
    sub = 'Revise a qué servidor apunta el monitor (SAPSEND_MONITOR_SQL_SERVER).';
  } else if (blocks.length > 0) {
    severity = 'critical';
    headline = `${blocks.length} ${blocks.length === 1 ? 'bloqueo' : 'bloqueos'} en las bases SAPSEND`;
    sub = 'Revise la cadena bloqueador → bloqueado en Base de datos: suele explicar la lentitud general.';
  } else if (slDown.length > 0) {
    severity = 'critical';
    headline = `Service Layer sin respuesta: ${[...new Set(slDown.map((c) => c.company))].join(', ')}`;
    sub = slDown[0].sl.pulse.error || 'El Service Layer no atiende.';
  } else if (!health.ok && !health.skipped) {
    severity = 'critical';
    headline = 'SAPSEND productivo no responde';
    sub = health.error || 'Sin respuesta';
  } else if (slSlow.length > 0) {
    severity = 'warning';
    headline = `Service Layer lento: ${[...new Set(slSlow.map((c) => c.company))].join(', ')}`;
    sub = `Pulso de ${Math.max(...slSlow.map((c) => c.sl.pulse.latencyMs ?? 0))} ms (normal: < 1 s).`;
  } else if (totals.slowNow > 0) {
    severity = 'warning';
    headline = `${totals.slowNow} ${totals.slowNow === 1 ? 'consulta lleva' : 'consultas llevan'} más de 10 s en SAPSEND`;
    sub = 'Vea Ejecutándose en este momento en Base de datos.';
  } else if (totals.running >= 20) {
    severity = 'warning';
    headline = `Concurrencia alta en SAPSEND: ${totals.running} consultas a la vez`;
    sub = 'Vea en Mapas qué empresa concentra las sesiones.';
  } else if (totals.sessions === 0) {
    severity = 'info';
    headline = 'Sin actividad en los SAPSEND ahora';
    sub = 'Ninguna base SAPSEND tiene sesiones abiertas en este momento.';
  }

  const now = Date.now();
  pushHistory({
    at: now,
    sapsendSessions: totals.sessions,
    sapsendRunning: totals.running,
    blocked: blocks.length,
    execPerMin: totals.execPerMin,
    hosts: totals.hosts,
    sqlCpuPct: lastCpu?.sqlCpuPct ?? null,
    slPulseMax: pulseValues.length ? Math.max(...pulseValues) : null,
    slPulseAvg: pulseValues.length ? Math.round(pulseValues.reduce((a, v) => a + v, 0) / pulseValues.length) : null,
  });

  const alertInput = { companies, blocks, runningNow, hasServerState: conc.hasServerState, health, logins };
  const early = evaluateSapsendAlerts(alertInput, os.hostname());

  return {
    sampledAt: new Date(now).toISOString(),
    host: os.hostname(),
    pid: process.pid,
    note:
      'Todo sale directo de los SAPSEND: sus bases en el SQL Server (vistas del sistema, solo lectura), el pulso del Service Layer de cada empresa y la prueba de conexión a SAPSEND. No incluye el tráfico de SynerLink (eso está en el Monitor del sistema).',
    urlHost: probeUrl ? hostOf(probeUrl) : '',
    monitorSql: monitorSqlConfigSummary(),
    health,
    hasServerState: conc.hasServerState,
    verdict: { severity, headline, sub },
    alerts: early.alerts,
    alertHistoryHours: early.historyHours,
    watchList: SAPSEND_WATCH_LIST,
    highlights: buildSapsendHighlights(alertInput),
    totals,
    companies,
    connections,
    logins,
    queries,
    runningNow,
    blocks,
    heavy,
    sqlCpu,
    activity: buildDbActivity(labelOf),
    history: history.slice(),
  };
}

/** @type {{ at: number, promise: Promise<any> } | null} */
let shared = null;

/** Foto compartida: si alguien la pidió hace menos de 4 s, se reutiliza. */
export async function buildSapsendLiveSnapshot() {
  if (shared && Date.now() - shared.at < SNAPSHOT_CACHE_MS) return shared.promise;
  const promise = buildSnapshot();
  shared = { at: Date.now(), promise };
  promise.catch(() => {
    if (shared?.promise === promise) shared = null;
  });
  return promise;
}
