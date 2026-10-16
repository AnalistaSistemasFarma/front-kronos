import 'server-only';
import sql from 'mssql';
import dbconfig from '../dbconfig';
import { connectWithRetry } from './db/poolConnectRetry';

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
 * global se recicla durante una espera larga). Un timeout de consulta NO se reintenta: casi
 * siempre es un bloqueo en la base, y relanzarla solo suma sesiones bloqueadas.
 */
export function isRetryablePoolError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code: string }).code;
  return code === 'ENOTOPEN' || code === 'ECONNCLOSED';
}

/**
 * Pool compartido de la aplicación. No cerrar por request (evita agotar el pool global).
 * Usa single-flight para evitar ENOTOPEN por conexiones concurrentes en dev.
 * Si SQL no responde al conectar (caída corta de red o del servicio), reintenta la
 * conexión 2 veces con espera creciente (lib/db/poolConnectRetry.ts).
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
    const pool = await connectWithRetry(
      async () => {
        const candidate = new sql.ConnectionPool(buildMssqlConfig());
        try {
          return await candidate.connect();
        } catch (error) {
          void candidate.close().catch(() => {
            /* nunca abrió */
          });
          throw error;
        }
      },
      {
        onRetry: ({ attempt, delayMs, error }) => {
          const code = (error as { code?: string })?.code ?? 'sin código';
          console.warn(
            `[mssqlPool] conexión a SQL falló (${code}, intento ${attempt}); reintento en ${delayMs} ms`
          );
        },
      }
    );
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

/**
 * Ejecuta `fn` con el pool compartido. La conexión se reintenta dentro de getPool(), pero
 * `fn` NUNCA se repite: si ya corrió una parte, repetirla podría duplicar escrituras. Si falla
 * porque el pool quedó cerrado (ENOTOPEN / ECONNCLOSED), se descarta el pool para que la
 * siguiente llamada abra uno nuevo, y el error se propaga.
 */
export async function withMssqlPool<T>(fn: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const pool = await getPool();
  try {
    return await fn(pool);
  } catch (error) {
    if (isRetryablePoolError(error) && global.__kronosMssqlPool === pool) invalidateGlobalPool();
    throw error;
  }
}

/** @deprecated Preferir getPool(). Mantener compatibilidad con imports existentes. */
export default dbconfig;
