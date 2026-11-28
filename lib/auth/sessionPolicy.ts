/**
 * Session and login policy (SGC validation, URS-ACC-04 / Anexo 3 cláusula 9.9).
 *
 * - Absolute session lifetime: SESSION_MAX_HOURS (default 12 h) counted from sign-in,
 *   enforced on the server (jwt callback + middleware), so polling cannot extend it.
 * - Inactivity: NEXT_PUBLIC_SESSION_IDLE_MINUTES (default 15 min) without keyboard,
 *   mouse, touch or scroll in any tab closes the session (components/auth/IdleSessionGuard).
 * - Login lockout: LOGIN_LOCKOUT_MAX_FAILURES (default 5) failed attempts for the same
 *   identifier within LOGIN_LOCKOUT_WINDOW_MINUTES (default 15) block new attempts until
 *   the window passes. A successful login resets the count.
 *
 * Pure functions only: safe to import from the middleware (edge) and the client.
 */

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const SESSION_MAX_HOURS = positiveNumber(process.env.SESSION_MAX_HOURS, 12);
export const SESSION_MAX_AGE_SECONDS = Math.round(SESSION_MAX_HOURS * 3600);
export const SESSION_IDLE_MINUTES = positiveNumber(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES, 15);
export const LOGIN_LOCKOUT_MAX_FAILURES = positiveNumber(process.env.LOGIN_LOCKOUT_MAX_FAILURES, 5);
export const LOGIN_LOCKOUT_WINDOW_MINUTES = positiveNumber(process.env.LOGIN_LOCKOUT_WINDOW_MINUTES, 15);

/** Error code shown on the login page when the account is temporarily locked. */
export const LOCKED_OUT_ERROR = 'CUENTA_BLOQUEADA';
/** Query value used when the session is closed for inactivity or because it expired. */
export const SESSION_CLOSED_REASON = { idle: 'inactividad', expired: 'vencida' } as const;

/** Failure reasons that count toward the lockout (no user enumeration: unknown users count too). */
export const LOCKOUT_COUNTED_REASONS = [
  'CONTRASENA_INCORRECTA',
  'USUARIO_NO_EXISTE',
  'SIN_CONTRASENA',
  'NIT_NO_REGISTRADO',
] as const;

/** True when a session that started at `loginAt` (epoch ms) is past the absolute lifetime. */
export function isSessionExpired(loginAt: unknown, now: number = Date.now(), maxSeconds: number = SESSION_MAX_AGE_SECONDS): boolean {
  if (typeof loginAt !== 'number' || !Number.isFinite(loginAt)) return false;
  return now - loginAt > maxSeconds * 1000;
}

/** True when the number of recent counted failures reaches the lockout threshold. */
export function isLockedOut(recentFailures: number, maxFailures: number = LOGIN_LOCKOUT_MAX_FAILURES): boolean {
  return Number.isFinite(recentFailures) && recentFailures >= maxFailures;
}

/** True when the last activity (epoch ms) is older than the idle limit. */
export function isIdle(lastActivity: number | null, now: number = Date.now(), idleMinutes: number = SESSION_IDLE_MINUTES): boolean {
  if (lastActivity === null || !Number.isFinite(lastActivity)) return false;
  return now - lastActivity > idleMinutes * 60_000;
}
