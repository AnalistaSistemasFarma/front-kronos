import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../lib/mssqlPool';
import { hasSystemMetricsAccess } from '../../../lib/system-metrics/access';
import { getSystemMetricsStatus } from '../../../lib/system-metrics/collector';
import { moduleLabel, outboundHostLabel } from '../../../lib/system-metrics/routeKey';
import {
  isMissingTableError,
  parseRange,
  readActiveUsers,
  readDbSeries,
  readModuleSeries,
  readModuleShare,
  readPeriodSummaries,
  readProcessLifetimes,
  readProcessSeries,
  readRecentAlerts,
  readRouteRanking,
  readUserRanking,
} from '../../../lib/system-metrics/store';

const ALERT_HISTORY_HOURS = 48;

/**
 * GET /api/system-metrics?range=1h|6h|24h|7d
 *
 * Datos del Monitor del sistema (lib/system-metrics). Si las tablas aún no existen devuelve
 * `tablesMissing: true` y el estado en vivo del proceso que atendió la petición, para que la
 * pantalla explique qué falta en vez de fallar.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await hasSystemMetricsAccess(session.user.email))) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const range = parseRange(new URL(request.url).searchParams.get('range'));
    const status = getSystemMetricsStatus();
    const orionHost = hostOf(process.env.ORION_API_BASE_URL);

    try {
      const data = await withMssqlPool(async (pool) => {
        const [processSeries, inbound, outbound, modules, db, summary, moduleSeries, lifetimes] =
          await Promise.all([
            readProcessSeries(pool, range),
            readRouteRanking(pool, range, 'in'),
            readRouteRanking(pool, range, 'out', 25),
            readModuleShare(pool, range),
            readDbSeries(pool, range),
            readPeriodSummaries(pool, range),
            readModuleSeries(pool, range),
            readProcessLifetimes(pool, range),
          ]);
        // Consumo por usuario: tabla aparte (script 2026-10-06); si falta, no tumba lo demás.
        let users: Awaited<ReturnType<typeof readUserRanking>> = [];
        let activeUsers: Awaited<ReturnType<typeof readActiveUsers>> | null = null;
        let usersTableMissing = false;
        try {
          [users, activeUsers] = await Promise.all([readUserRanking(pool, range), readActiveUsers(pool, range)]);
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
          usersTableMissing = true;
        }
        // Alertas tempranas: también en tabla aparte (script 2026-10-07).
        let alerts: Awaited<ReturnType<typeof readRecentAlerts>> = [];
        let alertsTableMissing = false;
        try {
          alerts = await readRecentAlerts(pool, ALERT_HISTORY_HOURS, 60);
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
          alertsTableMissing = true;
        }
        return {
          alerts,
          alertsTableMissing,
          processSeries,
          inbound,
          outbound,
          modules,
          db,
          summary,
          moduleSeries,
          lifetimes,
          users,
          activeUsers,
          usersTableMissing,
        };
      });

      return NextResponse.json({
        range,
        status,
        tablesMissing: false,
        processSeries: data.processSeries,
        inbound: data.inbound.map((r) => ({ ...r, moduleLabel: moduleLabel(r.module) })),
        outbound: data.outbound.map((r) => ({ ...r, label: outboundHostLabel(r.key, orionHost) })),
        modules: data.modules.map((m) => ({ ...m, label: moduleLabel(m.module) })),
        db: data.db,
        summary: data.summary,
        moduleSeries: data.moduleSeries.map((m) => ({ ...m, label: moduleLabel(m.module) })),
        lifetimes: data.lifetimes,
        users: data.users.map((u) => ({
          ...u,
          topModuleLabel: u.topModule ? moduleLabel(u.topModule) : null,
          modules: u.modules.map((m) => ({ ...m, label: moduleLabel(m.module) })),
        })),
        activeUsers: data.activeUsers,
        usersTableMissing: data.usersTableMissing,
        alerts: data.alerts,
        alertsTableMissing: data.alertsTableMissing,
        alertHistoryHours: ALERT_HISTORY_HOURS,
      });
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      return NextResponse.json({
        range,
        status,
        tablesMissing: true,
        processSeries: [],
        inbound: [],
        outbound: [],
        modules: [],
        db: [],
        summary: null,
        moduleSeries: [],
        lifetimes: [],
        users: [],
        activeUsers: null,
        usersTableMissing: false,
        alerts: [],
        alertsTableMissing: false,
        alertHistoryHours: ALERT_HISTORY_HOURS,
      });
    }
  } catch (error) {
    console.error('Error consultando el Monitor del sistema:', error);
    return NextResponse.json({ error: 'No se pudieron cargar las métricas' }, { status: 500 });
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
