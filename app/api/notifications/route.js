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
export async function GET(request) {
  let pool;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // status=unread (por defecto): consulta ligera para el polling recurrente.
    // status=read: solo bajo demanda cuando el usuario pide ver las leídas.
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') === 'read' ? 'read' : 'unread';

    pool = await sql.connect(sqlConfig);

    if (statusFilter === 'read') {
      const readResult = await pool
        .request()
        .input('email', sql.NVarChar(255), session.user.email)
        .query(
          `SELECT TOP 50 id, title, body, url, read_at, created_at
           FROM notifications
           WHERE email = @email AND read_at IS NOT NULL
           ORDER BY read_at DESC`
        );

      return NextResponse.json({ notifications: readResult.recordset });
    }

    const result = await pool
      .request()
      .input('email', sql.NVarChar(255), session.user.email)
      .query(
        `SELECT TOP 50 id, title, body, url, read_at, created_at
         FROM notifications
         WHERE email = @email AND read_at IS NULL
         ORDER BY created_at DESC`
      );

    // Conteo exacto de no leídas (independiente del TOP 50) para el badge.
    const countResult = await pool
      .request()
      .input('email', sql.NVarChar(255), session.user.email)
      .query(
        `SELECT COUNT(*) AS unreadCount
         FROM notifications
         WHERE email = @email AND read_at IS NULL`
      );

    const unreadCount = countResult.recordset[0]?.unreadCount ?? 0;

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
