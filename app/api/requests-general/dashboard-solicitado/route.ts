import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import {
  hasRequestDashboardAccess,
  resolveUserIdByEmail,
} from '../../../../lib/request-general/dashboardAccess';

/**
 * Dashboard del solicitado: solicitudes donde gestiona el proceso/categoría
 * y actividades asignadas directamente a él.
 * GET /api/requests-general/dashboard-solicitado
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const allowed = await hasRequestDashboardAccess(session.user.email, 'solicitado');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Sin permiso para el Dashboard personal' },
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
            u.name AS requester,
            uex.name AS executor_final
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
          INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          LEFT JOIN [user] u ON u.id = rg.id_requester
          LEFT JOIN [user] uex ON uex.id = rg.id_executor_final
          WHERE (
            EXISTS (
              SELECT 1
              FROM user_process_category_request_general upcrg
              WHERE upcrg.id_process_category = pc.id
                AND upcrg.id_user = @idUser
            )
            OR EXISTS (
              SELECT 1
              FROM user_category_request_general ucrg
              WHERE ucrg.id_category = cr.id
                AND ucrg.id_user = @idUser
            )
          )
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
            urq.name AS requester,
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
          INNER JOIN [user] urq ON urq.id = rg.id_requester
          LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE trg.id_assigned = @idUser
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
      role: 'solicitado',
      userId,
      requests: data.requests,
      activities: data.activities,
      counts: {
        requests: requestCounts,
        activities: activityCounts,
      },
    });
  } catch (error) {
    console.error('Error dashboard-solicitado:', error);
    return NextResponse.json(
      { error: 'Error al cargar el dashboard del solicitado' },
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
