import { sql, getPool } from '../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';
import { resolveSessionUser } from '@/lib/chat/http';

export async function GET() {
  try {
    // El usuario sale SIEMPRE de la sesión del servidor. Antes se recibía `userId` por
    // query y, sin él, se devolvían los departamentos de todos los usuarios.
    const sessionUser = await resolveSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const pool = await getPool();

    const queryCategories = `
      SELECT
        d.department
      FROM department_user du
      INNER JOIN department d
        ON d.id_department = du.id_department
      WHERE du.id_user = @userId
      ORDER BY d.department
    `;

    const categoriesRequest = pool.request();
    // id_user es el cuid (string) de [user].id; no convertir a Number.
    categoriesRequest.input('userId', sql.NVarChar(1000), sessionUser.id);

    const categoriesRes = await categoriesRequest.query(queryCategories);

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
      },
      { status: 500 }
    );
  }
}
