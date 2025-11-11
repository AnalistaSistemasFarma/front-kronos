import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const query = `
      SELECT 
        c.id_category, 
        c.category
      FROM category c
      ORDER BY c.category ASC
    `;

    const request = pool.request();
    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}