import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idUser = searchParams.get('idUser');
    const status = searchParams.get('status');
    const company = searchParams.get('company');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const assigned_to = searchParams.get('assigned_to');

    console.log('API: idUser recibido:', idUser);

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

    if (idUser) {
      query += ` AND trg.id_assigned = @idUser`;
      console.log('API activities: Agregando filtro por assigned user:', idUser);
    } else {
      console.log('API activities: No se proporcionó idUser, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro idUser para filtrar actividades asignados' },
        { status: 400 }
      );
    }

    if (status && status !== '0') {
      query += ` AND trg.id_status = @status`;
      console.log('API activities: Agregando filtro por status:', status);
    }

    else if (!status) query += ` AND sc.id_status_case = 4`;

    if (company) {
      query += ` AND rg.id_company = @company`;
    }

    if (date_from) {
      query += ` AND rg.created_at >= @date_from`;
    }

    if (date_to) {
      query += ` AND rg.created_at <= @date_to`;
    }

    if (assigned_to) {
      query += ` AND rg.[user] = @assigned_to`;
    }

    const request = pool.request();

    request.input('idUser', sql.NVarChar, idUser);
    
    if (assigned_to) {
      request.input('assignedTo', sql.NVarChar, assigned_to);
    }

    if (status) {
      request.input('status', sql.Int, parseInt(status));
    }

    if (company) {
      request.input('company', sql.Int, parseInt(company));
    }

    if (date_from) {
      request.input('date_from', sql.DateTime, new Date(date_from));
    }

    if (date_to) {
      request.input('date_to', sql.DateTime, new Date(date_to + 'T23:59:59'));
    }

    if (assigned_to) {
      request.input('assigned_to', sql.NVarChar, assigned_to);
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
