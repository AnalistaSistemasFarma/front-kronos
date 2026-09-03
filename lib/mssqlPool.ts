import 'server-only';
import sql from 'mssql';
import dbconfig from '../dbconfig';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ensureDbHost = require('./db/ensureDatabaseHost.server.cjs') as {
  ensureDatabaseHostResolved?: () => Promise<string>;
  clearResolvedDatabaseHost?: () => void;
};

// `dbconfig` puede ser un objeto de configuración plano (dbconfig.js) o exponer helpers.
const dbAny = dbconfig as unknown as {
  buildMssqlConfig?: () => sql.config;
  getDatabaseConfigKey?: () => string;
  server?: string;
  database?: string;
  user?: string;
};

const buildMssqlConfig: () => sql.config =
  typeof dbAny.buildMssqlConfig === 'function'
    ? dbAny.buildMssqlConfig
    : () => dbconfig as unknown as sql.config;

const getDatabaseConfigKey: () => string =
  typeof dbAny.getDatabaseConfigKey === 'function'
    ? dbAny.getDatabaseConfigKey
    : () => `${dbAny.server ?? ''}/${dbAny.database ?? ''}/${dbAny.user ?? ''}`;

/**
 * Tipos .input() de la misma instancia de mssql que el pool activo.
 * En dev (Turbopack HMR) el módulo se recarga; reutilizar el pool viejo con tipos nuevos
 * provoca EPARAM: parameter.type.validate is not a function.
 */
export { sql };

declare global {
  var __kronosMssqlPool: sql.ConnectionPool | undefined;
  var __kronosMssqlPoolConfigKey: string | undefined;
  var __kronosMssqlModule: typeof sql | undefined;
  var __kronosMssqlPoolPromise: Promise<sql.ConnectionPool> | undefined;
}

function invalidateGlobalPool(): void {
  const existing = global.__kronosMssqlPool;
  if (existing) {
    void existing.close().catch(() => {
      /* pool ya cerrado */
    });
  }
  global.__kronosMssqlPool = undefined;
  global.__kronosMssqlPoolConfigKey = undefined;
  global.__kronosMssqlPoolPromise = undefined;
  global.__kronosMssqlModule = undefined;
}

export function isMssqlNotOpenError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOTOPEN'
  );
}

/**
 * Errores de conexión recuperables reintentando con un pool nuevo: la conexión no está abierta
 * (ENOTOPEN) o se cerró mientras la operación estaba en vuelo (ECONNCLOSED, típico si el pool
 * global se recicla durante una espera larga).
 */
export function isRetryablePoolError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    if (error instanceof Error && error.message.toLowerCase().includes('abort')) {
      return true;
    }
    return false;
  }
  const code = (error as { code: string }).code;
  return (
    code === 'ENOTOPEN' ||
    code === 'ECONNCLOSED' ||
    code === 'ESOCKET' ||
    code === 'ETIMEOUT' ||
    code === 'ABORT_ERR'
  );
}

function isAbortedError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg === 'aborted' || msg.includes('abort')) return true;
  }
  return false;
}

function isSocketReachabilityError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code: string }).code;
  return code === 'ESOCKET' || code === 'ETIMEOUT';
}

/**
 * Pool compartido de la aplicación. No cerrar por request (evita agotar el pool global).
 * Usa single-flight para evitar ENOTOPEN por conexiones concurrentes en dev.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  const configKey = getDatabaseConfigKey();
  const moduleMatches = global.__kronosMssqlModule === sql;
  const configMatches = global.__kronosMssqlPoolConfigKey === configKey;

  const existing = global.__kronosMssqlPool;
  if (existing && configMatches && moduleMatches) {
    if (existing.connected) {
      return existing;
    }
    const pending = global.__kronosMssqlPoolPromise;
    if (pending) {
      return pending;
    }
  }

  const inFlight = global.__kronosMssqlPoolPromise;
  if (inFlight && configMatches && moduleMatches) {
    return inFlight;
  }

  invalidateGlobalPool();

  const connectPromise = (async () => {
    if (typeof ensureDbHost.ensureDatabaseHostResolved === 'function') {
      await ensureDbHost.ensureDatabaseHostResolved();
    }
    const pool = await new sql.ConnectionPool(buildMssqlConfig()).connect();
    global.__kronosMssqlPool = pool;
    global.__kronosMssqlPoolConfigKey = getDatabaseConfigKey();
    global.__kronosMssqlModule = sql;
    return pool;
  })();

  global.__kronosMssqlPoolPromise = connectPromise;

  try {
    return await connectPromise;
  } catch (error) {
    invalidateGlobalPool();
    throw error;
  } finally {
    if (global.__kronosMssqlPoolPromise === connectPromise) {
      global.__kronosMssqlPoolPromise = undefined;
    }
  }
}

/** Ejecuta una consulta reintentando si el pool quedó cerrado o la conexión se abortó (dev/HMR). */
export async function withMssqlPool<T>(
  fn: (pool: sql.ConnectionPool) => Promise<T>,
  attempt = 0
): Promise<T> {
  const maxAttempts = 3;
  try {
    return await fn(await getPool());
  } catch (error) {
    if (attempt >= maxAttempts - 1) throw error;

    if (isSocketReachabilityError(error) && typeof ensureDbHost.clearResolvedDatabaseHost === 'function') {
      ensureDbHost.clearResolvedDatabaseHost();
      invalidateGlobalPool();
      if (typeof ensureDbHost.ensureDatabaseHostResolved === 'function') {
        await ensureDbHost.ensureDatabaseHostResolved();
      }
      return withMssqlPool(fn, attempt + 1);
    }

    if (isRetryablePoolError(error) || isAbortedError(error)) {
      invalidateGlobalPool();
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
      return withMssqlPool(fn, attempt + 1);
    }

    throw error;
  }
}

/** @deprecated Preferir getPool(). Mantener compatibilidad con imports existentes. */
export default dbconfig;
