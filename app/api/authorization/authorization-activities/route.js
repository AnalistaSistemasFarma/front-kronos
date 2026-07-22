import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idUser = searchParams.get('idUser');
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const company = searchParams.get('company');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const assigned_to = searchParams.get('assigned_to');

    console.log('API: idUser recibido:', idUser);

    if (!idUser) {
      console.log('API activities: No se proporcionó idUser, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro idUser para filtrar actividades asignados' },
        { status: 400 }
      );
    }

    // Enrutamiento por tipo + departamento (no por id_assigned, que puede ser NULL en tareas
    // de autorización):
    //  - Solo tareas de autorización cuyo type_authorization esté asignado al usuario
    //    (user_types_authorization).
    //  - El CREADOR de la solicitud (rg.id_requester) debe compartir al menos un departamento
    //    con el AUTORIZADOR (@idUser).
    let query = `
        SELECT
            trg.id as id_task_request, trg.id_request_general, trg.id_status, tpc.task,
            sc.status as status_task, u.name as assigned_task,
            tp.type_authorization, rg.subject_request, rg.description, rg.id_company, c.company,
            rg.created_at, rg.id_requester as id_creator_request, ucr.name as creator_request
        FROM
            task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
        LEFT JOIN [user] u ON u.id = trg.id_assigned
        INNER JOIN types_authorization tp ON tp.id = tpc.type_authorization
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] ucr ON ucr.id = rg.id_requester
        WHERE tpc.is_authorization = 1
          AND tpc.type_authorization IS NOT NULL
          AND tpc.type_authorization IN (
            SELECT ut.type_authorization
            FROM user_types_authorization ut
            WHERE ut.id_user = @idUser
          )
		  AND c.id_company IN (
            SELECT cu.id_company
            FROM company_user cu
            INNER JOIN subprocess_user_company suc ON suc.id_company_user = cu.id_company_user
            WHERE cu.id_user = @idUser
          )
          AND EXISTS (
            SELECT 1
            FROM department_user du_c
            INNER JOIN department_user du_a ON du_a.id_department = du_c.id_department
            WHERE du_c.id_user = rg.id_requester
              AND du_a.id_user = @idUser
          )
    `;

    if (status && status !== '0') {
      query += ` AND trg.id_status = @status`;
      console.log('API activities: Agregando filtro por status:', status);
    }

    else if (!status) query += ` AND sc.id_status_case = 4`;

    if (id) {
      query += ` AND rg.id = @id`;
    }

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

    if (id) {
      request.input('id', sql.Int, parseInt(id));
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
