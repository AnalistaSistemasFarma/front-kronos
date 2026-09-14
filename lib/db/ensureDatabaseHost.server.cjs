/**
 * Solo servidor / scripts Node. Resolución de host SQL y ruta Windows (Wi‑Fi → 192.168.10.x).
 */
const net = require('net');
const { execSync } = require('child_process');
const dbconfig = require('../../dbconfig');

let resolvedHostCache = null;

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs || 2500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function getCandidateHosts() {
  const fromList = String(process.env.DATABASE_CONNECT_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (fromList.length) return [...new Set(fromList)];

  const hosts = [];
  const push = (v) => {
    const h = String(v || '').trim();
    if (h && !hosts.includes(h)) hosts.push(h);
  };
  push(process.env.DATABASE_HOST_WIFI);
  push(process.env.DATABASE_HOST_OFFICE);
  push(process.env.SAPSENDSQL_SERVER);
  const conn = dbconfig.resolveConnection();
  if (conn.server) push(conn.server);
  return hosts;
}

function tryAddWindowsSqlRoute() {
  if (process.platform !== 'win32') return false;
  const gateway = process.env.DATABASE_ROUTE_GATEWAY || '192.168.11.11';
  const network = process.env.DATABASE_ROUTE_NETWORK || '192.168.10.0';
  const mask = process.env.DATABASE_ROUTE_MASK || '255.255.255.0';
  try {
    execSync(`route add ${network} mask ${mask} ${gateway} metric 1`, {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabaseHostResolved() {
  const manual = String(process.env.DATABASE_HOST || '').trim();
  const conn = dbconfig.resolveConnection();
  const port = conn.port;
  const candidates = getCandidateHosts();

  if (manual && (await probeTcp(manual, port))) {
    resolvedHostCache = manual;
    return manual;
  }

  if (resolvedHostCache && (await probeTcp(resolvedHostCache, port))) {
    process.env.DATABASE_HOST = resolvedHostCache;
    return resolvedHostCache;
  }

  for (const host of candidates) {
    if (await probeTcp(host, port)) {
      process.env.DATABASE_HOST = host;
      resolvedHostCache = host;
      return host;
    }
  }

  tryAddWindowsSqlRoute();
  for (const host of candidates) {
    if (await probeTcp(host, port)) {
      process.env.DATABASE_HOST = host;
      resolvedHostCache = host;
      return host;
    }
  }

  resolvedHostCache = null;
  return manual || candidates[0] || '';
}

function clearResolvedDatabaseHost() {
  resolvedHostCache = null;
  delete process.env.DATABASE_HOST;
}

module.exports = {
  ensureDatabaseHostResolved,
  clearResolvedDatabaseHost,
  getCandidateHosts,
};
