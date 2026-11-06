import sql from 'mssql';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPurchasesAccess } from '../../../../lib/purchases/access';
import { prisma } from '../../../../lib/prisma';
import { buildTimeline, type ExecutionRow, type HumanTaskRow } from '../../../../lib/workflow-sap/history';

/**
 * Historial de ejecucion de una solicitud: la corriente completa del proceso
 * (pasos humanos + ejecuciones en SAP + reintentos + cambios externos).
 * GET ?requestId=N -> { events: TimelineEvent[] }.
 *
 * Acceso: el solicitante, quien tenga o haya tenido una tarea de la solicitud, o
 * quien lea Compras en la empresa de la solicitud (mismo criterio del detalle).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const requestId = Number(new URL(request.url).searchParams.get('requestId'));
    if (!requestId) return NextResponse.json({ error: 'Falta requestId' }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const pool = await sql.connect(sqlConfig);
    const base = await pool
      .request()
      .input('req', sql.Int, requestId)
      .input('u', sql.NVarChar(50), user.id)
      .query(`
        SELECT rg.id_company,
          CASE WHEN rg.id_requester = @u OR EXISTS (
            SELECT 1 FROM task_request_general t
            WHERE t.id_request_general = rg.id AND (t.id_assigned = @u OR t.id_executor_final = @u)
          ) THEN 1 ELSE 0 END AS involved
        FROM requests_general rg WHERE rg.id = @req;`);
    const row = base.recordset[0];
    if (!row) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });

    const canRead =
      Number(row.involved) === 1 ||
      (await getPurchasesAccess(session.user.email)).some((a) => a.idCompany === row.id_company && a.canRead);
    if (!canRead) return NextResponse.json({ error: 'Sin acceso al historial de esta solicitud' }, { status: 403 });

    const [tasks, execs] = await Promise.all([
      pool.request().input('req', sql.Int, requestId).query<HumanTaskRow>(`
        SELECT trg.id, tpc.task, tpc.is_authorization, trg.id_status, sc.status AS status_label,
               ua.name AS assigned_name, ue.name AS executor_name, trg.resolution,
               trg.start_date, COALESCE(trg.date_resolution, trg.end_date) AS date_resolution
        FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
        LEFT JOIN [user] ua ON ua.id = trg.id_assigned
        LEFT JOIN [user] ue ON ue.id = trg.id_executor_final
        WHERE trg.id_request_general = @req
          AND ISNULL(tpc.task_kind, N'normal') <> N'sap_executor';`),
      pool.request().input('req', sql.Int, requestId).query<ExecutionRow>(`
        SELECT id, step_kind, step_name, action_key, trigger_event, triggered_by, status, attempt,
               sap_entity, sap_doc_entry, sap_doc_num, request_summary, response_summary, error,
               started_at, finished_at
        FROM dbo.workflow_execution_log
        WHERE id_request_general = @req
        ORDER BY started_at, id;`),
    ]);

    return NextResponse.json(
      { events: buildTimeline(tasks.recordset, execs.recordset) },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error consultando el historial de ejecución:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
