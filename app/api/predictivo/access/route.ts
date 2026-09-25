import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { hasPrediccionesAccess } from '../../../../lib/predictivo/access';

/** Mismo patrón que /api/service-layer-metrics/access. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const canAccess = await hasPrediccionesAccess(session.user.email);
    return NextResponse.json({ canAccess });
  } catch (error) {
    console.error('Error verificando acceso a Predicciones:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
