import sql from 'mssql';
import webpush from 'web-push';
import sqlConfig from '../dbconfig.js';

let configured = false;
let configFailed = false;

const DEFAULT_VAPID_SUBJECT = 'mailto:soporte@kronos.local';

/**
 * Normaliza el "subject" de VAPID.
 *
 * `web-push` valida el subject con `new URL(...)` y solo acepta los protocolos
 * `https:` y `mailto:`. En el `.env` el valor se escribe casi siempre como
 * correo pelado (`alguien@dominio.com`): en ese caso `setVapidDetails()`
 * lanzaba "Vapid subject is not a valid URL" y NINGUNA notificación push
 * salía jamás. Por eso la normalización vive en el código y no solo en la
 * configuración: así el envío es a prueba de un `.env` mal escrito.
 *
 * Reglas:
 *   - vacío                  → subject por defecto
 *   - `https://...`          → se deja igual
 *   - `mailto:...`           → se deja igual, con el prefijo en minúsculas
 *                              (web-push compara el protocolo en minúsculas)
 *   - `http://...`           → se sube a `https://` (VAPID no admite http)
 *   - cualquier otra cosa    → se asume correo y se le antepone `mailto:`
 *
 * @param {string|undefined} raw
 * @returns {string} subject válido para web-push
 */
export function normalizeVapidSubject(raw) {
  const value = String(raw || '').trim();
  if (!value) return DEFAULT_VAPID_SUBJECT;

  const mailto = value.match(/^mailto:(.*)$/i);
  if (mailto) {
    const address = mailto[1].trim();
    return address ? `mailto:${address}` : DEFAULT_VAPID_SUBJECT;
  }

  if (/^https:\/\//i.test(value)) return value;

  const insecure = value.match(/^http:\/\/(.*)$/i);
  if (insecure) {
    console.warn(
      `[push] VAPID_CONTACT_EMAIL usa http://, que VAPID no admite. Se usará https:// en su lugar.`
    );
    return `https://${insecure[1]}`;
  }

  return `mailto:${value}`;
}

function ensureConfigured() {
  if (configured) return true;
  if (configFailed) return false;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = normalizeVapidSubject(process.env.VAPID_CONTACT_EMAIL);

  if (!publicKey || !privateKey) {
    console.warn(
      '[push] VAPID no configuradas (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Push desactivado.'
    );
    configFailed = true;
    return false;
  }

  try {
    webpush.setVapidDetails(contact, publicKey, privateKey);
  } catch (err) {
    // Si aun así la configuración es inválida (llaves malformadas, etc.) se
    // desactiva el push una sola vez en lugar de lanzar en cada notificación.
    console.error('[push] Configuración VAPID inválida. Push desactivado:', err);
    configFailed = true;
    return false;
  }

  configured = true;
  console.log(`[push] VAPID configurado correctamente (subject: ${contact}).`);
  return true;
}

/**
 * Envía push notification a todas las suscripciones del email indicado.
 *
 * @param {string} email
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 * @returns {Promise<boolean>} true si al menos una notificación fue exitosa
 */
export async function sendPushNotification(email, payload) {
  if (!ensureConfigured()) return false;

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
    // Icono opcional de la notificación (ruta dentro de /public). Lo usa el
    // chat de agentes para mostrar la foto del agente en vez del logo
    // genérico; si no viene, el service worker cae al icono de SynerLink.
    icon: payload.icon,
  });

  let anySuccess = false;
  const expiredIds = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const res = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message
        );
        console.log(
          `[sendPushNotification] OK ${email} (sub ${sub.id}) -> ${res?.statusCode ?? 'sin código'}`
        );
        anySuccess = true;
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Suscripción vencida o revocada por el navegador: se limpia de la BD.
          console.warn(
            `[sendPushNotification] Suscripción vencida (${statusCode}) para ${email} (sub ${sub.id}). Se elimina.`
          );
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
