import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const subcategoryId = searchParams.get('subcategory_id');

    let query = `
      SELECT 
        a.id_activity, 
        a.activity, 
        a.id_subcategory
      FROM activity a
    `;

    if (subcategoryId) {
      query += ` WHERE a.id_subcategory = @subcategory_id`;
    }

    query += ` ORDER BY a.activity ASC`;

    const request = pool.request();
    if (subcategoryId) {
      request.input('subcategory_id', sql.Int, subcategoryId);
    }

    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}