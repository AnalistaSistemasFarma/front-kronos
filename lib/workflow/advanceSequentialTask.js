import sql from 'mssql';
import { notifyActivityAssigned } from '../notificationEvents.js';

/**
 * Creación diferida (lazy) de la siguiente tarea secuencial: cuando una tarea se cierra
 * (Resuelto=2 o Cancelado=3) y todas sus instancias quedan cerradas, si la siguiente tarea del
 * orden es secuencial y aún no existe en la solicitud, se instancia ahora (estado 4) y se notifica
 * a su(s) responsable(s).
 *
 * Extraído tal cual desde app/api/requests-general/update-activities/route.js para reutilizarlo
 * (botón del tablero + endpoint entrante de SAPSEND) sin duplicar ni divergir.
 *
 * No lanza: cualquier error se registra y se traga (la resolución ya está confirmada).
 *
 * @param {import('mssql').ConnectionPool} pool  pool de mssql ya conectado
 * @param {{ id_request_general:number, id_task:number, id_process_category:number|null,
 *           display_order:number|null, subject_request:string|null }} prevRow
 */
export async function advanceSequentialTask(pool, prevRow) {
  const TAG = '[advanceSequentialTask]';

  if (prevRow?.id_process_category == null) {
    console.log(`${TAG} Tarea cerrada pero sin id_process_category; no se evalúa creación diferida.`);
    return;
  }

  console.log(`${TAG} Evaluando creación diferida de la SIGUIENTE tarea del proceso ${prevRow.id_process_category}...`);
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
    console.log(`${TAG} Instancias de la tarea actual aún abiertas = ${stillOpen} (debe ser 0 para continuar).`);

    if (stillOpen === 0) {
      // 2. Buscar la siguiente tarea del template (por display_order, id).
      const nextResult = await new sql.Request(pool)
        .input('id_process', sql.Int, prevRow.id_process_category)
        .input('display_order', sql.Int, prevRow.display_order ?? 0)
        .input('id_task', sql.Int, prevRow.id_task)
        .input('id_request', sql.Int, prevRow.id_request_general)
        .query(`
          SELECT TOP 1 tpc.id, tpc.task, tpc.is_sequential, tpc.is_authorization
          FROM task_process_category tpc
          WHERE tpc.id_process_category = @id_process
            AND tpc.active = 1
            AND (
              ISNULL(tpc.display_order, 0) > @display_order
              OR (ISNULL(tpc.display_order, 0) = @display_order AND tpc.id > @id_task)
            )
            AND (
              NOT EXISTS (SELECT 1 FROM task_condition_option tco WHERE tco.id_task = tpc.id)
              OR EXISTS (
                SELECT 1 FROM task_condition_option tco
                INNER JOIN request_form_value rfv ON rfv.id_option = tco.id_option
                WHERE tco.id_task = tpc.id AND rfv.id_request_general = @id_request
              )
            )
          ORDER BY ISNULL(tpc.display_order, 0), tpc.id
        `);
      const nextTask = nextResult.recordset[0];
      console.log(`${TAG} Siguiente tarea del template =`, nextTask
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
        console.log(`${TAG} ¿La siguiente tarea ya existe en la solicitud? alreadyExists =`, alreadyExists);

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

          console.log(`${TAG} Responsables de la siguiente tarea =`,
            assigneesResult.recordset.map((a) => ({ id_user: a.id_user, email: a.email })));

          const createdTasks = [];

          if (assigneesResult.recordset.length === 0) {
            if (nextTask.is_authorization) {
              // Tarea de autorización sin responsable: se instancia igual con id_assigned = NULL.
              // Por ahora no se enruta a ningún autorizador, así que no hay a quién notificar.
              const inserted = await new sql.Request(pool)
                .input('id_request', sql.Int, prevRow.id_request_general)
                .input('id_task', sql.Int, nextTask.id)
                .query(`
                  INSERT INTO task_request_general
                  (id_request_general, id_task, id_status, id_assigned)
                  OUTPUT INSERTED.id
                  VALUES (@id_request, @id_task, 4, NULL)
                `);
              const newTaskId = inserted.recordset[0]?.id;
              console.log(`${TAG} ✔ Creada task_request_general id=${newTaskId} de AUTORIZACIÓN sin responsable (sin notificación).`);
            } else {
              console.warn(
                `${TAG} ⚠ La siguiente tarea ${nextTask.id} no tiene responsable con email; no se crea/notifica.`
              );
            }
          } else {
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
              console.log(`${TAG} ✔ Creada task_request_general id=${newTaskId} para responsable ${a.email} (${a.id_user}).`);
              createdTasks.push({ newTaskId, userId: a.id_user, email: a.email });
            }
          }

          // Registrar la notificación en la campana de forma GARANTIZADA (se espera antes de
          // responder), para que no se pierda como pasaría con fire-and-forget en serverless.
          await Promise.all(
            createdTasks.map((ct) => {
              console.log(`${TAG} 🔔 Enviando notificación de "Actividad asignada" a ${ct.email} (task ${ct.newTaskId})...`);
              return notifyActivityAssigned({
                taskId: ct.newTaskId,
                userId: ct.userId,
                requestId: prevRow.id_task,
                subject: prevRow.subject_request,
                taskName: nextTask.task,
              })
                .then((res) => {
                  console.log(`${TAG} ✔ Notificación a ${ct.email} =>`, res);
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
}
