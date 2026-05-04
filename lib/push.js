import sql from 'mssql';
import webpush from 'web-push';
import sqlConfig from '../dbconfig.js';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT_EMAIL || 'mailto:soporte@kronos.local';

  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys no configuradas (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);
  configured = true;
}

/**
 * Envía push notification a todas las suscripciones del email indicado.
 *
 * @param {string} email
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 * @returns {Promise<boolean>} true si al menos una notificación fue exitosa
 */
export async function sendPushNotification(email, payload) {
  ensureConfigured();

  const pool = await sql.connect(sqlConfig);
  const result = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE email = @email`
    );

  const subs = result.recordset;
  if (subs.length === 0) return false;

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag,
  });

  let anySuccess = false;
  const expiredIds = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message
        );
        anySuccess = true;
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expiredIds.push(sub.id);
        } else {
          console.error(`[sendPushNotification] Error enviando a ${email} (sub ${sub.id}):`, err);
        }
      }
    })
  );

  if (expiredIds.length > 0) {
    const idList = expiredIds.join(',');
    await pool.request().query(`DELETE FROM push_subscriptions WHERE id IN (${idList})`);
  }

  return anySuccess;
}
