import bcrypt from 'bcryptjs';
import type { PrismaClient } from '../../app/generated/prisma';

/**
 * REAUTENTICACIÓN con la contraseña de SynerLink (para firmar).
 *
 * Misma regla del inicio de sesión (app/api/auth/[...nextauth]/route.ts) y de la
 * reautenticación del SGC (lib/sgc/signature/reauth.ts, que es una copia propia
 * del sistema validado y NO se toca): usuario activo, que no sea proveedor, con
 * hash bcrypt. La contraseña nunca se guarda ni se registra.
 * Ayudante compartido para los módulos fuera del SGC (hoy, la Bitácora de Proceso).
 */
export type PasswordVerifier = (email: string, password: string) => Promise<boolean>;

const SUPPLIER_ROLE = 'supplier';
let dummyHash: string | null = null;

export function synerlinkPasswordVerifier(db: Pick<PrismaClient, '$queryRaw'>): PasswordVerifier {
  return async (email, password) => {
    if (!email || !password) return false;
    const rows = await db.$queryRaw<{ password: string | null; role: string; isActive: boolean }[]>`
      SELECT TOP 1 password, role, isActive FROM [dbo].[user]
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${email})))`;
    const user = rows[0];
    if (!user || !user.password || !user.isActive || user.role === SUPPLIER_ROLE) {
      // Mismo costo que una comparación real: no revela si el usuario existe.
      dummyHash ??= bcrypt.hashSync('synerlink-sin-usuario', 10);
      await bcrypt.compare(password, dummyHash);
      return false;
    }
    return bcrypt.compare(password, user.password);
  };
}
