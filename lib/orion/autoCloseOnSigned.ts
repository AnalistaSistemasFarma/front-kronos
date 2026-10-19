import 'server-only';
import sql from 'mssql';
import { orionInternalTaskSql } from './internalTasks';
import { fireAndForgetNotification, notifyRequestClosed } from '../notificationEvents.js';

type SqlPool = import('mssql').ConnectionPool;

/**
 * Cierre automático al terminar de firmar (interruptor en la lista de solicitudes).
 *
 * Cada solicitante decide si sus solicitudes se cierran solas cuando todos los documentos
 * quedan firmados. Se guarda en dbo.user_signature_auto_close
 * (prisma/manual/2026-10-16-user-signature-auto-close.sql); sin fila = desactivado.
 * Si la tabla aún no existe, todo sigue como siempre (sin cierre automático).
 */

/** La tabla aún no existe (el pase manual no se ha corrido). */
export class SignatureAutoCloseUnavailableError extends Error {
  constructor() {
    super('El cierre automático al firmar aún no está disponible.');
    this.name = 'SignatureAutoCloseUnavailableError';
  }
}

function isMissingTable(err: unknown): boolean {
  const e = err as { number?: number; originalError?: { info?: { number?: number } } };
  return e?.number === 208 || e?.originalError?.info?.number === 208;
}

export async function getSignatureAutoClose(pool: SqlPool, userId: string): Promise<boolean> {
  try {
    const result = await pool
      .request()
      .input('idUser', sql.NVarChar(1000), userId)
      .query('SELECT TOP 1 enabled FROM dbo.user_signature_auto_close WHERE id_user = @idUser');
    return Boolean(result.recordset[0]?.enabled);
  } catch (err) {
    if (isMissingTable(err)) throw new SignatureAutoCloseUnavailableError();
    throw err;
  }
}

export async function saveSignatureAutoClose(
  pool: SqlPool,
  userId: string,
  enabled: boolean
): Promise<void> {
  try {
    await pool
      .request()
      .input('idUser', sql.NVarChar(1000), userId)
      .input('enabled', sql.Bit, enabled)
      .query(`
        UPDATE dbo.user_signature_auto_close
        SET enabled = @enabled, updated_at = SYSDATETIME()
        WHERE id_user = @idUser;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.user_signature_auto_close (id_user, enabled) VALUES (@idUser, @enabled);
      `);
  } catch (err) {
    if (isMissingTable(err)) throw new SignatureAutoCloseUnavailableError();
    throw err;
  }
}

/** Preferencia del solicitante; false si no la activó o si la tabla no existe. */
export async function isSignatureAutoCloseEnabled(
  pool: SqlPool,
  requesterUserId: string | null | undefined
): Promise<boolean> {
  if (!requesterUserId) return false;
  try {
    return await getSignatureAutoClose(pool, requesterUserId);
  } catch (err) {
    if (!(err instanceof SignatureAutoCloseUnavailableError)) {
      console.warn('[orion/autoClose] No se pudo leer la preferencia de cierre automático:', err);
    }
    return false;
  }
}

/**
 * Paso 1 (antes de avanzar el flujo): resuelve la tarea de firma del proceso y lo que quede
 * abierto del proceso interno de firma, para que el flujo pueda seguir o la solicitud cerrarse.
 */
export async function resolveSignatureTasksOnSigned(
  pool: SqlPool,
  params: { requestId: number; templateTaskId: number | null; executorUserId: string | null }
): Promise<number> {
  const result = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_task', sql.Int, params.templateTaskId)
    .input('executor', sql.NVarChar(1000), params.executorUserId)
    .input('note', sql.NVarChar(sql.MAX), ' Cerrada automáticamente: todas las firmas quedaron completas.')
    .query(`
      UPDATE trg
      SET id_status = 2,
          start_date = ISNULL(trg.start_date, GETDATE()),
          end_date = GETDATE(),
          date_resolution = GETDATE(),
          resolution = CONCAT(ISNULL(trg.resolution, N''), @note),
          id_executor_final = ISNULL(trg.id_executor_final, @executor)
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id_request
        AND trg.id_status NOT IN (2, 3)
        AND (trg.id_task = @id_task OR ${orionInternalTaskSql('trg', 'tpc')})
    `);
  return Number(result.rowsAffected?.[0] || 0);
}

async function insertNote(pool: SqlPool, requestId: number, note: string, author: string | null) {
  if (!author) return;
  try {
    await pool
      .request()
      .input('note', sql.Text, note)
      .input('id_request', sql.Int, requestId)
      .input('created_by', sql.NVarChar, author)
      .query('INSERT INTO notes (note, id_request, created_by) VALUES (@note, @id_request, @created_by)');
  } catch (err) {
    console.warn('[orion/autoClose] No se pudo registrar la nota:', err);
  }
}

/**
 * Paso 2 (después de avanzar el flujo): cierra la solicitud (Resuelto) solo si ya no queda
 * ninguna tarea abierta. Si queda alguna, la deja abierta y lo explica en una nota.
 */
export async function closeRequestIfNoOpenTasks(
  pool: SqlPool,
  params: { requestId: number; requesterUserId: string | null; subject: string | null }
): Promise<boolean> {
  const statusRes = await pool
    .request()
    .input('id', sql.Int, params.requestId)
    .query('SELECT status_req FROM requests_general WHERE id = @id');
  const status = Number(statusRes.recordset[0]?.status_req);
  if (status === 2 || status === 3) return false;

  const pending = await pool
    .request()
    .input('id', sql.Int, params.requestId)
    .query(`
      SELECT tpc.task AS task_name
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id AND trg.id_status NOT IN (2, 3)
        AND NOT ${orionInternalTaskSql('trg', 'tpc')}
      ORDER BY tpc.display_order, trg.id
    `);

  if (pending.recordset.length > 0) {
    const names = pending.recordset.map((t) => `«${t.task_name}»`).join(', ');
    await insertNote(
      pool,
      params.requestId,
      `Cierre automático: el proceso de firma terminó, pero la solicitud sigue abierta porque hay tareas pendientes: ${names}.`,
      params.requesterUserId
    );
    return false;
  }

  const resolution = 'Cerrada automáticamente al completar todas las firmas.';
  const updated = await pool
    .request()
    .input('id', sql.Int, params.requestId)
    .input('resolution', sql.NVarChar(255), resolution)
    .input('executor', sql.NVarChar(1000), params.requesterUserId)
    .query(`
      UPDATE requests_general
      SET status_req = 2,
          resolution = @resolution,
          id_executor_final = @executor,
          date_resolution = GETDATE()
      WHERE id = @id AND status_req NOT IN (2, 3)
    `);
  if (!Number(updated.rowsAffected?.[0] || 0)) return false;

  await insertNote(
    pool,
    params.requestId,
    'Se ha cerrado la solicitud automáticamente: el proceso de firma terminó (cierre automático activado por el solicitante).',
    params.requesterUserId
  );
  fireAndForgetNotification(
    notifyRequestClosed({
      requestId: params.requestId,
      subject: params.subject,
      requesterUserId: params.requesterUserId,
      statusId: 2,
    })
  );
  return true;
}
