import 'server-only';
import sql from 'mssql';

type SqlPool = import('mssql').ConnectionPool;
type SqlExecutor = import('mssql').ConnectionPool | import('mssql').Transaction;

export const ORION_AUTH_TASK_NAME = 'Autorizar firma digital';
export const ORION_SIGN_TASK_NAME = 'Firmar documento';
export const ORION_AUTH_TASK_ORDER = 910;
export const ORION_SIGN_TASK_ORDER = 920;

/**
 * Condición SQL sobre task_process_category: plantillas que crea la integración de firma
 * ("Autorizar firma digital" / "Firmar documento"). No son pasos del flujo del proceso.
 */
export function orionSignatureTemplateSql(tpc = 'tpc'): string {
  return `(
    ISNULL(${tpc}.display_order, 0) IN (${ORION_AUTH_TASK_ORDER}, ${ORION_SIGN_TASK_ORDER})
    AND LOWER(LTRIM(RTRIM(${tpc}.task))) IN (N'${ORION_AUTH_TASK_NAME.toLowerCase()}', N'${ORION_SIGN_TASK_NAME.toLowerCase()}')
  )`;
}

/**
 * Condición SQL: la fila de task_request_general es parte del proceso interno de firma
 * (firmar, autorizar firma o validar documento), no una tarea del flujo de la solicitud.
 * Ese proceso nunca impide cerrar tareas ni solicitudes.
 */
export function orionInternalTaskSql(trg = 'trg', tpc = 'tpc'): string {
  return `(
    CHARINDEX(N'[orionFile:', ISNULL(${trg}.resolution, N'')) > 0
    OR CHARINDEX(N'[orionAuth]', ISNULL(${trg}.resolution, N'')) > 0
    OR CHARINDEX(N'[orionReview]', ISNULL(${trg}.resolution, N'')) > 0
    OR ${orionSignatureTemplateSql(tpc)}
  )`;
}

/** Solicitud cerrada (Resuelto = 2 / Cancelado = 3): no se le crean más tareas de firma. */
export async function isRequestClosedForOrion(pool: SqlPool, requestId: number): Promise<boolean> {
  const result = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`SELECT status_req FROM requests_general WHERE id = @id`);
  const status = Number(result.recordset[0]?.status_req);
  return status === 2 || status === 3;
}

/** Cancela (id_status 3) las tareas abiertas del proceso interno de firma de la solicitud. */
export async function cancelOpenOrionInternalTasks(
  executor: SqlExecutor,
  requestId: number,
  note: string
): Promise<number> {
  const request = executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();
  const result = await request
    .input('id_request', sql.Int, requestId)
    .input('note', sql.NVarChar(sql.MAX), ` ${note}`)
    .query(`
      UPDATE trg
      SET id_status = 3,
          end_date = GETDATE(),
          date_resolution = GETDATE(),
          resolution = CONCAT(ISNULL(trg.resolution, N''), @note)
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id_request
        AND trg.id_status NOT IN (2, 3)
        AND ${orionInternalTaskSql('trg', 'tpc')}
    `);
  return Number(result.rowsAffected?.[0] || 0);
}
