import { sql, withMssqlPool } from '../../../lib/mssqlPool';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { isHelpDeskTechnician } from '../../../lib/help-desk/technicians';
import {
  TICKET_NEW_TITLE,
  cleanupDeprecatedNewTicketNotifications,
  cleanupObsoleteTicketNotifications,
  filterNotificationsForUser,
} from '../../../lib/notificationEvents.js';

export const dynamic = 'force-dynamic';

/**
 * La limpieza de avisos de ticket obsoletos (DELETE) corría en CADA sondeo de la campana.
 * Lo que se borra ya no se muestra (filtro SQL + filterNotificationsForUser), así que basta
 * con limpiar en segundo plano como mucho una vez cada 6 h por usuario y proceso.
 */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastCleanupByEmail =
  globalThis.__kronosNotificationCleanup ?? (globalThis.__kronosNotificationCleanup = new Map());

function scheduleTicketCleanup(userEmail, isTechnician) {
  const last = lastCleanupByEmail.get(userEmail);
  if (last && Date.now() - last < CLEANUP_INTERVAL_MS) return;
  lastCleanupByEmail.set(userEmail, Date.now());

  void withMssqlPool(async (pool) => {
    await cleanupDeprecatedNewTicketNotifications(pool, userEmail);
    if (!isTechnician) return;
    const deleted = await cleanupObsoleteTicketNotifications(pool, userEmail);
    if (deleted > 0) {
      console.log(
        `[GET /api/notifications] Limpieza técnico ${userEmail}: ${deleted} notificación(es) de ticket obsoleta(s) eliminada(s)`
      );
    }
  }).catch((err) => {
    lastCleanupByEmail.delete(userEmail);
    console.error('[GET /api/notifications] Error en la limpieza:', err);
  });
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') === 'read' ? 'read' : 'unread';

    const userEmail = String(session.user.email || '')
      .trim()
      .toLowerCase();

    // Los avisos del CHAT no van en la campana (2026-10-01): el chat tiene su
    // propio contador. Desde entonces ya no se crean (solo push); las filas
    // viejas no se borran, se ocultan aquí por la URL del chat.
    return await withMssqlPool(async (pool) => {
      if (statusFilter === 'read') {
        const readResult = await pool
          .request()
          .input('email', sql.NVarChar(255), userEmail)
          .query(
            `SELECT TOP 50 id, title, body, url, read_at, created_at
           FROM notifications
           WHERE LOWER(LTRIM(RTRIM(email))) = @email AND read_at IS NOT NULL
             AND (url IS NULL OR url NOT LIKE '/process/chat%')
           ORDER BY read_at DESC`
          );

        return NextResponse.json({ notifications: readResult.recordset });
      }

      // La campana sondea cada 30 s: el rol y la lista van en paralelo (antes eran 5 consultas
      // en serie, con 2 DELETE y una consulta de subprocesos cuyo resultado no se usaba).
      // "Nuevo ticket" ya no se muestra a nadie: se excluye aquí y se borra en la limpieza.
      const [isTechnician, result] = await Promise.all([
        isHelpDeskTechnician(userEmail),
        pool
          .request()
          .input('email', sql.NVarChar(255), userEmail)
          .input('newTicketTitle', sql.NVarChar(255), TICKET_NEW_TITLE)
          .query(
            `SELECT TOP 50 id, title, body, url, read_at, created_at
           FROM notifications
           WHERE LOWER(LTRIM(RTRIM(email))) = @email AND read_at IS NULL
             AND (url IS NULL OR url NOT LIKE '/process/chat%')
             AND (title IS NULL OR title <> @newTicketTitle)
           ORDER BY created_at DESC`
          ),
      ]);

      scheduleTicketCleanup(userEmail, isTechnician);

      const notifications = filterNotificationsForUser(result.recordset, { isTechnician });
      const unreadCount = notifications.filter((n) => !n.read_at).length;

      return NextResponse.json({ notifications, unreadCount });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('abort')) {
      return NextResponse.json({ error: 'Solicitud cancelada' }, { status: 499 });
    }
    console.error('[GET /api/notifications] Error:', err);
    return NextResponse.json({ error: 'Error al obtener notificaciones' }, { status: 500 });
  }
}
