/**
 * Pool opcional SOLO LECTURA para el Monitor SAPSEND (DMVs).
 *
 * Si están definidas las variables SAPSEND_MONITOR_SQL_*, usa esa cuenta
 * (típicamente Windows con VIEW SERVER STATE). Si no, cae al pool normal
 * de Kronos (withMssqlPool).
 *
 * Variables (en .env local / servidor — NUNCA en git):
 *   SAPSEND_MONITOR_SQL_SERVER   host (default: el de DATABASE_URL / dbconfig)
 *   SAPSEND_MONITOR_SQL_DATABASE database (default: master — DMVs son de instancia)
 *   SAPSEND_MONITOR_SQL_USER     "DOMINIO\\usuario" o usuario SQL
 *   SAPSEND_MONITOR_SQL_PASSWORD contraseña
 *   SAPSEND_MONITOR_SQL_DOMAIN   opcional si el user no trae DOMINIO\
 *
 * Cuidado: no uses la cuenta personal de un admin en producción a largo plazo;
 * preferible un login de solo lectura dedicado. Esta vía es para poder ver
 * concurrencia/bloqueos cuando el login de Kronos no alcanza.
 */

import sql from 'mssql';
import { withMssqlPool } from '../mssqlPool';

/** @type {sql.ConnectionPool | undefined} */
let monitorPool;
/** @type {Promise<sql.ConnectionPool> | undefined} */
let monitorPoolPromise;
/** @type {string | undefined} */
let monitorPoolKey;
/** Tras un login fallido, no reintentar NTLM (evita clavar el monitor). */
let monitorAuthCooldownUntil = 0;
const MONITOR_AUTH_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * Un solo intento de conexión a la vez. Varias DMVs en Promise.all no deben
 * disparar N+1 logins NTLM fallidos en paralelo.
 * @type {Promise<sql.ConnectionPool | null> | null}
 */
let monitorConnectGate = null;

function env(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : null;
}

/**
 * @returns {{ domain: string | null, userName: string } | null}
 */
function parseWindowsUser(raw) {
  if (!raw) return null;
  const normalized = raw.replace(/\//g, '\\');
  const i = normalized.indexOf('\\');
  if (i > 0) {
    return { domain: normalized.slice(0, i), userName: normalized.slice(i + 1) };
  }
  const domain = env('SAPSEND_MONITOR_SQL_DOMAIN');
  return { domain, userName: normalized };
}

export function hasMonitorSqlCredentials() {
  return Boolean(env('SAPSEND_MONITOR_SQL_USER') && env('SAPSEND_MONITOR_SQL_PASSWORD'));
}

function monitorAuthBlocked() {
  return Date.now() < monitorAuthCooldownUntil;
}

/**
 * Resumen seguro (sin secretos) de cómo está configurado el pool del monitor.
 */
export function monitorSqlConfigSummary() {
  const user = env('SAPSEND_MONITOR_SQL_USER');
  const parsed = parseWindowsUser(user);
  const cooling = monitorAuthBlocked();
  return {
    configured: hasMonitorSqlCredentials(),
    usingKronosFallback: cooling || !hasMonitorSqlCredentials(),
    server: env('SAPSEND_MONITOR_SQL_SERVER') || '(pool Kronos)',
    database: env('SAPSEND_MONITOR_SQL_DATABASE') || 'master',
    auth: cooling
      ? 'pool Kronos (cuenta monitor en pausa tras fallo)'
      : parsed?.domain
        ? `Windows NTLM (${parsed.domain}\\…)`
        : user
          ? 'SQL login'
          : 'pool Kronos',
  };
}

async function buildMonitorConfig() {
  const userRaw = env('SAPSEND_MONITOR_SQL_USER');
  const password = env('SAPSEND_MONITOR_SQL_PASSWORD');
  if (!userRaw || !password) return null;

  let server = env('SAPSEND_MONITOR_SQL_SERVER');
  let port = 1433;
  if (!server) {
    await withMssqlPool(async (pool) => {
      server = pool.config?.server || 'localhost';
      port = Number(pool.config?.port) || 1433;
    });
  } else if (server.includes(':')) {
    const [h, p] = server.split(':');
    server = h;
    port = Number(p) || 1433;
  }

  const database = env('SAPSEND_MONITOR_SQL_DATABASE') || 'master';
  const parsed = parseWindowsUser(userRaw);

  /** @type {sql.config} */
  const config = {
    server,
    port,
    database,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      useUTC: true,
      enableArithAbort: true,
    },
    connectionTimeout: 8000,
    requestTimeout: 20000,
    pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
  };

  if (parsed?.domain) {
    config.authentication = {
      type: 'ntlm',
      options: {
        domain: parsed.domain,
        userName: parsed.userName,
        password,
      },
    };
  } else {
    config.user = parsed?.userName || userRaw;
    config.password = password;
  }

  return config;
}

async function getMonitorPool() {
  const config = await buildMonitorConfig();
  if (!config) return null;

  const key = JSON.stringify({
    s: config.server,
    p: config.port,
    d: config.database,
    a: config.authentication?.type || 'sql',
    u: config.authentication?.options?.userName || config.user,
  });

  if (monitorPool && monitorPoolKey === key && monitorPool.connected) return monitorPool;
  if (monitorPoolPromise && monitorPoolKey === key) return monitorPoolPromise;

  if (monitorPool) {
    void monitorPool.close().catch(() => {});
    monitorPool = undefined;
  }

  monitorPoolKey = key;
  monitorPoolPromise = (async () => {
    const pool = new sql.ConnectionPool(config);
    await pool.connect();
    monitorPool = pool;
    return pool;
  })().finally(() => {
    monitorPoolPromise = undefined;
  });

  return monitorPoolPromise;
}

function markMonitorAuthFailed(err) {
  monitorAuthCooldownUntil = Date.now() + MONITOR_AUTH_COOLDOWN_MS;
  if (monitorPool) {
    void monitorPool.close().catch(() => {});
    monitorPool = undefined;
    monitorPoolKey = undefined;
  }
  console.warn(
    '[sapsend/monitorPool] cuenta monitor falló; se usa Kronos y no se reintenta 10 min:',
    err?.message || err
  );
}

/**
 * Un solo intento NTLM compartido por todos los callers concurrentes.
 * @returns {Promise<sql.ConnectionPool | null>}
 */
function resolveMonitorPoolOnce() {
  if (!hasMonitorSqlCredentials() || monitorAuthBlocked()) return Promise.resolve(null);
  if (monitorPool?.connected) return Promise.resolve(monitorPool);
  if (monitorConnectGate) return monitorConnectGate;

  monitorConnectGate = (async () => {
    try {
      const pool = await getMonitorPool();
      return pool;
    } catch (err) {
      markMonitorAuthFailed(err);
      return null;
    } finally {
      monitorConnectGate = null;
    }
  })();

  return monitorConnectGate;
}

/**
 * Ejecuta fn con el pool del monitor si hay credenciales; si no, con el de Kronos.
 * @template T
 * @param {(pool: sql.ConnectionPool) => Promise<T>} fn
 */
export async function withMonitorSqlPool(fn) {
  const pool = await resolveMonitorPoolOnce();
  if (!pool) return withMssqlPool(fn);
  try {
    return await fn(pool);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/login failed|untrusted domain|ELOGIN|authentication/i.test(msg)) {
      markMonitorAuthFailed(err);
      return withMssqlPool(fn);
    }
    throw err;
  }
}
