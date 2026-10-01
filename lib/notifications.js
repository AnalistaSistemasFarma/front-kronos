import sql from 'mssql';
import sqlConfig from '../dbconfig.js';
import { sendPushNotification } from './push.js';

/**
 * Crea notificaciones en la BD para cada email y envía push a los suscritos.
 *
 * @param {string[]} emails
 * @param {{ title: string, body: string, url?: string, tag?: string, icon?: string, vibrate?: number[] }} payload
 *   `icon` es opcional: ruta dentro de /public que el service worker usa como
 *   icono de la notificación (p. ej. la foto del agente que responde en el
 *   chat de Asistentes IA). Sin él, cae al logo de SynerLink.
 *   `vibrate` es opcional: patrón de vibración (lo usa el zumbido del chat).
 * @param {{ skipBell?: boolean }} [options]
 *   `skipBell`: SOLO push, sin fila en `notifications` (la campana). Lo usan los
 *   avisos del chat (2026-10-01): el chat ya tiene su propio contador y en la
 *   campana eran redundantes.
 */
export async function createAndSendNotifications(emails, payload, options = {}) {
  const uniqueEmails = [
    ...new Set(
      (emails || [])
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (uniqueEmails.length === 0) return { saved: 0, pushed: 0 };

  const skipBell = Boolean(options && options.skipBell);
  const pool = skipBell ? null : await sql.connect(sqlConfig);

  await Promise.all(
    uniqueEmails.map(async (email) => {
      if (!pool) return;
      try {
        await pool
          .request()
          .input('email', sql.NVarChar(255), email)
          .input('title', sql.NVarChar(255), payload.title)
          .input('body', sql.NVarChar(sql.MAX), payload.body)
          .input('url', sql.NVarChar(500), payload.url || null)
          .query(
            `INSERT INTO notifications (email, title, body, url) VALUES (@email, @title, @body, @url)`
          );
      } catch (err) {
        console.error(`[createAndSendNotifications] Error guardando en BD para ${email}:`, err);
      }
    })
  );

  let pushed = 0;
  await Promise.all(
    uniqueEmails.map(async (email) => {
      try {
        const ok = await sendPushNotification(email, payload);
        if (ok) pushed++;
      } catch (err) {
        console.error(`[createAndSendNotifications] Error push a ${email}:`, err);
      }
    })
  );

  return { saved: skipBell ? 0 : uniqueEmails.length, pushed };
}

/**
 * Fecha de la ÚLTIMA notificación guardada para `email` con esa `url` y ese
 * `title`, junto con la hora actual de la MISMA base (`created_at` se llena
 * con GETUTCDATE(): comparar contra el reloj del servidor web daría saltos si
 * los relojes no coinciden). La usa el límite de push de los mensajes
 * directos del chat (lib/chat/notifyPeople.ts). Sin filas: `ultima` = null.
 *
 * @param {string} email
 * @param {string} url
 * @param {string} title
 * @returns {Promise<{ ultima: Date | null, ahora: Date }>}
 */
export async function getLastNotificationAt(email, url, title) {
  const pool = await sql.connect(sqlConfig);
  const result = await pool
    .request()
    .input('email', sql.NVarChar(255), String(email || '').trim().toLowerCase())
    .input('url', sql.NVarChar(500), url)
    .input('title', sql.NVarChar(255), title)
    .query(
      `SELECT
         (SELECT TOP 1 created_at FROM notifications
          WHERE email = @email AND url = @url AND title = @title
          ORDER BY created_at DESC) AS ultima,
         GETUTCDATE() AS ahora`
    );
  const fila = result.recordset?.[0] || {};
  return { ultima: fila.ultima || null, ahora: fila.ahora || new Date() };
}
