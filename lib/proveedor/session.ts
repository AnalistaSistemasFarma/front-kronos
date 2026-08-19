import { getServerSession } from 'next-auth';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { prisma } from '../prisma';
import {
  extractSupplierIdentity,
  normalizeNit,
  SUPPLIER_ROLE,
  type SupplierIdentity,
} from './isolation';

/**
 * Resuelve la identidad del proveedor de forma AUTORITATIVA para el lado del servidor.
 *
 * Defensa en profundidad:
 *  1. Deriva la identidad SOLO de la sesión firmada (nunca del cliente).
 *  2. Re-verifica contra la BD que el usuario siga existiendo, siga siendo
 *     'supplier' y esté activo.
 *  3. Toma el NIT DEFINITIVO de la BD (no del token) y exige que coincida con el
 *     de la sesión. Así, todo el scoping posterior usa un NIT/usuario de confianza.
 *
 * Devuelve null (DENY BY DEFAULT) ante cualquier inconsistencia.
 */
export async function getSupplierIdentityFromSession(): Promise<SupplierIdentity | null> {
  const session = await getServerSession(authOptions);
  const ident = extractSupplierIdentity(session);
  if (!ident) return null;

  const user = await prisma.user.findUnique({
    where: { id: ident.userId },
    select: { role: true, isActive: true, nit: true },
  });

  if (!user || user.role !== SUPPLIER_ROLE || !user.isActive) return null;

  const dbNit = normalizeNit(user.nit);
  if (!dbNit || dbNit !== ident.nit) return null;

  return { userId: ident.userId, nit: dbNit };
}
