import 'server-only';
import sql from 'mssql';
import { orionInternalTaskSql } from './internalTasks';

type SqlPool = import('mssql').ConnectionPool;

/**
 * Cierre automático al terminar de firmar (interruptor en la lista de solicitudes).
 *
 * ACTIVADO POR DEFECTO (pedido de Juan, 2026-10-20): cuando todos los documentos quedan
 * firmados se cierran solas las tareas de firma y el flujo sigue con la siguiente tarea.
 * La SOLICITUD no se cierra: solo la parte de firma (también pedido de Juan).
 * Quien no lo quiera lo apaga con el interruptor; esa elección se guarda en
 * dbo.user_signature_auto_close (prisma/manual/2026-10-16-user-signature-auto-close.sql).
 * Sin fila = activado. Si la tabla aún no existe, nadie pudo apagarlo: también activado.
 */

/** Valor para quien nunca tocó el interruptor. */
export const SIGNATURE_AUTO_CLOSE_DEFAULT = true;

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
    const row = result.recordset[0];
    return row ? Boolean(row.enabled) : SIGNATURE_AUTO_CLOSE_DEFAULT;
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

/**
 * Preferencia del solicitante: activado salvo que lo haya apagado. Sin tabla también activado
 * (nadie pudo apagarlo). Si la lectura falla por otra razón no se cierra nada: ante la duda,
 * mejor dejar la solicitud abierta que cerrarla contra la voluntad de la persona.
 */
export async function isSignatureAutoCloseEnabled(
  pool: SqlPool,
  requesterUserId: string | null | undefined
): Promise<boolean> {
  if (!requesterUserId) return false;
  try {
    return await getSignatureAutoClose(pool, requesterUserId);
  } catch (err) {
    if (err instanceof SignatureAutoCloseUnavailableError) return SIGNATURE_AUTO_CLOSE_DEFAULT;
    console.warn('[orion/autoClose] No se pudo leer la preferencia de cierre automático:', err);
    return false;
  }
}

/**
 * Antes de avanzar el flujo: resuelve la tarea de firma del proceso y lo que quede abierto del
 * proceso interno de firma, para que el flujo pueda seguir con la siguiente tarea.
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
