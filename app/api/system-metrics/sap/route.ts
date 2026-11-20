import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { hasSystemMetricsAccess } from '../../../../lib/system-metrics/access';
import { parseRange } from '../../../../lib/system-metrics/store';
import { isSapSqlMonitorEnabled, ingestKeys } from '../../../../lib/sap-monitor/config';
import { getSapMonitorStatus } from '../../../../lib/sap-monitor/job';
import { readSapDatabase, readSapServiceLayer, readSapViews } from '../../../../lib/sap-monitor/readers';

/**
 * GET /api/system-metrics/sap?part=db|views|sl&range=1h|6h|24h|7d
 *
 * Reads ONLY KRONOSDB (what the SAP monitor job and the Service Layer collector stored). It never
 * queries SAP: opening the screen adds zero load to the SAP server.
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await hasSystemMetricsAccess(session.user.email))) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }
    const url = new URL(request.url);
    const part = url.searchParams.get('part') ?? 'db';
    const range = parseRange(url.searchParams.get('range'));
    const config = {
      sqlConfigured: isSapSqlMonitorEnabled(),
      ingestConfigured: ingestKeys().length > 0,
      job: getSapMonitorStatus(),
    };
    try {
      const data = await withMssqlPool<unknown>((pool) =>
        part === 'views' ? readSapViews(pool, range) : part === 'sl' ? readSapServiceLayer(pool, range) : readSapDatabase(pool, range)
      );
      return NextResponse.json({ part, range, config, tablesMissing: false, data });
    } catch (error) {
      if ((error as { number?: number })?.number === 208) {
        return NextResponse.json({ part, range, config, tablesMissing: true, data: null });
      }
      throw error;
    }
  } catch (error) {
    console.error('[sap-monitor] Error leyendo el monitor SAP:', error);
    return NextResponse.json({ error: 'No se pudo leer el monitor SAP' }, { status: 500 });
  }
}
