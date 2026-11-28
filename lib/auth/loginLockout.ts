import 'server-only';
import { prisma } from '../prisma';
import { normalizeIdentifier } from './login-audit/flow';
import { LOCKOUT_COUNTED_REASONS, LOGIN_LOCKOUT_WINDOW_MINUTES, isLockedOut } from './sessionPolicy';

/**
 * Counts the failed attempts for an identifier (email or NIT) inside the lockout window,
 * only after its last successful login. Reads dbo.user_login_audit, which the login
 * already writes for every attempt.
 *
 * Never breaks the login (same rule as the audit recorder): if the table or the database
 * fails, it returns 0 and logs once.
 */
export async function countRecentLoginFailures(identifier: string | null | undefined): Promise<number> {
  const id = normalizeIdentifier(identifier);
  if (!id) return 0;
  try {
    const reasons = LOCKOUT_COUNTED_REASONS.join(',');
    const rows = await prisma.$queryRaw<Array<{ failures: number }>>`
      SELECT COUNT(*) AS failures
      FROM dbo.user_login_audit
      WHERE identifier = ${id}
        AND success = 0
        AND failure_reason IN (SELECT value FROM STRING_SPLIT(${reasons}, ','))
        AND attempted_at > DATEADD(MINUTE, -${LOGIN_LOCKOUT_WINDOW_MINUTES}, SYSUTCDATETIME())
        AND attempted_at > ISNULL(
          (SELECT MAX(attempted_at) FROM dbo.user_login_audit WHERE identifier = ${id} AND success = 1),
          '19000101')
    `;
    return Number(rows[0]?.failures ?? 0);
  } catch (err) {
    console.error('[login-lockout] could not read user_login_audit:', (err as Error)?.message);
    return 0;
  }
}

/** True when the identifier reached the failed-attempt limit within the window. */
export async function isLoginLockedOut(identifier: string | null | undefined): Promise<boolean> {
  return isLockedOut(await countRecentLoginFailures(identifier));
}
