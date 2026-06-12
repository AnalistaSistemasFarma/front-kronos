import sql from 'mssql';
import sqlConfig from '../../../dbconfig';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';

export const dynamic = 'force-dynamic';

/**
 * Conexión propia (no getPool): en Turbopack HMR el pool global puede quedar
 * ligado a otra instancia de mssql y romper .input() con EPARAM.
 */
export async function GET() {
  let pool;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input('email', sql.NVarChar(255), session.user.email)
      .query(
        `SELECT TOP 50 id, title, body, url, read_at, created_at
         FROM notifications
         WHERE email = @email
         ORDER BY created_at DESC`
      );

    const unreadCount = result.recordset.filter((n) => !n.read_at).length;

    return NextResponse.json({ notifications: result.recordset, unreadCount });
  } catch (err) {
    console.error('[GET /api/notifications] Error:', err);
    return NextResponse.json({ error: 'Error al obtener notificaciones' }, { status: 500 });
  } finally {
    if (pool?.connected) {
      await pool.close().catch(() => {});
    }
  }
}
