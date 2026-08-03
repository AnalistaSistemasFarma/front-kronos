import { sql, withMssqlPool } from '../mssqlPool';
import {
  fireAndForgetNotification,
  resolveEmailByUserId,
  buildAppUrl,
} from '../notificationEvents.js';
import { createAndSendNotifications } from '../notifications.js';

// Integración Synerlink → SAPSEND: cuando se crea una solicitud de categoría Tesorería
// (formulario de "Solicitud de Pago"), se crea allí una solicitud de tesorería equivalente.
// El contrato es idempotente por `id` (id de requests_general), así que reenviar es seguro.

const SAPSEND_URL = (
  process.env.SAPSEND_URL || 'https://appreciate-swaziland-integrated-carolina.trycloudflare.com'
).replace(/\/$/, '');
const SYNERLINK_API_KEY = process.env.SYNERLINK_API_KEY || '';
const SAPSEND_ENDPOINT = `${SAPSEND_URL}/api/synerlink`;

// Usuario que recibe la campana cuando falla el envío a SAPSEND.
const FAILURE_NOTIFY_USER_ID = 'cmgqz404x0000ct9k1j8xdet1';

// ---- Gate: ¿es una solicitud de pago de tesorería? ----
async function isTreasuryPaymentRequest(pool, requestId) {
  const result = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`
      SELECT TOP 1 1 AS ok
      FROM requests_general rg
      INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
      INNER JOIN category_request cr ON cr.id = pc.id_category_request
      WHERE rg.id = @id
        AND cr.category LIKE 'Tesorer%'
        AND EXISTS (
          SELECT 1 FROM request_form_value rfv
          WHERE rfv.id_request_general = rg.id AND rfv.id_form_field = 10
        )
    `);
  return result.recordset.length > 0;
}

// ---- Construcción del payload del contrato ----
function normalizeDate(value) {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim().slice(0, 10); // 'YYYY-MM-DD'
}

async function buildTreasuryPayload(pool, requestId) {
  const result = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`
      SELECT
        rg.id AS request_id,
        u.name AS requester_name,
        u.id_user_sapsend AS id_creator_request,
        MAX(CASE WHEN rfv.id_form_field = 10 THEN o.id_request_type END) AS id_request_type,
        MAX(CASE WHEN rfv.id_form_field = 11 THEN o.id_request_subtype END) AS id_request_subtype,
        MAX(CASE WHEN rfv.id_form_field = 12 THEN COALESCE(o.option_label, rfv.value_text) END) AS valor_a_pagar,
        MAX(CASE WHEN rfv.id_form_field = 13 THEN COALESCE(o.option_label, rfv.value_text) END) AS fecha_necesaria,
        MAX(CASE WHEN rfv.id_form_field = 14 THEN COALESCE(o.option_label, rfv.value_text) END) AS concepto,
        MAX(CASE WHEN rfv.id_form_field = 15 THEN COALESCE(o.option_label, rfv.value_text) END) AS acreedor
      FROM requests_general rg
      LEFT JOIN [user] u ON u.id = rg.id_requester
      LEFT JOIN request_form_value rfv ON rfv.id_request_general = rg.id
      LEFT JOIN process_form_field_option o ON o.id = rfv.id_option
      WHERE rg.id = @id
      GROUP BY rg.id, u.name, u.id_user_sapsend
    `);

  const row = result.recordset[0];
  if (!row) throw new Error('No se encontró la solicitud');
  if (row.id_creator_request == null) {
    throw new Error('El creador de la solicitud no tiene id_user_sapsend configurado');
  }

  return {
    id: row.request_id,
    requester: row.requester_name || undefined,
    'ID Tipo de Solicitud': row.id_request_type != null ? Number(row.id_request_type) : undefined,
    'ID Subtipo de Solicitud':
      row.id_request_subtype != null ? Number(row.id_request_subtype) : undefined,
    'Valor a Pagar': row.valor_a_pagar != null ? Number(row.valor_a_pagar) : undefined,
    'Fecha Necesaria de Pago': normalizeDate(row.fecha_necesaria),
    Concepto: row.concepto ?? null,
    Acreedor: row.acreedor ?? undefined,
    id_creator_request: row.id_creator_request,
  };
}

// ---- POST al endpoint de SAPSEND ----
async function postTreasuryRequest(payload) {
  console.log('[sapsend] POST', SAPSEND_ENDPOINT, 'payload:', JSON.stringify(payload));

  const res = await fetch(SAPSEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': SYNERLINK_API_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  // Leemos texto crudo primero: así capturamos también respuestas no-JSON (p. ej. una página
  // de error de un proxy) y las dejamos en el log para diagnóstico.
  const rawText = await res.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* la respuesta no es JSON; queda en rawText */
  }

  console.log(`[sapsend] respuesta ${res.status} ${res.ok ? 'OK' : 'ERROR'}:`, rawText);

  return { httpStatus: res.status, ok: res.ok, body, rawText };
}

