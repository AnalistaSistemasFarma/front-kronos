/**
 * Conexión de SOLO LECTURA dedicada para el Constructor de Vistas SQL.
 *
 * Abre una conexión mssql usando `VIEWS_DATABASE_URL` (usuario read-only
 * `kronos_views_ro`), NUNCA la conexión de escritura de la app (adminSAPSEND).
 * Ver propuesta técnica §4.2 / §4.3.
 *
 * - `requestTimeout` acotado (por defecto ~20 s).
 * - Pool propio, separado del pool de escritura (`lib/mssqlPool.ts`).
 */
import sql from 'mssql';

export const RO_REQUEST_TIMEOUT_MS = 20000;

/**
 * Parsea la URL estilo Prisma de SQL Server:
 *   sqlserver://HOST:PORT;database=..;user=..;password=..;trustServerCertificate=true;encrypt=false
 * y la convierte a la config del driver `mssql`.
 */
export function parseViewsDatabaseUrl(url: string): sql.config {
  if (!url) {
    throw new Error('VIEWS_DATABASE_URL no está definida en el entorno.');
  }
  const withoutScheme = url.replace(/^sqlserver:\/\//i, '');
  const parts = withoutScheme.split(';').filter((p) => p.length > 0);
  const hostPart = parts.shift() ?? '';
  const [host, portStr] = hostPart.split(':');

  const kv: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim().toLowerCase();
    const val = p.slice(idx + 1).trim();
    kv[key] = val;
  }

  const truthy = (v: string | undefined) => v !== undefined && /^(true|1|yes)$/i.test(v);

  return {
    server: host,
    port: portStr ? Number(portStr) : 1433,
    database: kv['database'],
    user: kv['user'],
    password: kv['password'],
    requestTimeout: RO_REQUEST_TIMEOUT_MS,
    connectionTimeout: 15000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: truthy(kv['encrypt']),
      trustServerCertificate: truthy(kv['trustservercertificate']),
    },
  } as sql.config;
}

declare global {
  // eslint-disable-next-line no-var
  var __kronosRoPool: sql.ConnectionPool | undefined;
  // eslint-disable-next-line no-var
  var __kronosRoPoolPromise: Promise<sql.ConnectionPool> | undefined;
}

/** Pool read-only compartido (cacheado en global para sobrevivir el HMR de dev). */
export async function getRoPool(): Promise<sql.ConnectionPool> {
  const existing = global.__kronosRoPool;
  if (existing && existing.connected) return existing;

  const pending = global.__kronosRoPoolPromise;
  if (pending) return pending;

  const config = parseViewsDatabaseUrl(process.env.VIEWS_DATABASE_URL ?? '');
  const connectPromise = (async () => {
    const pool = await new sql.ConnectionPool(config).connect();
    global.__kronosRoPool = pool;
    return pool;
  })();
  global.__kronosRoPoolPromise = connectPromise;
  try {
    return await connectPromise;
  } catch (error) {
    global.__kronosRoPool = undefined;
    throw error;
  } finally {
    if (global.__kronosRoPoolPromise === connectPromise) {
      global.__kronosRoPoolPromise = undefined;
    }
  }
}

export interface RoQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Ejecuta una consulta de SOLO LECTURA con el usuario read-only y timeout acotado.
 * NO valida el SQL: el llamador DEBE validar antes con el candado + whitelist.
 */
export async function runReadOnlyQuery(text: string): Promise<RoQueryResult> {
  const pool = await getRoPool();
  const request = pool.request();
  // El timeout ya está fijado a nivel de pool (requestTimeout en parseViewsDatabaseUrl).
  const result = await request.query(text);
  const rows = (result.recordset ?? []) as Record<string, unknown>[];
  const columns =
    result.recordset && result.recordset.columns
      ? Object.keys(result.recordset.columns)
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];
  return { columns, rows, rowCount: rows.length };
}
