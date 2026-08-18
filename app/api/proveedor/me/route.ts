import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getSupplierIdentityFromSession } from '../../../../lib/proveedor/session';

/**
 * Perfil del proveedor autenticado (para el encabezado del portal).
 * GET /api/proveedor/me
 *
 * AISLAMIENTO: deny by default; los datos se leen por el id de usuario derivado de
 * la SESIÓN. Nunca se acepta un id/NIT del cliente. Solo expone datos propios y no
 * sensibles (nombre, NIT, correo de contacto). Nunca la contraseña.
 */
export async function GET() {
  try {
    const ident = await getSupplierIdentityFromSession();
    if (!ident) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const session = await getServerSession(authOptions);
    const user = await prisma.user.findUnique({
      where: { id: ident.userId },
      select: { name: true, email: true },
    });

    return NextResponse.json(
      {
        nit: ident.nit,
        name: user?.name ?? session?.user?.name ?? null,
        email: user?.email ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Error en /api/proveedor/me GET:', err);
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}
