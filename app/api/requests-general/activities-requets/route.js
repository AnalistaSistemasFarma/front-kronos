import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    let query = `
        SELECT
          rg.id as id_request_general,
          trg.id,
          tpc.task,
          trg.id_status,
          sc.status as status_task,
          u.name as assigned
        FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
              LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
          LEFT JOIN [user] u ON u.id = trg.id_assigned
          INNER JOIN [user] urq ON urq.id = rg.id_requester
          INNER JOIN company c ON c.id_company = rg.id_company
              LEFT JOIN [user] uex ON uex.id = trg.id_executor_final
        WHERE 1=1
    `;

    const request = pool.request();

    if (id) {
      query += ` AND rg.id = @id`;
      request.input('id', sql.Int, parseInt(id));
    }

    query += ` ORDER BY rg.id, trg.id ASC`;
    const result = await request.query(query);
    console.log(
      'API activities: Resultados obtenidos:',
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
