import sql from 'mssql';
import dbconfig, { buildMssqlConfig, getDatabaseConfigKey } from '../dbconfig';

/**
 * Tipos .input() de la misma instancia de mssql que el pool activo.
 * En dev (Turbopack HMR) el módulo se recarga; reutilizar el pool viejo con tipos nuevos
 * provoca EPARAM: parameter.type.validate is not a function.
 */
export { sql };

declare global {
  // eslint-disable-next-line no-var
  var __kronosMssqlPool: sql.ConnectionPool | undefined;
  // eslint-disable-next-line no-var
  var __kronosMssqlPoolConfigKey: string | undefined;
  // eslint-disable-next-line no-var
  var __kronosMssqlModule: typeof sql | undefined;
}

function closeGlobalPool(): void {
  const existing = global.__kronosMssqlPool;
  if (!existing) return;
  void existing.close().catch(() => {
    /* pool ya cerrado */
  });
  global.__kronosMssqlPool = undefined;
}

/**
 * Pool compartido de la aplicación. No cerrar por request (evita agotar el pool global).
 * Si cambia DATABASE_URL o Turbopack recarga mssql, se reconecta automáticamente.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  const configKey = getDatabaseConfigKey();
  const existing = global.__kronosMssqlPool;
  const moduleMatches = global.__kronosMssqlModule === sql;

  if (existing?.connected && global.__kronosMssqlPoolConfigKey === configKey && moduleMatches) {
    return existing;
  }

  if (existing) {
    closeGlobalPool();
  }

  const pool = await new sql.ConnectionPool(buildMssqlConfig()).connect();
  global.__kronosMssqlPool = pool;
  global.__kronosMssqlPoolConfigKey = configKey;
  global.__kronosMssqlModule = sql;
  return pool;
}

/** @deprecated Preferir getPool(). Mantener compatibilidad con imports existentes. */
export default dbconfig;
