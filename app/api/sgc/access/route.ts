import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getSgcAccessForUser } from '../../../../lib/sgc/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/access — empresas del SGC documental que el usuario de la
 * sesión puede usar y con qué permisos (lectura, gestión, calidad, flujos).
 *
 * Seguridad: todo se resuelve a partir del correo de la sesión; el cliente
 * no envía identificadores. Sin sesión → 401. Sin empresas → lista vacía
 * (el módulo queda invisible, no roto).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const companies = await getSgcAccessForUser(prisma, email);
    return NextResponse.json(
      { companies },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[sgc/access] Error resolviendo el acceso al SGC:', error);
    return NextResponse.json({ error: 'No se pudo resolver el acceso al SGC' }, { status: 500 });
  }
}
