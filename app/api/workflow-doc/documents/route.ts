import sql from 'mssql';
import { NextRequest, NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig.js';
import { canEmitTask, canReadRequestDocuments } from '../../../../lib/workflow-doc/access';
import { listGeneratedDocuments } from '../../../../lib/workflow-doc/engine';
import { NO_STORE, fail, sessionEmail } from '../_shared';

/**
 * GET ?id_request=N -> tareas «Plantilla de documento» de la solicitud (modo, motor, estado,
 * si la persona puede emitir) y sus documentos generados (versiones).
 */
export async function GET(request: NextRequest) {
  try {
    const email = await sessionEmail();
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const idRequest = Number(new URL(request.url).searchParams.get('id_request'));
    if (!Number.isInteger(idRequest) || idRequest <= 0) return NextResponse.json({ error: 'Falta id_request' }, { status: 400 });
    if (!(await canReadRequestDocuments(email, idRequest))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('req', sql.Int, idRequest).query<{
      id: number;
      id_task: number;
      id_status: number;
      id_assigned: string | null;
      resolution: string | null;
      task: string;
      mode: string | null;
      engine: string | null;
      output: string | null;
    }>(`
      SELECT trg.id, trg.id_task, trg.id_status, trg.id_assigned, trg.resolution, tpc.task, d.mode, d.engine, d.output
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      LEFT JOIN dbo.task_doc_template d ON d.id_task = tpc.id
      WHERE trg.id_request_general = @req AND tpc.task_kind = N'doc_template'
      ORDER BY tpc.display_order, trg.id;`);
    const tasks = await Promise.all(
      r.recordset.map(async (t) => ({
        id: t.id,
        idTask: t.id_task,
        task: t.task,
        status: t.id_status,
        mode: t.mode ?? 'auto',
        engine: t.engine ?? 'editor',
        output: t.output ?? 'pdf',
        error: t.resolution?.startsWith('[doc:error]') ? t.resolution.slice('[doc:error]'.length).trim() : null,
        canEmit: t.id_status !== 2 && t.id_status !== 3 ? await canEmitTask(email, { id_assigned: t.id_assigned, id_request_general: idRequest }) : false,
      }))
    );
    const documents = await listGeneratedDocuments(idRequest);
    return NextResponse.json({ tasks, documents }, { headers: NO_STORE });
  } catch (e) {
    return fail(e, 'documents');
  }
}
