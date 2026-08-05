import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import {
  hasRequestDashboardAccess,
  resolveUserIdByEmail,
} from '../../../../lib/request-general/dashboardAccess';

/**
 * Dashboard del solicitante: sus solicitudes (procesos) y las actividades de esas solicitudes.
 * GET /api/requests-general/dashboard-solicitante
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const allowed = await hasRequestDashboardAccess(session.user.email, 'solicitante');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Sin permiso para el Dashboard solicitudes' },
        { status: 403 }
      );
    }

    const userId = await resolveUserIdByEmail(session.user.email);
    if (!userId) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    const data = await withMssqlPool(async (pool) => {
      const requestsResult = await pool
        .request()
        .input('idUser', sql.NVarChar(255), userId)
        .query(`
          SELECT
            rg.id,
            rg.subject_request AS subject,
            rg.[description],
            rg.created_at,
            rg.date_resolution,
            rg.status_req AS id_status,
            sc.status,
            c.company,
            cr.category,
            pc.process,
            up_user.name AS assigned_user,
            uex.name AS executor_final
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
          INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          LEFT JOIN [user] uex ON uex.id = rg.id_executor_final
          OUTER APPLY (
            SELECT TOP 1 u2.name
            FROM user_process_category_request_general upcrg
            INNER JOIN [user] u2 ON u2.id = upcrg.id_user
            WHERE upcrg.id_process_category = pc.id
          ) up_user
          WHERE rg.id_requester = @idUser
          ORDER BY rg.id DESC
        `);

      const activitiesResult = await pool
        .request()
        .input('idUser', sql.NVarChar(255), userId)
        .query(`
          SELECT
            trg.id,
            trg.id_request_general,
            tpc.task,
            trg.id_status,
            sc.status AS status_task,
            u.name AS assigned,
            rg.subject_request AS subject,
            c.company,
            pc.process,
            cr.category,
            trg.start_date,
            trg.date_resolution
          FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          INNER JOIN requests_general rg ON rg.id = trg.id_request_general
          INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
          INNER JOIN company c ON c.id_company = rg.id_company
          LEFT JOIN [user] u ON u.id = trg.id_assigned
          LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE rg.id_requester = @idUser
          ORDER BY trg.id DESC
        `);

      return {
        requests: requestsResult.recordset,
        activities: activitiesResult.recordset,
      };
    });

    const requestCounts = countByStatus(data.requests.map((r) => r.status));
    const activityCounts = countByStatus(data.activities.map((a) => a.status_task));

    return NextResponse.json({
      role: 'solicitante',
      userId,
      requests: data.requests,
      activities: data.activities,
      counts: {
        requests: requestCounts,
        activities: activityCounts,
      },
    });
  } catch (error) {
    console.error('Error dashboard-solicitante:', error);
    return NextResponse.json(
      { error: 'Error al cargar el dashboard del solicitante' },
      { status: 500 }
    );
  }
}

function countByStatus(statuses: Array<string | null | undefined>) {
  const counts = {
    total: statuses.length,
    abierto: 0,
    enProgreso: 0,
    resuelto: 0,
    cancelado: 0,
    otros: 0,
  };

  for (const raw of statuses) {
    const s = String(raw ?? '').toLowerCase();
    if (s.includes('abiert') || s.includes('sin empezar')) counts.abierto += 1;
    else if (s.includes('progreso') || s.includes('proceso')) counts.enProgreso += 1;
    else if (s.includes('resuelt') || s.includes('complet')) counts.resuelto += 1;
    else if (s.includes('cancel') || s.includes('cerrad')) counts.cancelado += 1;
    else counts.otros += 1;
  }

  return counts;
}
