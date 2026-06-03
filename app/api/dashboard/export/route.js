import sql from 'mssql';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPool } from '../../../../lib/mssqlPool';
import {
  parseViewTasksFilters,
  queryDashboardTasks,
  validateDateRange,
} from '../../../../lib/dashboard/viewTasksQuery';

/**
 * GET /api/dashboard/export?date_from=&date_to=
 * Mismas actividades que el dashboard (task_request_general), con filtro de periodo opcional.
 */
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }

    const filters = parseViewTasksFilters(new URL(req.url).searchParams);
    const dateError = validateDateRange(filters.date_from, filters.date_to);
    if (dateError) {
      return Response.json({ error: dateError }, { status: 400 });
    }

    const pool = await getPool();
    const actividades = await queryDashboardTasks(pool, filters);

    const solReq = pool.request();
    let solQuery = `
        SELECT DISTINCT
          rg.id,
          rg.subject_request,
          rg.description,
          rg.created_at,
          c.company,
          urq.name AS creador,
          scrg.status AS estado
        FROM requests_general rg
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] urq ON urq.id = rg.id_requester
        LEFT JOIN status_case scrg ON scrg.id_status_case = rg.status_req
        WHERE 1=1`;

    if (filters.date_from && filters.date_to) {
      solQuery += `
          AND rg.created_at >= CAST(@date_from AS DATE)
          AND rg.created_at < DATEADD(day, 1, CAST(@date_to AS DATE))`;
      solReq.input('date_from', sql.Date, filters.date_from);
      solReq.input('date_to', sql.Date, filters.date_to);
    }

    solQuery += ` ORDER BY rg.created_at DESC`;
    const solicitudes = await solReq.query(solQuery);

    return Response.json({
      solicitudes: solicitudes.recordset,
      actividades,
      filters_applied: {
        date_from: filters.date_from ?? null,
        date_to: filters.date_to ?? null,
      },
    });
  } catch (err) {
    console.error('Error exportando dashboard:', err);
    return Response.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
