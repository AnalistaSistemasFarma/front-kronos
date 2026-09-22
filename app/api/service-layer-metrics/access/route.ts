import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { hasServiceLayerMetricsAccess } from '../../../../lib/service-layer-metrics/access';

/** Mismo patrón que /api/organigrama/access y /api/document-management/access. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccess = await hasServiceLayerMetricsAccess(session.user.email);
    return NextResponse.json({ canAccess });
  } catch (error) {
    console.error('Error verificando acceso a métricas del Service Layer:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
