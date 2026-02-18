import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idReq = searchParams.get('idReq');

    console.log('API view-tasks_request-general: idReq recibido:', idReq);

    let query = `
        SELECT 
          trg.id, trg.id_request_general, trg.id_task, tpc.task, trg.id_status, sc.status, trg.id_assigned, u.name, trg.start_date, trg.end_date, trg.resolution, trg.date_resolution, rg.description, 
          rg.subject_request, rg.id_company, c.company, rg.created_at, rg.id_requester, urg.name as name_requester, rg.status_req
        FROM task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        INNER JOIN [user] urg ON urg.id = rg.id_requester
        INNER JOIN company c ON c.id_company = rg.id_company
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
		    INNER JOIN status_case scrg ON scrg.id_status_case = rg.status_req
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        INNER JOIN [user] u ON u.id = trg.id_assigned
        WHERE 1=1
    `;

    if (idReq) {
      query += ` AND trg.id_request_general = @idReq`;
    } else {
      console.log('API view-tasks_request-general: No se proporcionó idReq, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro idReq para filtrar tareas' },
        { status: 400 }
      );
    }

    query += ` ORDER BY trg.id DESC`;

    const request = pool.request();
    if (idReq) {
      request.input('idReq', sql.Int, idReq);
    }

    console.log('API requests-general: Ejecutando consulta:', query);
    const result = await request.query(query);
    console.log(
      'API requests-general: Resultados obtenidos:',
      result.recordset.length,
      'registros'
    );

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
