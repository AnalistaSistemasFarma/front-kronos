import sql from 'mssql';
import sqlConfig from '../../../dbconfig';
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

    console.log('API requests-general: idUser recibido:', idUser);

    let query = `
      SELECT
        rg.id, cr.category as category, up.name as [user], rg.[description], rg.id_company, c.company ,rg.created_at, u.name as 'requester', sc.status as [status], rg.subject_request as [subject], pc.process, cr.id as id_category
      FROM requests_general rg
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] u ON u.id = rg.id_requester
        LEFT JOIN process_category pc ON pc.id = rg.id_process_category
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN [user] up ON up.id = pc.assigned
        INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
      WHERE 1=1
    `;

    if (idUser) {
      query += ` AND rg.id_requester = @idUser`;
      console.log('API requests-general: Agregando filtro por idRequester:', idUser);
    } else {
      console.log('API requests-general: No se proporcionó idUser, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro idUser para filtrar tickets' },
        { status: 400 }
      );
    }

    if (status) {
      query += ` AND rg.[status] = @status`;
      console.log('API requests-general: Agregando filtro por status:', status);
    }

    if (company) {
      query += ` AND rg.id_company = @company`;
      console.log('API requests-general: Agregando filtro por company:', company);
    }

    if (date_from) {
      query += ` AND rg.created_at >= @date_from`;
      console.log('API requests-general: Agregando filtro por date_from:', date_from);
    }

    if (date_to) {
      query += ` AND rg.created_at <= @date_to`;
      console.log('API requests-general: Agregando filtro por date_to:', date_to);
    }

    if (assigned_to) {
      query += ` AND rg.[user] = @assigned_to`;
      console.log('API requests-general: Agregando filtro por assigned_to:', assigned_to);
    }

    const request = pool.request();
    if (idUser) {
      request.input('idUser', sql.NVarChar, idUser);
      console.log('API requests-general: Usando sql.NVarChar para idUser');
    }
    if (assigned_to) {
      request.input('assignedTo', sql.NVarChar, assigned_to);
      console.log('API requests-general: Usando sql.NVarChar para assignedTo');
    }

    if (status) {
      request.input('status', sql.NVarChar, status);
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
