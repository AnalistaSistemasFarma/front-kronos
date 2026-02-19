import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

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
        u.name as assigned_user,
		    u.id as id_assigned_user
      FROM task_process_category tpc
      LEFT JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
      LEFT JOIN [user] u ON u.id = utrg.id_user
      WHERE tpc.id_process_category = @idProcess
      ORDER BY tpc.id
    `;

    const request = pool.request();
    request.input('idProcess', sql.Int, parseInt(idProcess));

    console.log('API workflow-tasks: Ejecutando consulta');
    const result = await request.query(query);
    console.log('API workflow-tasks: Resultados obtenidos:', result.recordset.length, 'registros');

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
