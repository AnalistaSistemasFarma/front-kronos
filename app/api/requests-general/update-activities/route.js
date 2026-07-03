import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import {
  fireAndForgetNotification,
  isActivityResolvedStatus,
  notifyActivityResolved,
  notifyActivityAssigned,
} from '../../../../lib/notificationEvents.js';

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
                 tpc.task, tpc.is_sequential, tpc.display_order, tpc.id_process_category
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

      const updateQuery = `
        UPDATE task_request_general
        SET
          id_status = @id_status,
          start_date = @start_date,
          end_date = @end_date,
          resolution = @resolution,
          id_executor_final = @id_executor_final,
          date_resolution = CASE
            WHEN @resolution IS NOT NULL
                 AND LTRIM(RTRIM(@resolution)) <> ''
            THEN GETDATE()
            ELSE date_resolution
          END
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

      // Creación diferida (lazy) de la siguiente tarea secuencial: cuando esta tarea se cierra
      // (Resuelto=2 o Cancelado=3), si la siguiente tarea del orden es secuencial y aún no existe
      // en la solicitud, se instancia ahora y se notifica a su(s) responsable(s).
      const CLOSED_STATUSES = [2, 3];
      const justClosed =
        CLOSED_STATUSES.includes(Number(nextStatus)) &&
        !CLOSED_STATUSES.includes(Number(prevStatus));

      console.log(`${TAG} 5) ¿Se acaba de cerrar la tarea? justClosed =`, justClosed, `(prevStatus=${prevStatus} -> nextStatus=${nextStatus})`);

      if (justClosed && prevRow?.id_process_category != null) {
        console.log(`${TAG} 6) Evaluando creación diferida de la SIGUIENTE tarea del proceso ${prevRow.id_process_category}...`);
        try {
          // 1. La tarea actual debe quedar totalmente cerrada (todas sus instancias en 2/3).
          const openResult = await new sql.Request(pool)
            .input('id_request', sql.Int, prevRow.id_request_general)
            .input('id_task', sql.Int, prevRow.id_task)
            .query(`
              SELECT COUNT(*) AS openCount
              FROM task_request_general
              WHERE id_request_general = @id_request
                AND id_task = @id_task
                AND id_status NOT IN (2, 3)
            `);
          const stillOpen = openResult.recordset[0]?.openCount ?? 0;
          console.log(`${TAG} 6.1) Instancias de la tarea actual aún abiertas = ${stillOpen} (debe ser 0 para continuar).`);

          if (stillOpen === 0) {
            // 2. Buscar la siguiente tarea del template (por display_order, id).
            const nextResult = await new sql.Request(pool)
              .input('id_process', sql.Int, prevRow.id_process_category)
              .input('display_order', sql.Int, prevRow.display_order ?? 0)
              .input('id_task', sql.Int, prevRow.id_task)
              .query(`
                SELECT TOP 1 tpc.id, tpc.task, tpc.is_sequential
                FROM task_process_category tpc
                WHERE tpc.id_process_category = @id_process
                  AND tpc.active = 1
                  AND (
                    ISNULL(tpc.display_order, 0) > @display_order
                    OR (ISNULL(tpc.display_order, 0) = @display_order AND tpc.id > @id_task)
                  )
                ORDER BY ISNULL(tpc.display_order, 0), tpc.id
              `);
            const nextTask = nextResult.recordset[0];
            console.log(`${TAG} 6.2) Siguiente tarea del template =`, nextTask
              ? { id: nextTask.id, task: nextTask.task, is_sequential: nextTask.is_sequential }
              : 'NINGUNA (era la última)');

            if (nextTask && nextTask.is_sequential) {
              // 3. Solo crear si aún no tiene instancias en esta solicitud (idempotencia).
              const existsResult = await new sql.Request(pool)
                .input('id_request', sql.Int, prevRow.id_request_general)
                .input('id_task', sql.Int, nextTask.id)
                .query(`
                  SELECT COUNT(*) AS cnt
                  FROM task_request_general
                  WHERE id_request_general = @id_request AND id_task = @id_task
                `);
              const alreadyExists = (existsResult.recordset[0]?.cnt ?? 0) > 0;
              console.log(`${TAG} 6.3) ¿La siguiente tarea ya existe en la solicitud? alreadyExists =`, alreadyExists);

              if (!alreadyExists) {
                // Traer responsable + email (mismo patrón que create-request: el email es lo que
                // se registra en la campana, no el id).
                const assigneesResult = await new sql.Request(pool)
                  .input('id_task', sql.Int, nextTask.id)
                  .query(`
                    SELECT utrg.id_user, u.email
                    FROM user_task_request_general utrg
                    INNER JOIN [user] u ON u.id = utrg.id_user
                    WHERE utrg.id_task = @id_task
                  `);

                console.log(`${TAG} 6.4) Responsables de la siguiente tarea =`,
                  assigneesResult.recordset.map((a) => ({ id_user: a.id_user, email: a.email })));

                if (assigneesResult.recordset.length === 0) {
                  console.warn(
                    `${TAG} ⚠ La siguiente tarea ${nextTask.id} no tiene responsable con email; no se crea/notifica.`
                  );
                }

                const createdTasks = [];
                for (const a of assigneesResult.recordset) {
                  const inserted = await new sql.Request(pool)
                    .input('id_request', sql.Int, prevRow.id_request_general)
                    .input('id_task', sql.Int, nextTask.id)
                    .input('id_user', sql.NVarChar, a.id_user)
                    .query(`
                      INSERT INTO task_request_general
                      (id_request_general, id_task, id_status, id_assigned)
                      OUTPUT INSERTED.id
                      VALUES (@id_request, @id_task, 4, @id_user)
                    `);
                  const newTaskId = inserted.recordset[0]?.id;
                  console.log(`${TAG} 6.5) ✔ Creada task_request_general id=${newTaskId} para responsable ${a.email} (${a.id_user}).`);
                  createdTasks.push({ newTaskId, userId: a.id_user, email: a.email });
                }

                // Registrar la notificación en la campana de forma GARANTIZADA (se espera antes de
                // responder), para que no se pierda como pasaría con fire-and-forget en serverless.
                await Promise.all(
                  createdTasks.map((ct) => {
                    console.log(`${TAG} 6.6) 🔔 Enviando notificación de "Actividad asignada" a ${ct.email} (task ${ct.newTaskId})...`);
                    return notifyActivityAssigned({
                      taskId: ct.newTaskId,
                      userId: ct.userId,
                      requestId: prevRow.id_task,
                      subject: prevRow.subject_request,
                      taskName: nextTask.task,
                    })
                      .then((res) => {
                        console.log(`${TAG} 6.7) ✔ Notificación a ${ct.email} =>`, res);
                      })
                      .catch((notifyErr) => {
                        console.error(
                          `${TAG} ✖ Error notificando a ${ct.email || ct.userId}:`,
                          notifyErr
                        );
                      });
                  })
                );
              }
            }
          }
        } catch (lazyErr) {
          // No romper la respuesta: la actualización ya se confirmó.
          console.error(`${TAG} ✖ Error creando la siguiente tarea secuencial:`, lazyErr);
        }
      } else if (justClosed) {
        console.log(`${TAG} 6) Tarea cerrada pero sin id_process_category; no se evalúa creación diferida.`);
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
