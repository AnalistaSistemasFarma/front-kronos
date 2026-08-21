import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getDocumentManagementAccess } from '../../../../lib/document-management/access';

/**
 * Empresas a las que el usuario tiene acceso en el módulo de Gestión
 * Documental, con su nivel (lectura/escritura). Mismo patrón que
 * /api/health-records/access.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companies = await getDocumentManagementAccess(session.user.email);
    return NextResponse.json({ companies });
  } catch (error) {
    console.error('Error fetching document-management access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
