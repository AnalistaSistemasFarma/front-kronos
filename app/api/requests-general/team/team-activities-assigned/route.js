import sql from 'mssql';
import sqlConfig from '../../../../../dbconfig';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id != null ? String(session.user.id) : '';
    if (!userId) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const member = searchParams.get('member');
    const status = searchParams.get('status');

    console.log('API: member recibido:', member);

    let query = `
        SELECT trg.id, trg.id_task, tpc.task ,rg.id as id_request_general, rg.description, rg.subject_request, rg.id_company, c.company ,rg.created_at, 
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
          INNER JOIN [user] urq ON urq.id = rg.id_requester
          INNER JOIN company c ON c.id_company = rg.id_company
		      LEFT JOIN [user] uex ON uex.id = trg.id_executor_final
        WHERE 1=1
    `;

    if (member) {
      query += ` AND trg.id_assigned = @member`;
      console.log('API activities: Agregando filtro por assigned user:', member);
    } else {
      console.log('API activities: No se proporcionó member, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro member para filtrar actividades asignados' },
        { status: 400 }
      );
    }

    if (status && status !== '0') {
      query += ` AND trg.id_status = @status`;
      console.log('API activities: Agregando filtro por status:', status);
    }

    else if (!status) query += ` AND sc.id_status_case = 4`;

    const request = pool.request();

    request.input('member', sql.NVarChar, member);
    
    if (status) {
      request.input('status', sql.Int, parseInt(status));
    }

    console.log('API activities: Ejecutando consulta:', query);
    query += ` ORDER BY trg.id DESC`;
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
