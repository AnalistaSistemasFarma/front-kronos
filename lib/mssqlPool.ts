import sql from 'mssql';
import dbconfig from '../dbconfig';

// `dbconfig` puede ser un objeto de configuración plano (dbconfig.js) o exponer helpers.
// Soportamos ambos: si trae buildMssqlConfig/getDatabaseConfigKey los usamos; si no,
// tratamos el propio objeto como la config de mssql y derivamos una clave estable.
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
    const pool = await new sql.ConnectionPool(buildMssqlConfig()).connect();
    global.__kronosMssqlPool = pool;
    global.__kronosMssqlPoolConfigKey = configKey;
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

/** Ejecuta una consulta reintentando una vez si el pool quedó cerrado (ENOTOPEN). */
export async function withMssqlPool<T>(
  fn: (pool: sql.ConnectionPool) => Promise<T>
): Promise<T> {
  try {
    return await fn(await getPool());
  } catch (error) {
    if (!isMssqlNotOpenError(error)) throw error;
    invalidateGlobalPool();
    return fn(await getPool());
  }
}

/** @deprecated Preferir getPool(). Mantener compatibilidad con imports existentes. */
export default dbconfig;
