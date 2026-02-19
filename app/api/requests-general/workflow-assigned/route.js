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
    const category = searchParams.get('category');
    const process = searchParams.get('process');
    const active = searchParams.get('active');

    console.log('API: idUser recibido:', idUser);

    let query = `
        SELECT 
            pc.id ,cr.id as id_category, cr.category, pc.process, pc.description, pc.active, pc.id_status as id_status_process, scpc.status as status_process, 
            ucr.name as assigned_category, upc.id as id_assigned_process_category ,upc.name as assigned_process_category, c.company
        FROM process_category pc
        LEFT JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN status_case scpc ON scpc.id_status_case = pc.id_status
        LEFT JOIN user_category_request_general ucrg ON ucrg.id_category = cr.id
        LEFT JOIN [user] ucr ON ucr.id = ucrg.id_user
        LEFT JOIN user_process_category_request_general upcrg ON upcrg.id_process_category = pc.id
        LEFT JOIN [user] upc ON upc.id = upcrg.id_user
        INNER JOIN company_category_request ccr ON ccr.id_category_request = cr.id
        INNER JOIN company c ON c.id_company =  ccr.id_company
        WHERE 1=1
    `;

    if (idUser) {
      query += ` AND (ucrg.id_user = @idUser OR upcrg.id_user = @idUser)`;
      console.log('API activities: Agregando filtro por assigned user:', idUser);
    } else {
      console.log('API activities: No se proporcionó idUser, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro idUser para filtrar actividades asignados' },
        { status: 400 }
      );
    }

    if (status && status !== '0') {
      query += ` AND pc.id_status = @status`;
      console.log('API activities: Agregando filtro por status:', status);
    }

    if (company) {
      query += ` AND c.id_company = @company`;
    }

    if (category) {
      query += ` AND cr.id = @category`;
    }

    if (process) {
      query += ` AND pc.id = @process`;
    }

    if (active) {
      query += ` AND pc.active = @active`;
    }

    const request = pool.request();

    request.input('idUser', sql.NVarChar, idUser);
    
    if (active) {
      request.input('active', sql.TinyInt, active);
    }

    if (status) {
      request.input('status', sql.Int, parseInt(status));
    }

    if (company) {
      request.input('company', sql.Int, parseInt(company));
    }

    if (category) {
      request.input('category', sql.Int, parseInt(category));
    }

    if (process) {
      request.input('process', sql.Int, parseInt(process));
    }

    console.log('API activities: Ejecutando consulta:', query);
    query += ` ORDER BY cr.category`;
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
