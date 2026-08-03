import {
  fireAndForgetNotification,
  resolveEmailByUserId,
  buildAppUrl,
} from '../notificationEvents.js';
import { createAndSendNotifications } from '../notifications.js';

// Config compartida de la integración SAPSEND (usada por treasury/authorizationStatus/files).
export const SAPSEND_URL = (
  process.env.SAPSEND_URL || 'https://appreciate-swaziland-integrated-carolina.trycloudflare.com'
).replace(/\/$/, '');
export const SYNERLINK_API_KEY = process.env.SYNERLINK_API_KEY || '';

// Usuario que recibe la campana cuando falla una operación con SAPSEND.
export const FAILURE_NOTIFY_USER_ID = 'cmgqz404x0000ct9k1j8xdet1';

// Autenticación de llamadas ENTRANTES de SAPSEND: compara el header `x-api-key` contra el mismo
// secreto compartido que usamos saliente. Rechaza si el secreto no está configurado (evita aceptar
// un header vacío por accidente).
export function isValidSapsendApiKey(req) {
  const provided = req.headers.get('x-api-key') || '';
  return SYNERLINK_API_KEY.length > 0 && provided === SYNERLINK_API_KEY;
}

// Mensaje de error legible a partir de una respuesta de SAPSEND ({ httpStatus, body, rawText }).
export function describeSapsendError(result) {
  const b = result?.body;
  if (b && typeof b === 'object') {
    const parts = [b.error || b.message, b.details, b.field ? `(campo: ${b.field})` : null].filter(
      Boolean
    );
    if (parts.length) return `${parts.join(' — ')} [HTTP ${result.httpStatus}]`;
  }
  if (result?.rawText) return `${result.rawText.slice(0, 300)} [HTTP ${result.httpStatus}]`;
  return `SAPSEND respondió con estado ${result?.httpStatus}`;
}

// Notificación de campana al usuario responsable cuando algo falla.
export async function notifySapsendFailure(requestId, title, message) {
  try {
    const email = await resolveEmailByUserId(FAILURE_NOTIFY_USER_ID);
    if (!email) return;
    fireAndForgetNotification(
      createAndSendNotifications([email], {
        title,
        body: `Solicitud #${requestId}: ${message}`,
        url: buildAppUrl(`/process/request-general/view-request?id=${requestId}`),
        tag: `sapsend-${requestId}`,
      })
    );
  } catch (err) {
    console.error('[sapsend] notifySapsendFailure error:', err);
  }
}
