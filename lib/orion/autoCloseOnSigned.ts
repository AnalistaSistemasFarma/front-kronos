import 'server-only';
import sql from 'mssql';
import { orionInternalTaskSql } from './internalTasks';
import { closeRequestGeneral } from '../workflow/closeRequestGeneral.js';

type SqlPool = import('mssql').ConnectionPool;

/**
 * Cierre automático de la parte de firma (pedido de Juan, 2026-10-20).
 *
 * Cuando todos los documentos quedan firmados se cierran solas las tareas de firma, SIEMPRE y
 * para todos (ya no hay interruptor ni preferencia por persona), y el flujo sigue con la
 * siguiente tarea. Desde 2026-11-12, si ya no queda ninguna otra tarea abierta, también se
 * cierra la solicitud (closeRequestWhenAllSigned).
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

/**
 * Cierre automático de la SOLICITUD al quedar todo firmado (decisión de Juan, 2026-11-12).
 * Se llama después de cerrar las tareas de firma y avanzar el flujo: si el flujo creó la
 * siguiente tarea, o queda cualquier otra tarea abierta, NO se cierra. Mismo criterio que
 * `closes_request` en update-activities (las tareas internas de firma no cuentan).
 * Solo cierra solicitudes abiertas: no toca borradores (6), devueltas (7) ni ya cerradas.
 * Idempotente: closeRequestGeneral no hace nada si ya estaba cerrada.
 */
export async function closeRequestWhenAllSigned(
  pool: SqlPool,
  params: { requestId: number; closedByUserId: string | null }
): Promise<boolean> {
  const result = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .query(`
      SELECT
        (SELECT status_req FROM requests_general WHERE id = @id_request) AS status_req,
        (SELECT COUNT(*)
           FROM task_request_general trg
           INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          WHERE trg.id_request_general = @id_request
            AND trg.id_status NOT IN (2, 3)
            AND NOT ${orionInternalTaskSql('trg', 'tpc')}) AS open_tasks
    `);
  const row = result.recordset[0] as { status_req: number | null; open_tasks: number } | undefined;
  const status = Number(row?.status_req);
  if (!row || [2, 3, 6, 7].includes(status) || Number(row.open_tasks) > 0) return false;

  return closeRequestGeneral(pool, {
    requestId: params.requestId,
    closedByUserId: params.closedByUserId,
    resolution: 'Solicitud cerrada automáticamente: todos los documentos enviados a firmar quedaron firmados.',
  });
}
