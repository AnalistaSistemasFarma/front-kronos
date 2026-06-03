import sql from 'mssql';
import sqlConfig from '../dbconfig';

declare global {
  // eslint-disable-next-line no-var
  var __kronosMssqlPool: sql.ConnectionPool | undefined;
}

/**
 * Pool compartido de la aplicación. No cerrar por request (evita agotar el pool global).
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  const existing = global.__kronosMssqlPool;
  if (existing?.connected) {
    return existing;
  }

  const pool = await new sql.ConnectionPool(sqlConfig).connect();
  global.__kronosMssqlPool = pool;
  return pool;
}
