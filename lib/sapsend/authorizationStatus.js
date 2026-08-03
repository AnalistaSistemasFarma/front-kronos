import { sql, withMssqlPool } from '../mssqlPool';
import {
  SAPSEND_URL,
  SYNERLINK_API_KEY,
  describeSapsendError,
  notifySapsendFailure,
} from './config.js';

// Aplica en SAPSEND la autorización/rechazo del área para una solicitud de tesorería creada desde
// Synerlink. Contrato: POST /api/synerlink/updateStatus.
//   applied:true → aplicada; applied:false (200) → ya estaba; 409 → ya no está en el estado del
//   área (trae status_request real, NO reintentar); 404 → el caso no existe en SAPSEND.

const UPDATE_STATUS_ENDPOINT = `${SAPSEND_URL}/api/synerlink/updateStatus`;

// SAPSEND (parseAction) acepta `action` en español: 'autorizar' | 'rechazar' (o boss_authorization 1|0).
function actionToken(authorize) {
  return authorize ? 'autorizar' : 'rechazar';
}

async function postUpdateStatus(payload) {
  console.log('[sapsend] POST', UPDATE_STATUS_ENDPOINT, 'payload:', JSON.stringify(payload));
  const res = await fetch(UPDATE_STATUS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': SYNERLINK_API_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const rawText = await res.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* respuesta no-JSON */
  }
  console.log(`[sapsend] updateStatus respuesta ${res.status}:`, rawText);
  return { httpStatus: res.status, ok: res.ok, body, rawText };
}

async function setAuthStatus(pool, requestId, { authStatus, statusRequest, error }) {
  await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('authStatus', sql.NVarChar(20), authStatus ?? null)
    .input('statusRequest', sql.NVarChar(60), statusRequest ?? null)
    .input('error', sql.NVarChar(500), error ?? null)
    .query(`
      UPDATE requests_general
      SET sapsend_auth_status = @authStatus,
          sapsend_status_request = COALESCE(@statusRequest, sapsend_status_request),
          sapsend_auth_error = @error,
          sapsend_auth_synced_at = GETDATE()
      WHERE id = @id
    `);
}

/**
 * @param {number} requestId       id de requests_general (caso Synerlink)
 * @param {boolean} authorize      true = autorizar (estado 2), false = rechazar (estado 3)
 * @param {string} authorizerCuid  [user].id (cuid) del autorizador
 * @param {string|null} observation motivo (en rechazo)
 */
export async function syncAuthorizationToSapsend(requestId, authorize, authorizerCuid, observation) {
  const id = Number(requestId);

  const fail = async (msg) => {
    try {
      await withMssqlPool((pool) => setAuthStatus(pool, id, { authStatus: 'failed', error: msg }));
    } catch (e) {
      console.error('[sapsend] no se pudo guardar el estado de autorización:', e);
    }
    await notifySapsendFailure(id, 'Error de autorización en SAPSEND · SynerLink', msg);
    return { ok: false, error: msg };
  };

  // 1) Preparación (BD corta): ¿la solicitud está en SAPSEND? + datos del autorizador.
  let prep;
  try {
    prep = await withMssqlPool(async (pool) => {
      const reqRes = await pool
        .request()
        .input('id', sql.Int, id)
        .query(`SELECT id_treasury_requests FROM requests_general WHERE id = @id`);
      const idTreasury = reqRes.recordset[0]?.id_treasury_requests ?? null;
      if (idTreasury == null) return { skipped: true };

      const usrRes = await pool
        .request()
        .input('cuid', sql.NVarChar(255), String(authorizerCuid ?? ''))
        .query(`SELECT TOP 1 id_user_sapsend, email FROM [user] WHERE id = @cuid`);
      const authRow = usrRes.recordset[0] || {};
      return { idTreasury, authRow };
    });
  } catch (err) {
    console.error('[sapsend] updateStatus preparación:', err);
    return fail(err?.message || 'No se pudo preparar la actualización de estado');
  }
  if (prep.skipped) return { skipped: true };

  const { authRow } = prep;
  if (authRow.id_user_sapsend == null && !authRow.email) {
    return fail('El autorizador no tiene id_user_sapsend ni email configurado');
  }

  // 2) POST (sin conexión de BD retenida).
  const payload = {
    id,
    action: actionToken(authorize),
    boss_authorization: authorize ? 1 : 0,
    id_authorizer_request: authRow.id_user_sapsend ?? undefined,
    authorizer_email: authRow.email ?? undefined,
  };
  if (observation && String(observation).trim()) {
    payload.observation = String(observation).trim().slice(0, 255);
  }

  let result;
  try {
    result = await postUpdateStatus(payload);
  } catch (err) {
    const msg =
      err?.name === 'TimeoutError'
        ? 'Tiempo de espera agotado al conectar con SAPSEND'
        : err?.message || 'Error de red al conectar con SAPSEND';
    return fail(msg);
  }

  // 3) Persistir resultado con pool fresco.
  const statusRequest = result.body?.status_request ?? null;

  if (result.ok) {
    // 200: applied true o false (ya estaba) — ambos son éxito.
    try {
      await withMssqlPool((pool) =>
        setAuthStatus(pool, id, { authStatus: 'sent', statusRequest, error: null })
      );
    } catch (err) {
      console.error('[sapsend] updateStatus OK pero no se guardó el estado:', err);
    }
    return { ok: true, applied: result.body?.applied, status_request: statusRequest };
  }

  if (result.httpStatus === 409) {
    // Alguien en SAPSEND ya movió la solicitud. No reintentar; sincronizar el estado real.
    const msg = describeSapsendError(result);
    try {
      await withMssqlPool((pool) =>
        setAuthStatus(pool, id, { authStatus: 'conflict', statusRequest, error: msg })
      );
    } catch (err) {
      console.error('[sapsend] no se pudo guardar el conflicto:', err);
    }
    return { ok: false, conflict: true, status_request: statusRequest, error: msg };
  }

  return fail(describeSapsendError(result));
}
