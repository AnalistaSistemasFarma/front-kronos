import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import {
  fireAndForgetNotification,
  isActivityResolvedStatus,
  notifyActivityResolved,
} from '../../../../lib/notificationEvents.js';
import { syncAuthorizationToSapsend } from '../../../../lib/sapsend/authorizationStatus.js';
import { advanceSequentialTask } from '../../../../lib/workflow/advanceSequentialTask.js';

export async function POST(req) {
  const TAG = '[update-activities]';
  try {
    const body = await req.json();

    const {
      id,
      id_status,
      id_assigned,
      start_date,
      end_date,
      resolution,
    } = body;

    console.log(`${TAG} ▶ POST recibido. body =`, {
      id,
      id_status,
      id_assigned,
      start_date,
      end_date,
      resolution: resolution ? `${String(resolution).slice(0, 40)}...` : resolution,
    });

    if (!id || !id_assigned) {
      console.warn(`${TAG} ✖ Faltan campos obligatorios (id o id_assigned).`);
      return new Response(
        JSON.stringify({
          error: 'Faltan campos obligatorios',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const prevResult = await new sql.Request(transaction)
        .input('id', sql.Int, id)
        .query(`
          SELECT trg.id_status, trg.id_request_general, trg.id_task, rg.subject_request,
                 tpc.task, tpc.is_sequential, tpc.display_order, tpc.id_process_category,
                 tpc.is_authorization
          FROM task_request_general trg
          INNER JOIN requests_general rg ON rg.id = trg.id_request_general
          LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
          WHERE trg.id = @id
        `);
      const prevRow = prevResult.recordset[0];

      console.log(`${TAG} 1) Tarea actual (prevRow) =`, {
        id_task: prevRow?.id_task,
        id_request_general: prevRow?.id_request_general,
        id_status_actual: prevRow?.id_status,
        is_sequential: prevRow?.is_sequential,
        display_order: prevRow?.display_order,
        id_process_category: prevRow?.id_process_category,
        task: prevRow?.task,
      });

      // Gate de tareas secuenciales: si la tarea es secuencial, su predecesora inmediata
      // (por display_order, id_task) debe estar cerrada (2 Resuelto o 3 Cancelado).
      if (prevRow?.is_sequential) {
        const predResult = await new sql.Request(transaction)
          .input('id_request', sql.Int, prevRow.id_request_general)
          .input('display_order', sql.Int, prevRow.display_order ?? 0)
          .input('id_task', sql.Int, prevRow.id_task)
          .query(`
            SELECT TOP 1 trg2.id_status
            FROM task_request_general trg2
            INNER JOIN task_process_category tpc2 ON tpc2.id = trg2.id_task
            WHERE trg2.id_request_general = @id_request
              AND (
                ISNULL(tpc2.display_order, 0) < @display_order
                OR (ISNULL(tpc2.display_order, 0) = @display_order AND trg2.id_task < @id_task)
              )
            ORDER BY ISNULL(tpc2.display_order, 0) DESC, trg2.id_task DESC
          `);
        const predStatus = predResult.recordset[0]?.id_status ?? null;
        console.log(`${TAG} 2) Gate secuencial: estado de la tarea anterior =`, predStatus);
        if (predStatus !== null && predStatus !== 2 && predStatus !== 3) {
          console.warn(`${TAG} ✖ BLOQUEADA: la tarea anterior (estado ${predStatus}) no está cerrada. Respondiendo 409.`);
          await transaction.rollback();
          return new Response(
            JSON.stringify({
              error: 'Debe resolver primero la tarea anterior.',
            }),
            { status: 409 }
          );
        }
      } else {
        console.log(`${TAG} 2) Gate secuencial: la tarea NO es secuencial, no se valida predecesora.`);
      }

      // Para tareas de autorización, además de registrar al ejecutor final, se asigna la tarea
      // al autorizador (id_assigned), se sellan start_date/end_date y la fecha de resolución
      // (date_resolution) con la fecha actual, tanto al autorizar como al rechazar. Para el resto
      // de actividades el comportamiento permanece igual (start_date/end_date/id_assigned según el
      // body; date_resolution solo si hay resolución).
      const isAuthorizationTask = !!prevRow?.is_authorization;

      const updateQuery = `
        UPDATE task_request_general
        SET
          id_status = @id_status,
          start_date = ${isAuthorizationTask ? 'GETDATE()' : '@start_date'},
          end_date = ${isAuthorizationTask ? 'GETDATE()' : '@end_date'},
          resolution = @resolution,
          id_executor_final = @id_executor_final,
          ${isAuthorizationTask ? 'id_assigned = @id_executor_final,' : ''}
          date_resolution = ${
            isAuthorizationTask
              ? 'GETDATE()'
              : `CASE
            WHEN @resolution IS NOT NULL
                 AND LTRIM(RTRIM(@resolution)) <> ''
            THEN GETDATE()
            ELSE date_resolution
          END`
          }
        WHERE id = @id
      `;

      const request = new sql.Request(transaction);

      request.input('id', sql.Int, id);
      request.input('id_status', sql.Int, id_status);

      request.input(
        'start_date',
        sql.DateTime,
        start_date ? new Date(start_date) : null
      );

      request.input(
        'end_date',
        sql.DateTime,
        end_date ? new Date(end_date) : null
      );

      request.input(
        'resolution',
        sql.NVarChar(sql.MAX),
        resolution
      );

      request.input(
        'id_executor_final',
        sql.NVarChar(1000),
        id_assigned
      );

      await request.query(updateQuery);

      await transaction.commit();
      console.log(`${TAG} 3) UPDATE + commit OK. Tarea ${id} pasó a estado ${id_status}.`);

      const prevStatus = prevRow?.id_status ?? null;
      const nextStatus = id_status ?? null;

      if (isActivityResolvedStatus(nextStatus) && !isActivityResolvedStatus(prevStatus)) {
        console.log(`${TAG} 4) Notificando "Actividad resuelta" a los interesados de la solicitud ${prevRow?.id_request_general}.`);
        fireAndForgetNotification(
          notifyActivityResolved({
            taskId: id,
            requestId: prevRow?.id_request_general,
            subject: prevRow?.subject_request,
            taskName: prevRow?.task,
            executorUserId: id_assigned,
          })
        );
      }

      // SAPSEND: si es una tarea de autorización de tesorería que se autorizó (2) o rechazó (3),
      // aplicar la misma decisión en SAPSEND. No bloquea; el gate (¿es de tesorería?) vive dentro.
      if (isAuthorizationTask && (Number(nextStatus) === 2 || Number(nextStatus) === 3)) {
        fireAndForgetNotification(
          syncAuthorizationToSapsend(
            prevRow?.id_request_general,
            Number(nextStatus) === 2,
            id_assigned,
            resolution
          )
        );
      }

      // Nota en la bitácora de la solicitud cuando se resuelve una tarea de AUTORIZACIÓN, a nombre del
      // autorizador (id_assigned): "Solicitud Autorizada" / "Solicitud Rechazada: <motivo>". No rompe la
      // respuesta si falla (la tarea ya se actualizó).
      if (isAuthorizationTask && (Number(nextStatus) === 2 || Number(nextStatus) === 3)) {
        try {
          const reason = resolution ? String(resolution).trim() : '';
          const noteText =
            Number(nextStatus) === 2
              ? 'Solicitud Autorizada'
              : reason
                ? `Solicitud Rechazada: ${reason}`
                : 'Solicitud Rechazada';

          await new sql.Request(pool)
            .input('note', sql.Text, noteText)
            .input('id_request', sql.Int, prevRow?.id_request_general)
            .input('created_by', sql.NVarChar, id_assigned)
            .query(`
              INSERT INTO notes (note, id_request, created_by)
              VALUES (@note, @id_request, @created_by)
            `);
        } catch (noteErr) {
          console.error(`${TAG} ✖ Error insertando la nota de autorización:`, noteErr);
        }
      }

      // Creación diferida (lazy) de la siguiente tarea secuencial: cuando esta tarea se cierra
      // (Resuelto=2 o Cancelado=3), si la siguiente tarea del orden es secuencial y aún no existe
      // en la solicitud, se instancia ahora y se notifica a su(s) responsable(s).
      const CLOSED_STATUSES = [2, 3];
      const justClosed =
        CLOSED_STATUSES.includes(Number(nextStatus)) &&
        !CLOSED_STATUSES.includes(Number(prevStatus));

      console.log(`${TAG} 5) ¿Se acaba de cerrar la tarea? justClosed =`, justClosed, `(prevStatus=${prevStatus} -> nextStatus=${nextStatus})`);

      // Creación diferida de la siguiente tarea secuencial (extraída a un helper compartido para
      // reutilizarla también en el endpoint entrante de SAPSEND). Comportamiento idéntico.
      if (justClosed) {
        await advanceSequentialTask(pool, {
          id_request_general: prevRow.id_request_general,
          id_task: prevRow.id_task,
          id_process_category: prevRow.id_process_category,
          display_order: prevRow.display_order,
          subject_request: prevRow.subject_request,
        });
      }

      console.log(`${TAG} ✅ Respondiendo 200 (tarea ${id} actualizada).`);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Tarea actualizada correctamente',
        }),
        { status: 200 }
      );

    } catch (err) {
      await transaction.rollback();

      console.error(`${TAG} ✖ DB Error (rollback):`, err);

      return new Response(
        JSON.stringify({
          error: 'Error al actualizar en BD',
          details: err.message,
        }),
        { status: 500 }
      );
    }

  } catch (err) {
    console.error(`${TAG} ✖ Server Error:`, err);

    return new Response(
      JSON.stringify({
        error: 'Error del servidor',
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
