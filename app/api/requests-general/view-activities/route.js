import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const TASK_SELECT = `
        SELECT 
            trg.id, trg.id_task, tpc.task ,rg.id as id_request_general, rg.description, rg.subject_request, rg.id_company, c.company ,rg.created_at, 
            rg.id_requester, urq.name as name_requester, urq.email as requester_email, rg.status_req, trg.id_status ,sc.status as status_task, u.name as assigned, pc.process, cr.category,
            trg.start_date, trg.resolution, trg.date_resolution, uex.name as executor_final
        FROM task_request_general trg
            INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
            LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
            LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
            LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
            LEFT JOIN category_request cr ON cr.id = pc.id_category_request
            INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
            INNER JOIN [user] u ON u.id = trg.id_assigned
            LEFT JOIN [user] urq ON urq.id = rg.id_requester
            INNER JOIN company c ON c.id_company = rg.id_company
			      LEFT JOIN [user] uex ON uex.id = trg.id_executor_final
`;

/**
 * Resuelve la tarea de firma abierta del usuario para una solicitud (y PDF opcional).
 * Preferencia: tarea Orion pendiente de firma → cualquier tarea abierta asignada → auth recién cerrada.
 */
async function resolveTaskIdForRequest(pool, { requestId, fileId, userId }) {
  const fileMarker = fileId ? `[orionFile:${fileId}]` : null;

  const openSigner = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_user', sql.NVarChar(255), userId)
    .input('fileMarker', sql.NVarChar(200), fileMarker)
    .query(`
      SELECT TOP 1 trg.id
      FROM task_request_general trg
      WHERE trg.id_request_general = @id_request
        AND trg.id_assigned = @id_user
        AND trg.id_status NOT IN (2, 3)
        AND (
          @fileMarker IS NULL
          OR CHARINDEX(@fileMarker, ISNULL(trg.resolution, N'')) > 0
        )
        AND (
          CHARINDEX(N'[orionFile:', ISNULL(trg.resolution, N'')) > 0
          OR CHARINDEX(N'Pendiente de firma', ISNULL(trg.resolution, N'')) > 0
        )
        AND CHARINDEX(N'[orionAuth]', ISNULL(trg.resolution, N'')) = 0
      ORDER BY trg.id DESC
    `);
  if (openSigner.recordset[0]?.id) return openSigner.recordset[0].id;

  const anyOpen = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_user', sql.NVarChar(255), userId)
    .query(`
      SELECT TOP 1 trg.id
      FROM task_request_general trg
      WHERE trg.id_request_general = @id_request
        AND trg.id_assigned = @id_user
        AND trg.id_status NOT IN (2, 3)
        AND CHARINDEX(N'[orionAuth]', ISNULL(trg.resolution, N'')) = 0
      ORDER BY trg.id DESC
    `);
  if (anyOpen.recordset[0]?.id) return anyOpen.recordset[0].id;

  // No devolver auths/tareas ya cerradas: el firmante debe aterrizar en una tarea abierta.
  return null;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const requestIdRaw = searchParams.get('requestId');
    const fileId = searchParams.get('fileId')?.trim() || null;
    const requestId = requestIdRaw ? Number(requestIdRaw) : null;

    if (!id && !(requestId && Number.isInteger(requestId) && requestId > 0)) {
      return NextResponse.json(
        { error: 'ID de tarea o requestId es requerido' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    let taskId = id ? Number(id) : null;

    if (!taskId && requestId) {
      const session = await getServerSession(authOptions);
      const userId = session?.user?.id;
      if (!userId) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
      }
      taskId = await resolveTaskIdForRequest(pool, {
        requestId,
        fileId,
        userId: String(userId),
      });
      if (!taskId) {
        return NextResponse.json(
          { error: 'No hay tarea de firma disponible para esta solicitud' },
          { status: 404 }
        );
      }
    }

    const request = pool.request();
    request.input('id', sql.Int, taskId);

    const result = await request.query(`${TASK_SELECT} WHERE trg.id = @id`);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0], { status: 200 });
  } catch (err) {
    console.error('Error al obtener la solicitud:', err);
    return NextResponse.json(
      { error: 'Error al obtener la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
