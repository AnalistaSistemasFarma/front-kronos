import sql from 'mssql';
import { advanceSequentialTask } from './advanceSequentialTask.js';
import { closeRequestGeneral } from './closeRequestGeneral.js';
import { orionInternalTaskSql } from '../orion/internalTasks';

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ originTaskId:number, mirroredStatus:number, closedByUserId?:string|null,
 *           linkedRequestId:number }} params
 */
export async function closeLinkedOriginTask(pool, { originTaskId, mirroredStatus, closedByUserId, linkedRequestId }) {
  const TAG = '[closeLinkedOriginTask]';
  if (!originTaskId) return;

  try {
    const prevResult = await new sql.Request(pool)
      .input('id', sql.Int, originTaskId)
      .query(`
        SELECT trg.id, trg.id_task, trg.id_request_general, trg.id_status,
               tpc.display_order, tpc.task, tpc.closes_request, pcrg.id_process_category, rg.subject_request
        FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
        LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        WHERE trg.id = @id
      `);
    const prevRow = prevResult.recordset[0];

    if (!prevRow) {
      console.warn(`${TAG} Tarea de origen ${originTaskId} no encontrada.`);
      return;
    }
    if ([2, 3].includes(Number(prevRow.id_status))) {
      console.log(`${TAG} Tarea de origen ${originTaskId} ya estaba cerrada (${prevRow.id_status}); nada que hacer.`);
      return;
    }

    const detalle = `Cerrada automáticamente por el cierre de la solicitud #${linkedRequestId}`;
    await new sql.Request(pool)
      .input('id', sql.Int, originTaskId)
      .input('id_status', sql.Int, mirroredStatus)
      .input('resolution', sql.NVarChar(1000), detalle)
      .input('id_executor_final', sql.NVarChar(1000), closedByUserId ?? null)
      .query(`
        UPDATE task_request_general
        SET id_status = @id_status,
            resolution = @resolution,
            date_resolution = GETDATE(),
            end_date = GETDATE(),
            id_executor_final = @id_executor_final
        WHERE id = @id
      `);
    console.log(`${TAG} Tarea de origen ${originTaskId} cerrada con estado ${mirroredStatus}.`);

    if (Number(mirroredStatus) === 2) {
      await advanceSequentialTask(pool, {
        id_request_general: prevRow.id_request_general,
        id_task: prevRow.id_task,
        id_process_category: prevRow.id_process_category,
        display_order: prevRow.display_order,
        subject_request: prevRow.subject_request,
      });

      // Igual que update-activities: si la tarea de origen «cierra la solicitud» y ya no queda
      // nada abierto (sin contar la firma interna de Orion), se cierra la solicitud madre.
      // Antes no se miraba aquí y la madre quedaba abierta (p. ej. Documental Proveedores).
      if (prevRow.closes_request) {
        const open = await new sql.Request(pool)
          .input('id_request', sql.Int, prevRow.id_request_general)
          .query(`
            SELECT COUNT(*) AS n
            FROM task_request_general trg
            INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
            WHERE trg.id_request_general = @id_request
              AND trg.id_status NOT IN (2, 3)
              AND NOT ${orionInternalTaskSql('trg', 'tpc')}
          `);
        const openTasks = Number(open.recordset[0]?.n ?? 0);
        console.log(`${TAG} closes_request=1; tareas abiertas restantes = ${openTasks}.`);
        if (openTasks === 0) {
          await closeRequestGeneral(pool, {
            requestId: prevRow.id_request_general,
            closedByUserId: closedByUserId ?? null,
            resolution: `Cerrada automáticamente al cerrarse la tarea «${prevRow.task}» (solicitud #${linkedRequestId}).`,
          });
        }
      }
    }
  } catch (err) {
    console.error(`${TAG} Error cerrando la tarea de origen ${originTaskId}:`, err);
  }
}
