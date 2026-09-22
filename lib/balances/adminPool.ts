import 'server-only';
import sql from 'mssql';

/**
 * Pool de conexión APARTE, dedicado al módulo de Balances.
 *
 * Apunta al SQL Server de serfarma07 (192.168.10.7), base FARMA_IND_PROD —
 * NO al SQL Server de KRONOSDB (serfarma03, 192.168.10.3) que usa el resto de
 * la app vía `lib/mssqlPool.ts`. Mismo principio que `dbconfigadmin.js` en
 * SAPSEND-GSS: una conexión separada para no repuntar el resto de la app si
 * cambia algo de este lado (ver memoria "botón Ejecutar balances SAPSEND GSS").
 *
 * Variables de entorno requeridas (documentar en el .env de despliegue,
 * NO comitear valores reales):
 *   BALANCES_SQL_SERVER   (192.168.10.7)
 *   BALANCES_SQL_DB       (FARMA_IND_PROD)
 *   BALANCES_SQL_USER     (reutiliza el login 'adminDesarrollo' ya existente
 *                          en el 10.7, o uno dedicado si Nicolás prefiere)
 *   BALANCES_SQL_PASS
 */

declare global {
  var __balancesMssqlPool: sql.ConnectionPool | undefined;
  var __balancesMssqlPoolPromise: Promise<sql.ConnectionPool> | undefined;
}

const REQUIRED_ENV = [
  'BALANCES_SQL_SERVER',
  'BALANCES_SQL_DB',
  'BALANCES_SQL_USER',
  'BALANCES_SQL_PASS',
] as const;

/**
 * Verifica únicamente la presencia de configuración; no abre conexión ni
 * ejecuta SQL. Se usa antes de registrar una corrida para no dejar una fila
 * `running` que inevitablemente fallará por una activación incompleta.
 */
type BalancesEnvironment = Partial<Record<(typeof REQUIRED_ENV)[number], string | undefined>>;
const runtimeEnvironment = process.env as unknown as BalancesEnvironment;

export function getBalancesConfigurationError(
  environment: BalancesEnvironment = runtimeEnvironment
): string | null {
  const missing = REQUIRED_ENV.filter((name) => !environment[name]);
  return missing.length > 0
    ? `Faltan variables de entorno: ${missing.join(', ')}`
    : null;
}

function buildConfig(): sql.config {
  const server = process.env.BALANCES_SQL_SERVER;
  const database = process.env.BALANCES_SQL_DB;
  const user = process.env.BALANCES_SQL_USER;
  const password = process.env.BALANCES_SQL_PASS;

  const configurationError = getBalancesConfigurationError();
  if (configurationError) {
    throw new Error(configurationError);
  }

  return {
    server: server!,
    database: database!,
    user: user!,
    password: password!,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 120_000, // los balances acumulados son consultas pesadas
    pool: { max: 3, min: 0, idleTimeoutMillis: 30_000 },
  };
}

/** Pool compartido (con caché en `global` para sobrevivir HMR en dev, igual que mssqlPool.ts). */
export async function getBalancesPool(): Promise<sql.ConnectionPool> {
  const existing = global.__balancesMssqlPool;
  if (existing && existing.connected) {
    return existing;
  }

  const pending = global.__balancesMssqlPoolPromise;
  if (pending) return pending;

  const connectPromise = (async () => {
    const pool = await new sql.ConnectionPool(buildConfig()).connect();
    global.__balancesMssqlPool = pool;
    return pool;
  })();

  global.__balancesMssqlPoolPromise = connectPromise;
  try {
    return await connectPromise;
  } catch (error) {
    global.__balancesMssqlPool = undefined;
    throw error;
  } finally {
    if (global.__balancesMssqlPoolPromise === connectPromise) {
      global.__balancesMssqlPoolPromise = undefined;
    }
  }
}

export { sql };
