import sql from 'mssql';
import dbconfig, { buildMssqlConfig, getDatabaseConfigKey } from '../dbconfig';

declare global {
  // eslint-disable-next-line no-var
  var __kronosMssqlPool: sql.ConnectionPool | undefined;
  // eslint-disable-next-line no-var
  var __kronosMssqlPoolConfigKey: string | undefined;
}

/**
 * Pool compartido de la aplicación. No cerrar por request (evita agotar el pool global).
 * Si cambia DATABASE_URL, se reconecta automáticamente.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  const configKey = getDatabaseConfigKey();
  const existing = global.__kronosMssqlPool;

  if (existing?.connected && global.__kronosMssqlPoolConfigKey === configKey) {
    return existing;
  }

  if (existing) {
    try {
      await existing.close();
    } catch {
      /* pool ya cerrado */
    }
    global.__kronosMssqlPool = undefined;
  }

  const pool = await new sql.ConnectionPool(buildMssqlConfig()).connect();
  global.__kronosMssqlPool = pool;
  global.__kronosMssqlPoolConfigKey = configKey;
  return pool;
}

/** @deprecated Preferir getPool(). Mantener compatibilidad con imports existentes. */
export default dbconfig;
