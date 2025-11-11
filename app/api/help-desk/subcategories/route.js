import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('category_id');

    console.log('API Subcategories - categoryId from params:', categoryId);

    let query = `
      SELECT 
        s.id_subcategory, 
        s.subcategory, 
        s.id_category
      FROM subcategory s
    `;

    if (categoryId) {
      query += ` WHERE s.id_category = @category_id`;
    }

    query += ` ORDER BY s.subcategory ASC`;

    console.log('API Subcategories - query:', query);

    const request = pool.request();
    if (categoryId) {
      request.input('category_id', sql.Int, categoryId);
    }

    const result = await request.query(query);

    console.log('API Subcategories - found subcategories:', result.recordset.length, 'items');

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}