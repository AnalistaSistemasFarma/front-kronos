import bcrypt from 'bcryptjs';
import type { PrismaClient } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS } from '../audit';
import { SgcError } from '../errors';

/**
 * REAUTENTICACIÓN en el momento de firmar (decisión de Nicolás, 2026-09-30
 * 17:24: «firma propia, con reautenticación y motivo»).
 *
 * La persona vuelve a escribir su contraseña de SynerLink; se compara con el
 * hash bcrypt de dbo.[user] (la misma regla del inicio de sesión: usuario
 * activo, no proveedor). La contraseña NUNCA se guarda, ni se registra, ni
 * viaja a la evidencia o a la auditoría: solo queda «reautenticación correcta»
 * o «fallida».
 *
 * Bloqueo: 5 intentos fallidos en 15 minutos bloquean la firma de esa persona
 * por el resto de la ventana (cuenta en sgc.audit_log, inmodificable).
 */

export type SgcPasswordVerifier = (email: string, password: string) => Promise<boolean>;

export const SGC_REAUTH_MAX_FAILURES = 5;
export const SGC_REAUTH_WINDOW_MINUTES = 15;

const SUPPLIER_ROLE = 'supplier';

let dummyHash: string | null = null;
function dummy(): string {
  dummyHash ??= bcrypt.hashSync('sgc-sin-usuario', 10);
  return dummyHash;
}

/** Verificador real: compara con el hash bcrypt del usuario de SynerLink. */
export function synerlinkPasswordVerifier(db: Pick<PrismaClient, '$queryRaw'>): SgcPasswordVerifier {
  return async (email, password) => {
    const rows = await db.$queryRaw<{ password: string | null; role: string; isActive: boolean }[]>`
      SELECT TOP 1 password, role, isActive FROM [dbo].[user]
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${email})))`;
    const user = rows[0];
    if (!user || !user.password || !user.isActive || user.role === SUPPLIER_ROLE) {
      // Mismo costo que una comparación real: no revela si el usuario existe.
      await bcrypt.compare(password, dummy());
      return false;
    }
    return bcrypt.compare(password, user.password);
  };
}

/** Intentos fallidos recientes de la persona (desde la auditoría). */
export async function recentReauthFailures(db: Pick<PrismaClient, 'sgcAuditLog'>, email: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - SGC_REAUTH_WINDOW_MINUTES * 60_000);
  return db.sgcAuditLog.count({
    where: { actor_email: email.trim().toLowerCase(), action: SGC_AUDIT_ACTIONS.firmaReautenticacionFallida, occurred_at: { gte: since } },
  });
}

/** Lanza 429 si la persona agotó los intentos de la ventana. */
export async function assertReauthNotLocked(db: Pick<PrismaClient, 'sgcAuditLog'>, email: string, now: Date): Promise<void> {
  const failures = await recentReauthFailures(db, email, now);
  if (failures >= SGC_REAUTH_MAX_FAILURES) {
    throw new SgcError(`Firma bloqueada: ${SGC_REAUTH_MAX_FAILURES} intentos con contraseña incorrecta en ${SGC_REAUTH_WINDOW_MINUTES} minutos. Espere e intente de nuevo.`, 429);
  }
}
