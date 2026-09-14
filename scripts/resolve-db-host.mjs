/**
 * Resuelve el host SQL alcanzable (Wi‑Fi sin cable: añade ruta hacia 192.168.10.x vía gateway Ethernet).
 */
import net from 'net';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DEFAULT_SQL_HOST = '192.168.10.3';
const DEFAULT_ROUTE_GATEWAY = '192.168.11.11';
const DEFAULT_ROUTE_NETWORK = '192.168.10.0';
const DEFAULT_ROUTE_MASK = '255.255.255.0';

function loadEnvFile() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function probeTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function parsePort() {
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/:(\d+);/);
  const fromEnv = Number(process.env.SAPSENDSQL_PORT || process.env.DATABASE_PORT);
  const port = m ? Number(m[1]) : fromEnv || 1433;
  return Number.isFinite(port) ? port : 1433;
}

function candidateHosts() {
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
  push(DEFAULT_SQL_HOST);

  const url = process.env.DATABASE_URL || '';
  const parsed = url.replace(/^sqlserver:\/\//i, '').split(';')[0]?.split(':')[0];
  push(parsed);

  return hosts;
}

function tryAddWindowsSqlRoute() {
  if (process.platform !== 'win32') return false;
  const gateway = process.env.DATABASE_ROUTE_GATEWAY || DEFAULT_ROUTE_GATEWAY;
  const network = process.env.DATABASE_ROUTE_NETWORK || DEFAULT_ROUTE_NETWORK;
  const mask = process.env.DATABASE_ROUTE_MASK || DEFAULT_ROUTE_MASK;
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

export async function resolveDatabaseHost(options = {}) {
  const { tryRoute = true, quiet = false } = options;
  loadEnvFile();

  const manual = String(process.env.DATABASE_HOST || '').trim();
  const port = parsePort();
  const hosts = candidateHosts();

  const pick = async () => {
    for (const host of hosts) {
      if (await probeTcp(host, port)) return host;
    }
    return null;
  };

  if (manual) {
    if (await probeTcp(manual, port)) {
      if (!quiet) console.log(`[db] Host SQL: ${manual}:${port}`);
      return manual;
    }
    if (!quiet) {
      console.warn(`[db] DATABASE_HOST=${manual} no responde; probando alternativas…`);
    }
  }

  let found = await pick();
  if (!found && tryRoute) {
    const routed = tryAddWindowsSqlRoute();
    if (routed && !quiet) {
      console.log('[db] Ruta hacia SQL agregada (192.168.10.x vía gateway Ethernet).');
    }
    found = await pick();
  }

  if (found) {
    process.env.DATABASE_HOST = found;
    if (!quiet) console.log(`[db] Host SQL alcanzable: ${found}:${port}`);
    return found;
  }

  if (!quiet) {
    console.warn(
      '[db] No se alcanza SQL Server. En oficina sin cable: ejecuta como admin `npm run db:route`.\n' +
        '     Fuera de oficina: conecta la VPN corporativa. Luego `npm run test:db`.'
    );
  }
  return hosts[0] || DEFAULT_SQL_HOST;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  resolveDatabaseHost({ quiet: false }).then((host) => {
    process.exit(host ? 0 : 1);
  });
}
