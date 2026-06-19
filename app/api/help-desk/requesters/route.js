import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';
import {
  REQUESTER_JOINS,
  REQUESTER_KEY_SQL,
  REQUESTER_NAME_SQL,
} from '../../../../lib/help-desk/requesterSql';

/**
 * GET /api/help-desk/requesters
 * Personas que han creado al menos un caso (no todos los usuarios del sistema).
 * Query: ?search= (opcional, filtra por nombre o correo)
 */
export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() ?? '';

    let query = `
      SELECT
        ${REQUESTER_KEY_SQL} AS id,
        ${REQUESTER_NAME_SQL} AS name,
        (
          SELECT TOP 1 ux.email
          FROM [user] ux
          WHERE LTRIM(RTRIM(ux.name)) = LTRIM(RTRIM(${REQUESTER_NAME_SQL}))
            AND ux.email IS NOT NULL
            AND LTRIM(RTRIM(ux.email)) != ''
          ORDER BY CASE WHEN ux.isActive = 1 THEN 0 ELSE 1 END, ux.name
        ) AS email,
        COUNT(DISTINCT c.id_case) AS case_count
      FROM [case] c
      ${REQUESTER_JOINS}
      WHERE c.requester IS NOT NULL
        AND ${REQUESTER_NAME_SQL} IS NOT NULL
    `;

    if (search) {
      query += `
        AND (
          ${REQUESTER_NAME_SQL} LIKE '%' + @search + '%'
          OR EXISTS (
            SELECT 1 FROM [user] ux
            WHERE (
              ux.email LIKE '%' + @search + '%'
              OR ux.name LIKE '%' + @search + '%'
            )
            AND LTRIM(RTRIM(ux.name)) = LTRIM(RTRIM(${REQUESTER_NAME_SQL}))
          )
        )
      `;
    }

    query += `
      GROUP BY
        ${REQUESTER_KEY_SQL},
        ${REQUESTER_NAME_SQL}
      ORDER BY ${REQUESTER_NAME_SQL} ASC
    `;

    const request = pool.request();
    if (search) {
      request.input('search', sql.NVarChar, search);
    }

    const result = await request.query(query);
    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error al obtener solicitantes:', err);
    return NextResponse.json(
      {
        error: 'No se pudieron obtener los solicitantes',
        technical: err.message,
      },
      { status: 500 }
    );
  }
}
