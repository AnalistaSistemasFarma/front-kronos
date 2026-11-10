import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '../../../lib/prisma';
import { hasServiceLayerMetricsAccess } from '../../../lib/service-layer-metrics/access';
import { getServiceLayerMetrics } from '../../../lib/service-layer-metrics/metrics';

/**
 * GET /api/service-layer-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Métricas diarias del SAP Business One Service Layer (OLP) -- ver
 * lib/service-layer-metrics/metrics.ts para la consulta y
 * app/(hub)/process/service-layer-metrics/page.tsx para el consumidor.
 * `from`/`to` son opcionales; sin ellos devuelve la serie completa.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowed = await hasServiceLayerMetricsAccess(session.user.email);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') ?? undefined;
    const to = searchParams.get('to') ?? undefined;

    const metrics = await getServiceLayerMetrics(prisma, { from, to });

    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('Error consultando métricas del Service Layer:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
