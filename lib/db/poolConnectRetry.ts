/**
 * Reintentos al ABRIR el pool de SQL Server (solo la conexión, nunca la consulta).
 *
 * Una caída corta de red o del servicio SQL no debe tumbar la petición al primer intento:
 * se reintenta la conexión con espera creciente (≈200 ms, ≈800 ms, más un poco de azar para
 * que las peticiones simultáneas no reconecten todas en el mismo instante).
 *
 * Lo que NUNCA se reintenta es la función del usuario (`fn` de withMssqlPool): si ya se
 * ejecutó una parte, repetirla podría duplicar escrituras.
 *
 * Módulo puro (sin mssql ni dbconfig) para poder probarlo con Vitest.
 */

/** Intentos totales de conexión (1 inicial + 2 reintentos). */
export const POOL_CONNECT_MAX_ATTEMPTS = 3;

/** Espera base antes de cada reintento: 200 ms, luego 800 ms. */
const RETRY_BASE_DELAYS_MS = [200, 800];

/** Azar máximo que se suma a la espera, como fracción de la espera base. */
const RETRY_JITTER_RATIO = 0.25;

/**
 * Códigos de error de CONEXIÓN que vale la pena reintentar: socket caído o reiniciado,
 * conexión cerrada o no abierta y tiempo de espera al conectar. Un error de login
 * (ELOGIN) o de configuración no se reintenta: fallaría igual.
 */
const RETRYABLE_CONNECT_CODES = new Set([
  'ESOCKET',
  'ECONNRESET',
  'ECONNCLOSED',
  'ENOTOPEN',
  'ETIMEOUT',
]);

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** ¿El error al abrir el pool es transitorio y conviene volver a conectar? */
export function isRetryableConnectError(error: unknown): boolean {
  const code = errorCode(error);
  if (code && RETRYABLE_CONNECT_CODES.has(code)) return true;
  // mssql envuelve el error de tedious/net: ECONNRESET puede venir en originalError.
  if (typeof error === 'object' && error !== null && 'originalError' in error) {
    const original = errorCode((error as { originalError?: unknown }).originalError);
    return Boolean(original && RETRYABLE_CONNECT_CODES.has(original));
  }
  return false;
}

/**
 * ¿Se reintenta la conexión tras fallar el intento `attempt` (1 = primero)?
 * Solo si el error es transitorio y quedan intentos.
 */
export function shouldRetryPoolConnect(
  error: unknown,
  attempt: number,
  maxAttempts = POOL_CONNECT_MAX_ATTEMPTS
): boolean {
  return attempt < maxAttempts && isRetryableConnectError(error);
}

/** Espera (ms) antes del reintento que sigue al intento fallido `attempt` (1 = primero). */
export function poolConnectRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_BASE_DELAYS_MS.length) - 1;
  const base = RETRY_BASE_DELAYS_MS[index];
  return base + Math.floor(random() * base * RETRY_JITTER_RATIO);
}

/** Abre la conexión reintentando solo errores transitorios de conexión. */
export async function connectWithRetry<T>(
  connect: () => Promise<T>,
  options: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? POOL_CONNECT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (!shouldRetryPoolConnect(error, attempt, maxAttempts)) throw error;
      const delayMs = poolConnectRetryDelayMs(attempt, options.random);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
