import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getHealthRecordsAccess, toPublicAccess } from '../../../../lib/health-records/access';
import { checkAdminPrivileges } from '../../../../lib/access-control';

/**
 * Empresas a las que el usuario tiene acceso en el modulo de registros
 * sanitarios, con su nivel (lectura/escritura). Vista PUBLICA: no expone
 * credenciales SAP (esas solo se usan en el route `list`, en servidor).
 * Incluye `isAdmin` para que la UI muestre acciones solo para administradores.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [access, isAdmin] = await Promise.all([
      getHealthRecordsAccess(session.user.email),
      checkAdminPrivileges(session.user.email),
    ]);
    return NextResponse.json({ companies: toPublicAccess(access), isAdmin });
  } catch (error) {
    console.error('Error fetching health-records access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
