import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { hasSystemMetricsAccess } from '../../../../lib/system-metrics/access';
import { readSystemOverview } from '../../../../lib/system-metrics/overview';
import type { SystemOverview } from '../../../../lib/system-metrics/overviewModel';

/**
 * GET /api/system-metrics/overview
 *
 * Vista general: cada Kronos (Producción, Pruebas…) con sus personas activas, Orion, las demás
 * aplicaciones del SQL Server compartido y las máquinas que se conectan. Solo lectura, pero
 * recorre todas las bases: se guarda 30 s por proceso.
 */
const CACHE_MS = 30_000;

declare global {
  var __kronosOverviewCache: { at: number; data: SystemOverview } | undefined;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await hasSystemMetricsAccess(session.user.email))) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const cached = globalThis.__kronosOverviewCache;
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return NextResponse.json(cached.data);
    }

    const data = await withMssqlPool((pool) => readSystemOverview(pool));
    globalThis.__kronosOverviewCache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error armando la vista general del sistema:', error);
    return NextResponse.json({ error: 'No se pudo armar la vista general' }, { status: 500 });
  }
}
