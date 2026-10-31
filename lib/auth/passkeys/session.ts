/**
 * Persona de la sesión para las rutas de passkeys (registrar, listar, eliminar).
 * Solo usuarios internos activos: un proveedor no registra passkeys.
 */
import 'server-only';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../app/api/auth/[...nextauth]/route';
import { prisma } from '../../prisma';
import { SUPPLIER_ROLE } from '../../proveedor/isolation';
import type { PasskeyUser } from './service';

export async function passkeySessionUser(): Promise<PasskeyUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const rows = await prisma.$queryRaw<
    Array<{ id: string; email: string; name: string | null; role: string; isActive: boolean }>
  >`
    SELECT TOP 1 id, email, name, role, isActive
    FROM [user]
    WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${email})))
  `;
  const user = rows[0];
  if (!user || !user.isActive || user.role === SUPPLIER_ROLE) return null;
  return { id: user.id, email: user.email, name: user.name };
}
