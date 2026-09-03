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
      skip_sequential_gate,
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
          SELECT trg.id_status, trg.id_request_general, trg.id_task, trg.resolution,
                 rg.subject_request,
                 tpc.task, tpc.is_sequential, tpc.display_order, tpc.id_process_category,
                 tpc.is_authorization, taut.type_authorization,
                 pc.process, cr.category
          FROM task_request_general trg
          INNER JOIN requests_general rg ON rg.id = trg.id_request_general
          LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
          LEFT JOIN types_authorization taut ON taut.id = tpc.type_authorization
          LEFT JOIN process_category pc ON pc.id = tpc.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE trg.id = @id
        `);
      const prevRow = prevResult.recordset[0];
      const resolutionText = String(prevRow?.resolution || '');
      const typeAuth = String(prevRow?.type_authorization || '').toLowerCase();
      const taskName = String(prevRow?.task || '').toLowerCase();
      const processName = String(prevRow?.process || '').toLowerCase();
      const categoryName = String(prevRow?.category || '').toLowerCase();
      const isAuthorizationTask =
        Number(prevRow?.is_authorization) === 1 || prevRow?.is_authorization === true;
      const isSequentialTask =
        Number(prevRow?.is_sequential) === 1 || prevRow?.is_sequential === true;
      const isOrionSignerAuth =
        resolutionText.includes('[orionAuth]') || resolutionText.includes('[orionFile:');
      const isFirmaProcess =
        typeAuth.includes('firma') ||
        taskName.includes('firma') ||
        taskName.includes('previa') ||
        processName.includes('firma') ||
        categoryName.includes('firma');
      const isFirmaAuthorization =
        isOrionSignerAuth || isFirmaProcess || (isAuthorizationTask && Boolean(skip_sequential_gate));

      console.log(`${TAG} 1) Tarea actual (prevRow) =`, {
        id_task: prevRow?.id_task,
        id_request_general: prevRow?.id_request_general,
        id_status_actual: prevRow?.id_status,
        is_sequential: prevRow?.is_sequential,
        display_order: prevRow?.display_order,
        id_process_category: prevRow?.id_process_category,
        task: prevRow?.task,
        isOrionSignerAuth,
        isFirmaAuthorization,
        isAuthorizationTask,
      });

      // Gate secuencial: no aplica a autorizaciones FIRMA/Orion (por firmante / Fase B).
      // Tampoco a cualquier is_authorization: el inbox de Autorizar no debe 409
      // porque una tarea operativa anterior siga abierta.
      if (isSequentialTask && !isFirmaAuthorization && !isAuthorizationTask) {
        const predResult = await new sql.Request(transaction)
          .input('id_request', sql.Int, prevRow.id_request_general)
          .input('display_order', sql.Int, prevRow.display_order ?? 0)
          .input('id_task', sql.Int, prevRow.id_task)
          .query(`
            SELECT TOP 1 trg2.id_status, tpc2.is_authorization, trg2.resolution
            FROM task_request_general trg2
            INNER JOIN task_process_category tpc2 ON tpc2.id = trg2.id_task
            WHERE trg2.id_request_general = @id_request
              AND (
                ISNULL(tpc2.display_order, 0) < @display_order
                OR (ISNULL(tpc2.display_order, 0) = @display_order AND trg2.id_task < @id_task)
              )
            ORDER BY ISNULL(tpc2.display_order, 0) DESC, trg2.id_task DESC
          `);
        const pred = predResult.recordset[0];
        const predStatus = pred?.id_status ?? null;
        const predIsAuth =
          Number(pred?.is_authorization) === 1 || pred?.is_authorization === true;
        const predIsOrion =
          String(pred?.resolution || '').includes('[orionAuth]') ||
          String(pred?.resolution || '').includes('[orionFile:');
        console.log(`${TAG} 2) Gate secuencial: estado de la tarea anterior =`, predStatus, {
          predIsAuth,
          predIsOrion,
        });
        // Si la anterior no es autorización de cadena (p. ej. tarea de firma abierta), no bloquear.
        if (
          predStatus !== null &&
          predStatus !== 2 &&
          predStatus !== 3 &&
          predIsAuth &&
          !predIsOrion
        ) {
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
        console.log(
          `${TAG} 2) Gate secuencial: omitido.`,
          isAuthorizationTask ? '(tarea de autorización)' : isFirmaAuthorization ? '(FIRMA/Orion)' : '(no secuencial)'
        );
      }

      // Para tareas de autorización, además de registrar al ejecutor final, se asigna la tarea
      // al autorizador (id_assigned), se sellan start_date/end_date y la fecha de resolución
      // (date_resolution) con la fecha actual, tanto al autorizar como al rechazar. Para el resto
      // de actividades el comportamiento permanece igual (start_date/end_date/id_assigned según el
      // body; date_resolution solo si hay resolución).
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
        // Al autorizar Orion se envía null: conservar marcadores [orionFile]/[orionAuth]
        resolution !== null && resolution !== undefined
          ? resolution
          : prevRow?.resolution ?? null
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

      // Creación diferida de la siguiente tarea secuencial.
      // Auths Orion por firmante no avanzan el workflow Fase B.
      if (justClosed && !isFirmaAuthorization) {
        await advanceSequentialTask(pool, {
          id_request_general: prevRow.id_request_general,
          id_task: prevRow.id_task,
          id_process_category: prevRow.id_process_category,
          display_order: prevRow.display_order,
          subject_request: prevRow.subject_request,
        });
      } else if (justClosed && isFirmaAuthorization) {
        console.log(`${TAG} 5b) Auth FIRMA/Orion: no se avanza workflow secuencial.`);
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
