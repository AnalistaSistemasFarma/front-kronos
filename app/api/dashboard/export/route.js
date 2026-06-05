import { requireDashboardAdminApi } from '../../../../lib/dashboard/dashboardAccess';
import { getPool } from '../../../../lib/mssqlPool';
import {
  queryVwRequestsGeneral,
  queryVwTareasSolicitudesAll,
} from '../../../../lib/dashboard/viewTasksQuery';

/**
 * GET /api/dashboard/export
 * Misma lógica que main: vw_requests_general + vw_tareas_solicitudes (sin filtro de periodo).
 */
export async function GET() {
  try {
    const auth = await requireDashboardAdminApi();
    if (!auth.ok) return auth.response;

    const pool = await getPool();

    const [solicitudes, actividades] = await Promise.all([
      queryVwRequestsGeneral(pool),
      queryVwTareasSolicitudesAll(pool),
    ]);

    return Response.json({
      solicitudes,
      actividades,
      source: {
        solicitudes: 'vw_requests_general',
        actividades: 'vw_tareas_solicitudes',
      },
    });
  } catch (err) {
    console.error('Error exportando dashboard:', err);
    return Response.json(
      {
        error: 'Error al obtener datos',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
