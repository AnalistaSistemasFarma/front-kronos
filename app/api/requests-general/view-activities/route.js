import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID de solicitud es requerido' }, { status: 400 });
    }

    const pool = await sql.connect(sqlConfig);

    const query = `
        SELECT 
            trg.id, trg.id_task, tpc.task ,rg.id as id_request_general, rg.description, rg.subject_request, rg.id_company, c.company ,rg.created_at, 
            rg.id_requester, urq.name as name_requester ,rg.status_req, trg.id_status ,sc.status as status_task, u.name as assigned, pc.process, cr.category,
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
        WHERE trg.id = @id
    `;

    const request = pool.request();
    request.input('id', sql.Int, id);

    const result = await request.query(query);

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
