/**
 * Tareas de una solicitud DEVUELTA (status_req = 7).
 *
 * Al devolver, las tareas abiertas (id_status NOT IN (2, 3)) quedaban colgadas en Abierto /
 * Sin empezar y seguían saliendo como pendientes. Se cancelan (3, mismo criterio que la
 * cancelación desde SAPSEND) con una nota fija; al reabrir la solicitud (7 → 1) esa misma nota
 * permite devolverlas a Sin empezar (4), igual que ya se hace con las de autorización.
 * Se llaman dentro de la transacción del cambio de estado.
 */
export const RETURNED_TASK_NOTE = 'Cerrada automáticamente al devolver la solicitud';

export async function closeOpenTasksOnReturn(transaction, requestId) {
  const result = await transaction
    .request()
    .input('id_request', requestId)
    .input('note', RETURNED_TASK_NOTE)
    .query(`
      UPDATE task_request_general
      SET id_status = 3,
          resolution = @note,
          date_resolution = GETDATE()
      WHERE id_request_general = @id_request
        AND id_status NOT IN (2, 3)
    `);
  return result.rowsAffected?.[0] ?? 0;
}

export async function reopenTasksClosedOnReturn(transaction, requestId) {
  const result = await transaction
    .request()
    .input('id_request', requestId)
    .input('note', RETURNED_TASK_NOTE)
    .query(`
      UPDATE task_request_general
      SET id_status = 4,
          resolution = NULL,
          date_resolution = NULL
      WHERE id_request_general = @id_request
        AND id_status = 3
        AND CAST(resolution AS NVARCHAR(MAX)) = @note
    `);
  return result.rowsAffected?.[0] ?? 0;
}
