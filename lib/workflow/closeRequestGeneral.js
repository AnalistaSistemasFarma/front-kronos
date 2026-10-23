import sql from 'mssql';
import {
  fireAndForgetNotification,
  isRequestClosedStatus,
  notifyRequestClosed,
} from '../notificationEvents.js';
import { cancelOpenOrionInternalTasks } from '../orion/internalTasks';
import { closeLinkedOriginTask } from './closeLinkedOriginTask.js';

export async function closeRequestGeneral(
  pool,
  { requestId, closedByUserId, resolution, mirroredStatus = 2 }
) {
  const TAG = '[closeRequestGeneral]';
  if (!requestId) return false;

  try {
    const prevResult = await new sql.Request(pool)
      .input('id', sql.Int, requestId)
      .query(`
        SELECT status_req, subject_request, id_requester, id_origin_task
        FROM requests_general
        WHERE id = @id
      `);
    const prevRow = prevResult.recordset[0];

    if (!prevRow) {
      console.warn(`${TAG} Solicitud ${requestId} no encontrada.`);
      return false;
    }
    if (isRequestClosedStatus(prevRow.status_req)) {
      console.log(`${TAG} Solicitud ${requestId} ya estaba cerrada (${prevRow.status_req}); nada que hacer.`);
      return false;
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await new sql.Request(transaction)
        .input('id', sql.Int, requestId)
        .input('status', sql.Int, mirroredStatus)
        .input('resolucion', sql.NVarChar(255), resolution ?? null)
        .input('id_executor_final', sql.NVarChar(1000), closedByUserId ?? null)
        .query(`
          UPDATE requests_general
          SET status_req = @status,
              resolution = @resolucion,
              id_executor_final = @id_executor_final,
              date_resolution = GETDATE()
          WHERE id = @id AND status_req NOT IN (2, 3)
        `);

      await cancelOpenOrionInternalTasks(
        transaction,
        requestId,
        'Solicitud cerrada automáticamente: el proceso de firma ya no queda como tarea pendiente.'
      );

      if (resolution) {
        await new sql.Request(transaction)
          .input('note', sql.Text, resolution)
          .input('id_request', sql.Int, requestId)
          .input('created_by', sql.NVarChar, closedByUserId ?? null)
          .query(`
            INSERT INTO notes (note, id_request, created_by)
            VALUES (@note, @id_request, @created_by)
          `);
      }

      await transaction.commit();
    } catch (dbError) {
      await transaction.rollback();
      throw dbError;
    }

    console.log(`${TAG} Solicitud ${requestId} cerrada con estado ${mirroredStatus}.`);

    fireAndForgetNotification(
      notifyRequestClosed({
        requestId,
        subject: prevRow.subject_request,
        requesterUserId: prevRow.id_requester,
        statusId: mirroredStatus,
      })
    );

    if (prevRow.id_origin_task) {
      fireAndForgetNotification(
        closeLinkedOriginTask(pool, {
          originTaskId: prevRow.id_origin_task,
          mirroredStatus,
          closedByUserId,
          linkedRequestId: requestId,
        })
      );
    }

    return true;
  } catch (err) {
    console.error(`${TAG} Error cerrando la solicitud ${requestId}:`, err);
    return false;
  }
}
