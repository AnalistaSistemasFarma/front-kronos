import 'server-only';
import sql from 'mssql';
import { orionInternalTaskSql } from './internalTasks';

type SqlPool = import('mssql').ConnectionPool;

/**
 * Cierre automático de la parte de firma (pedido de Juan, 2026-10-20).
 *
 * Cuando todos los documentos quedan firmados se cierran solas las tareas de firma, SIEMPRE y
 * para todos (ya no hay interruptor ni preferencia por persona), y el flujo sigue con la
 * siguiente tarea. La SOLICITUD no se cierra: solo la parte de firma.
 */

/**
 * ¿El nombre de la tarea habla de firmar? Palabra completa ("Firma", "Firmar", "Firmas"):
 * findOrionSignatureTaskTemplate busca LIKE '%firma%' y eso también encuentra "Confirmar
 * recepción", que es un paso normal del proceso y no debe cerrarse solo.
 */
export function isSignatureTaskName(task: string | null | undefined): boolean {
  return /(^|[^a-záéíóúüñ])firma(r|s)?([^a-záéíóúüñ]|$)/i.test(String(task ?? ''));
}

/**
 * Antes de avanzar el flujo: resuelve la tarea de firma del proceso y lo que quede abierto del
 * proceso interno de firma, para que el flujo pueda seguir con la siguiente tarea.
 * `templateTaskId` solo se pasa si de verdad es una tarea de firma (ver isSignatureTaskName);
 * con null se cierra únicamente el proceso interno (turnos de firmantes, autorización, validación).
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
