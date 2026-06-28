import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getArticlesAccess, toPublicAccess } from '../../../../lib/articles/access';

/**
 * Empresas a las que el usuario tiene acceso en el modulo de articulos, con su
 * nivel (lectura/escritura). Vista PUBLICA: no expone credenciales SAP.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getArticlesAccess(session.user.email);
    return NextResponse.json({ companies: toPublicAccess(access) });
  } catch (error) {
    console.error('Error fetching articles access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