// Construye un mensaje de error legible a partir de la respuesta de SAPSEND.
function describeSapsendError(result) {
  const b = result.body;
  if (b && typeof b === 'object') {
    const parts = [b.error || b.message, b.details, b.field ? `(campo: ${b.field})` : null].filter(
      Boolean
    );
    if (parts.length) return `${parts.join(' — ')} [HTTP ${result.httpStatus}]`;
  }
  if (result.rawText) return `${result.rawText.slice(0, 300)} [HTTP ${result.httpStatus}]`;
  return `SAPSEND respondió con estado ${result.httpStatus}`;
}

// ---- Persistencia de estado ----
async function setStatus(pool, requestId, status, error) {
  await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('status', sql.NVarChar(20), status)
    .input('error', sql.NVarChar(500), error ?? null)
    .query(
      `UPDATE requests_general SET sapsend_status = @status, sapsend_error = @error WHERE id = @id`
    );
}

async function markSent(pool, requestId, body) {
  await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('idTreasury', sql.Int, body?.id_treasury_requests ?? null)
    .input('numero', sql.Int, body?.numero ?? null)
    .query(`
      UPDATE requests_general
      SET id_treasury_requests = @idTreasury,
          numero_sapsend = @numero,
          sapsend_status = 'sent',
          sapsend_error = NULL,
          sapsend_synced_at = GETDATE()
      WHERE id = @id
    `);
}

async function notifyFailure(requestId, message) {
  try {
    const email = await resolveEmailByUserId(FAILURE_NOTIFY_USER_ID);
    if (!email) return;
    fireAndForgetNotification(
      createAndSendNotifications([email], {
        title: 'Error de envío a SAPSEND · SynerLink',
        body: `La solicitud #${requestId} no se pudo enviar a SAPSEND: ${message}`,
        url: buildAppUrl(`/process/request-general/view-request?id=${requestId}`),
        tag: `sapsend-failed-${requestId}`,
      })
    );
  } catch (err) {
    console.error('[sapsend] notifyFailure error:', err);
  }
}

/**
 * Orquestador. NUNCA lanza: registra el resultado en requests_general y notifica al fallar.
 * Se usa tanto en la creación (fire-and-forget) como en el reenvío manual (await).
 * @param {number} requestId  id de requests_general
 * @returns {Promise<{ skipped?: boolean, ok?: boolean, error?: string, id_treasury_requests?: number, numero?: number, created?: boolean }>}
 */
export async function syncRequestToSapsend(requestId) {
  const id = Number(requestId);

  // Helper para marcar fallo + notificar sin propagar (usa un pool fresco cada vez).
  const fail = async (msg) => {
    try {
      await withMssqlPool((pool) => setStatus(pool, id, 'failed', msg));
    } catch (e) {
      console.error('[sapsend] no se pudo persistir el estado failed:', e);
    }
    await notifyFailure(id, msg);
    return { ok: false, error: msg };
  };

  // 1) Preparación (DB en ráfaga corta): gate + estado pending + payload.
  //    IMPORTANTE: no retener la conexión durante el POST externo (evita ECONNCLOSED si el
  //    pool compartido se recicla durante la espera de la llamada HTTP).
  let prep;
  try {
    prep = await withMssqlPool(async (pool) => {
      if (!(await isTreasuryPaymentRequest(pool, id))) return { skipped: true };
      await setStatus(pool, id, 'pending', null);
      const payload = await buildTreasuryPayload(pool, id);
      return { payload };
    });
  } catch (err) {
    console.error('[sapsend] error en preparación:', err);
    return fail(err?.message || 'No se pudo preparar el envío a SAPSEND');
  }
  if (prep.skipped) return { skipped: true };

  // 2) POST a SAPSEND — SIN conexión de BD retenida.
  let result;
  try {
    result = await postTreasuryRequest(prep.payload);
  } catch (err) {
    const msg =
      err?.name === 'TimeoutError'
        ? 'Tiempo de espera agotado al conectar con SAPSEND'
        : err?.message || 'Error de red al conectar con SAPSEND';
    console.error('[sapsend] error en el POST:', err);
    return fail(msg);
  }

  // 3) Persistir el resultado con un pool fresco.
  if (result.ok) {
    try {
      await withMssqlPool((pool) => markSent(pool, id, result.body));
    } catch (err) {
      // El envío a SAPSEND SÍ funcionó; solo falló guardar la referencia localmente.
      console.error('[sapsend] envío OK pero no se pudo guardar la referencia:', err);
      return {
        ok: true,
        persistError: true,
        id_treasury_requests: result.body?.id_treasury_requests,
        numero: result.body?.numero,
        created: result.body?.created,
      };
    }
    return {
      ok: true,
      id_treasury_requests: result.body?.id_treasury_requests,
      numero: result.body?.numero,
      created: result.body?.created,
    };
  }

  return fail(describeSapsendError(result));
}
