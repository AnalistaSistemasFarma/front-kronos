import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getOrganigramaAccess } from '../../../../lib/organigrama/access';
import { getCargos } from '../../../../lib/organigrama/tree';

/**
 * Catalogo de cargos activos, para poblar el selector de "jefe" al reasignar.
 * Solo requiere que el usuario tenga acceso al modulo en al menos una empresa.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getOrganigramaAccess(session.user.email);
    if (access.length === 0) {
      return NextResponse.json({ error: 'Sin acceso al modulo' }, { status: 403 });
    }

    const cargos = await getCargos();
    return NextResponse.json({ cargos });
  } catch (error) {
    console.error('Error fetching cargos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
