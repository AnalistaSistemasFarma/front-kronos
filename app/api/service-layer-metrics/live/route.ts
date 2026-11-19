import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { hasServiceLayerMetricsAccess } from '../../../../lib/service-layer-metrics/access';
import { buildServiceLayerLiveSnapshot } from '../../../../lib/service-layer-metrics/live';

/**
 * GET /api/service-layer-metrics/live
 *
 * Foto en vivo: todas las empresas con sap_endpoints + concurrencia/latencia
 * de las llamadas Service Layer hechas por esta instancia de SynerLink.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowed = await hasServiceLayerMetricsAccess(session.user.email);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const snapshot = await buildServiceLayerLiveSnapshot(prisma);
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[service-layer-metrics/live]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
