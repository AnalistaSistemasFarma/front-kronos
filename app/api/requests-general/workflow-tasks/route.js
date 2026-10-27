import { sql, getPool } from '../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await getPool();

    const { searchParams } = new URL(req.url);
    const idProcess = searchParams.get('id_process');

    console.log('API workflow-tasks: id_process recibido:', idProcess);

    if (!idProcess) {
      return NextResponse.json(
        { error: 'Se requiere el parámetro id_process' },
        { status: 400 }
      );
    }

    const query = `
      SELECT
        tpc.id,
        tpc.task,
        tpc.active,
        tpc.cost,
        tpc.cost_center,
        tpc.is_sequential,
        tpc.display_order,
        tpc.is_authorization,
        tpc.type_authorization,
        taut.type_authorization as type_authorization_label,
        tpc.id_linked_process,
        lp.process as linked_process_label,
        tpc.closes_request,
        tpc.task_kind,
        (SELECT TOP 1 x.action_key FROM dbo.task_sap_action x
          WHERE x.id_task = tpc.id AND x.trigger_event IN (N'on_execute', N'on_reject', N'on_quote') AND x.active = 1
            AND tpc.task_kind = N'sap_executor'
          ORDER BY x.display_order) AS sap_action_key,
        (SELECT TOP 1 x.trigger_event FROM dbo.task_sap_action x
          WHERE x.id_task = tpc.id AND x.trigger_event IN (N'on_execute', N'on_reject', N'on_quote') AND x.active = 1
            AND tpc.task_kind = N'sap_executor'
          ORDER BY x.display_order) AS sap_trigger,
        u.name as assigned_user,
		    u.id as id_assigned_user
      FROM task_process_category tpc
      LEFT JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
      LEFT JOIN [user] u ON u.id = utrg.id_user
      LEFT JOIN types_authorization taut ON taut.id = tpc.type_authorization
      LEFT JOIN process_category lp ON lp.id = tpc.id_linked_process
      WHERE tpc.active = 1 AND tpc.id_process_category = @idProcess
      ORDER BY tpc.display_order, tpc.id
    `;

    const request = pool.request();
    request.input('idProcess', sql.Int, parseInt(idProcess));

    console.log('API workflow-tasks: Ejecutando consulta');
    const result = await request.query(query);
    console.log('API workflow-tasks: Resultados obtenidos:', result.recordset.length, 'registros');

    // Condiciones por opción de cada tarea (M:N). Se adjuntan como `conditions: number[]`.
    const condResult = await pool.request()
      .input('idProcess', sql.Int, parseInt(idProcess))
      .query(`
        SELECT tco.id_task, tco.id_option
        FROM task_condition_option tco
        INNER JOIN task_process_category tpc ON tpc.id = tco.id_task
        WHERE tpc.active = 1 AND tpc.id_process_category = @idProcess
      `);

    const condByTask = {};
    for (const row of condResult.recordset) {
      (condByTask[row.id_task] ||= []).push(row.id_option);
    }

    const tasksWithConditions = result.recordset.map((t) => ({
      ...t,
      conditions: condByTask[t.id] || [],
    }));

    return NextResponse.json(tasksWithConditions, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
