import sql from 'mssql';
import sqlConfig from '../dbconfig.js';
import { sendPushNotification } from './push.js';

/**
 * Crea notificaciones en la BD para cada email y envía push a los suscritos.
 *
 * @param {string[]} emails
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
export async function createAndSendNotifications(emails, payload) {
  const uniqueEmails = [...new Set((emails || []).filter(Boolean))];
  if (uniqueEmails.length === 0) return { saved: 0, pushed: 0 };

  const pool = await sql.connect(sqlConfig);

  await Promise.all(
    uniqueEmails.map((email) =>
      pool
        .request()
        .input('email', sql.NVarChar(255), email)
        .input('title', sql.NVarChar(255), payload.title)
        .input('body', sql.NVarChar(sql.MAX), payload.body)
        .input('url', sql.NVarChar(500), payload.url || null)
        .query(
          `INSERT INTO notifications (email, title, body, url) VALUES (@email, @title, @body, @url)`
        )
    )
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

  return { saved: uniqueEmails.length, pushed };
}
