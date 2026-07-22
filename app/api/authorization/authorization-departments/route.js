import { sql, getPool } from '../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    const pool = await getPool();

    let queryCategories = `
      SELECT 
		d.department
      FROM department_user du
      INNER JOIN department d
        ON d.id_department = du.id_department
      INNER JOIN [user] u
		ON u.id = du.id_user
    `;

    const categoriesRequest = pool.request();

    if (userId) {
      // id_user es el cuid (string) de [user].id; no convertir a Number.
      queryCategories += ` WHERE du.id_user = @userId`;
      categoriesRequest.input('userId', sql.NVarChar(1000), userId);
    }

    queryCategories += ` ORDER BY d.department`;

    const [categoriesRes] =
      await Promise.all([
        categoriesRequest.query(queryCategories),
      ]);


    return NextResponse.json(
      {
        departments: categoriesRes.recordset,
      },
      { status: 200 }
    );

  } catch (err) {

    console.error('Error en endpoint:', err);

    return NextResponse.json(
      {
        error: 'Error procesando la solicitud',
        details: err.message,
      },
      { status: 500 }
    );
  }
}
