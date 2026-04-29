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
    const process = searchParams.get('process');

    let query = `
      SELECT
        rg.id,
        cr.category,
        rg.[description],
        rg.id_company,
        c.company,
        rg.created_at,
        u.name AS requester,
        sc.status,
        rg.subject_request AS subject,
        pc.process,
        pc.id AS id_process_category,
        rg.resolution,
        rg.date_resolution,
        rg.status_req AS id_status_case,
        uex.name AS executor_final,
        u.email,
        users_proc.[user],
        users_proc.id_assigned_process_category,
        users_cat.users_category

      FROM requests_general rg

      INNER JOIN company c 
        ON c.id_company = rg.id_company

      LEFT JOIN [user] u 
        ON u.id = rg.id_requester

      INNER JOIN process_category_request_general pcrg 
        ON pcrg.id_request_general = rg.id

      LEFT JOIN process_category pc 
        ON pc.id = pcrg.id_process_category

      INNER JOIN category_request cr 
        ON cr.id = pc.id_category_request

      INNER JOIN status_case sc 
        ON sc.id_status_case = rg.status_req

      LEFT JOIN [user] uex 
        ON uex.id = rg.id_executor_final

      OUTER APPLY (
        SELECT 
            STUFF((
                SELECT DISTINCT ', ' + u2.name
                FROM user_process_category_request_general upcrg2
                INNER JOIN [user] u2 
                    ON u2.id = upcrg2.id_user
                WHERE upcrg2.id_process_category = pc.id
                FOR XML PATH(''), TYPE
            ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS [user],

            STUFF((
                SELECT DISTINCT ', ' + CAST(upcrg2.id_user AS VARCHAR)
                FROM user_process_category_request_general upcrg2
                WHERE upcrg2.id_process_category = pc.id
                FOR XML PATH(''), TYPE
            ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS id_assigned_process_category

      ) users_proc

      OUTER APPLY (
        SELECT 
          STUFF((
            SELECT DISTINCT ', ' + u3.name
            FROM user_category_request_general ucrg
            INNER JOIN [user] u3 
              ON u3.id = ucrg.id_user
            WHERE ucrg.id_category = cr.id
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS users_category
      ) users_cat

      WHERE 1=1
    `;

    if (idUser) {
      query += `
        AND (
          EXISTS (
            SELECT 1
            FROM user_process_category_request_general upcrg
            WHERE upcrg.id_process_category = pc.id
            AND upcrg.id_user = @idUser
          )
          OR
          EXISTS (
            SELECT 1
            FROM user_category_request_general ucrg
            WHERE ucrg.id_category = cr.id
            AND ucrg.id_user = @idUser
          )
        )
      `;
    } else {
      return NextResponse.json(
        { error: 'Se requiere el parámetro idUser' },
        { status: 400 }
      );
    }

    if (status && status !== '0') {
      query += ` AND rg.status_req = @status`;
    } else if (!status) {
      query += ` AND rg.status_req = 1`;
    }

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
      query += `
        AND EXISTS (
          SELECT 1
          FROM user_process_category_request_general upcrg
          WHERE upcrg.id_process_category = pc.id
          AND upcrg.id_user = @assigned_to
        )
      `;
    }

    if (process) {
      query += ` AND pc.id = @process`;
    }

    query += ` ORDER BY rg.id DESC`;

    const request = pool.request();

    request.input('idUser', sql.NVarChar, idUser);

    if (status) request.input('status', sql.Int, parseInt(status));
    if (id) request.input('id', sql.Int, parseInt(id));
    if (company) request.input('company', sql.Int, parseInt(company));
    if (date_from) request.input('date_from', sql.DateTime, new Date(date_from));
    if (date_to)
      request.input('date_to', sql.DateTime, new Date(date_to + 'T23:59:59'));
    if (assigned_to) request.input('assigned_to', sql.NVarChar, assigned_to);
    if (process) request.input('process', sql.Int, parseInt(process));

    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });

  } catch (err) {
    console.error('Error en el procesamiento:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
