import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getBusinessPartnersAccess, toPublicAccess } from '../../../../lib/business-partners/access';

/**
 * Empresas a las que el usuario tiene acceso en el modulo de socios de negocio.
 * Vista PUBLICA: no expone credenciales SAP. Modulo de solo lectura, por lo que
 * solo se informa el nivel de lectura y si la empresa esta lista.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getBusinessPartnersAccess(session.user.email);
    return NextResponse.json({ companies: toPublicAccess(access) });
  } catch (error) {
    console.error('Error fetching business partners access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
