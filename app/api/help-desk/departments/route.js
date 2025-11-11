import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const query = `
      SELECT 
        d.id_department, 
        d.department
      FROM department d
      ORDER BY d.department ASC
    `;

    const request = pool.request();
    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (error) {
    console.error('Error fetching departments:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}