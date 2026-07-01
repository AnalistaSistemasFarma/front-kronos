import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPurchasesAccess, toPublicAccess } from '../../../../lib/purchases/access';

/**
 * Empresas a las que el usuario tiene acceso de lectura en el modulo de compras.
 * Vista PUBLICA: no expone credenciales SAP.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getPurchasesAccess(session.user.email);
    return NextResponse.json({ companies: toPublicAccess(access) });
  } catch (error) {
    console.error('Error fetching purchases access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
