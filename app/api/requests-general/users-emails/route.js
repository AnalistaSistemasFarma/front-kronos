import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

/**
 * GET /api/requests-general/users-emails
 * Obtiene la lista de usuarios activos con nombre y correo electrónico
 * para ser utilizado en el selector de correos
 */
export async function GET(req) {
  const startTime = Date.now();
  let session = null;
  const ipAddress =
    req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  try {
    session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      console.log(`[USERS-EMAILS] Acceso no autorizado desde IP: ${ipAddress}`);
      return NextResponse.json(
        {
          success: false,
          error: 'No autorizado',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';

    let query = `
      SELECT id, name, email
      FROM [user]
      WHERE isActive = 1
        AND email IS NOT NULL
        AND email != ''
    `;

    if (search && search.trim() !== '') {
      query += ` AND (name LIKE @search OR email LIKE @search)`;
    }

    query += ` ORDER BY name ASC`;

    const result = await withMssqlPool(async (pool) => {
      const request = pool.request();
      if (search && search.trim() !== '') {
        request.input('search', sql.NVarChar(255), `%${search.trim()}%`);
      }
      return request.query(query);
    });

    const duration = Date.now() - startTime;

    console.log(
      `[USERS-EMAILS] Consulta exitosa: ${result.recordset.length} usuarios encontrados en ${duration}ms`
    );

    return NextResponse.json(
      {
        success: true,
        users: result.recordset,
        count: result.recordset.length,
        message: 'Usuarios obtenidos exitosamente',
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Error desconocido';

    console.error(`[USERS-EMAILS] Error después de ${duration}ms:`, errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}
