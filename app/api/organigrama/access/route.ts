import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getOrganigramaAccess } from '../../../../lib/organigrama/access';

/**
 * Empresas a las que el usuario tiene acceso en el modulo de organigrama.
 * No expone credenciales (el organigrama no usa SAP).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getOrganigramaAccess(session.user.email);
    return NextResponse.json({ companies: access });
  } catch (error) {
    console.error('Error fetching organigrama access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
