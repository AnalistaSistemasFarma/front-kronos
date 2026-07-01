import sql from 'mssql';
import sqlConfig from '../../../dbconfig';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { getHelpDeskUserRole } from '../../../lib/help-desk/access';
import {
  cleanupDeprecatedNewTicketNotifications,
  cleanupObsoleteTicketNotifications,
  filterNotificationsForUser,
} from '../../../lib/notificationEvents.js';

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

    const userEmail = session.user.email;
    const { isOperator: isTechnician } = await getHelpDeskUserRole(userEmail);

    pool = await sql.connect(sqlConfig);

    await cleanupDeprecatedNewTicketNotifications(pool, userEmail);

    if (isTechnician) {
      const deleted = await cleanupObsoleteTicketNotifications(pool, userEmail);
      if (deleted > 0) {
        console.log(
          `[GET /api/notifications] Limpieza técnico ${userEmail}: ${deleted} notificación(es) de ticket obsoleta(s) eliminada(s)`
        );
      }
    }

    const result = await pool
      .request()
      .input('email', sql.NVarChar(255), userEmail)
      .query(
        `SELECT TOP 50 id, title, body, url, read_at, created_at
         FROM notifications
         WHERE email = @email
         ORDER BY created_at DESC`
      );

    const notifications = filterNotificationsForUser(result.recordset, { isTechnician });
    const unreadCount = notifications.filter((n) => !n.read_at).length;

    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[GET /api/notifications] Error:', err);
    return NextResponse.json({ error: 'Error al obtener notificaciones' }, { status: 500 });
  } finally {
    if (pool?.connected) {
      await pool.close().catch(() => {});
    }
  }
}
