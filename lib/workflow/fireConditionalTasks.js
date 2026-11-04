import sql from 'mssql';
import { notifyActivityAssigned } from '../notificationEvents.js';
import { orionSignatureTemplateSql } from '../orion/internalTasks';

export async function fireConditionalTasksForRequest(pool, { requestId }) {
  const TAG = '[fireConditionalTasks]';
  const created = [];
  if (!requestId) return created;

  try {
    const procResult = await new sql.Request(pool)
      .input('id', sql.Int, requestId)
      .query(`
        SELECT TOP 1 pcrg.id_process_category, rg.subject_request
        FROM requests_general rg
        LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        WHERE rg.id = @id
      `);
    const procRow = procResult.recordset[0];
    const idProcess = procRow?.id_process_category;
    if (!idProcess) {
      console.log(`${TAG} Solicitud ${requestId} sin proceso asociado; nada que disparar.`);
      return created;
    }
    const subject = procRow.subject_request;

    const tasksResult = await new sql.Request(pool)
      .input('process', sql.Int, idProcess)
      .query(`
        SELECT
          tpc.id AS id_task,
          tpc.task,
          tpc.is_sequential,
          tpc.display_order,
          tpc.is_authorization,
          utrg.id_user,
          u.email
        FROM task_process_category tpc
        LEFT JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
        LEFT JOIN [user] u ON u.id = utrg.id_user
        WHERE tpc.id_process_category = @process
          AND tpc.active = 1
          AND NOT ${orionSignatureTemplateSql('tpc')}
        ORDER BY tpc.display_order, tpc.id
      `);

    const condResult = await new sql.Request(pool)
      .input('process', sql.Int, idProcess)
      .query(`
        SELECT tco.id_task, tco.id_option
        FROM task_condition_option tco
        INNER JOIN task_process_category tpc ON tpc.id = tco.id_task
        WHERE tpc.id_process_category = @process AND tpc.active = 1
      `);
    const taskConditions = {}; // id_task -> [id_option]
    for (const row of condResult.recordset) {
      (taskConditions[row.id_task] ||= []).push(row.id_option);
    }

    const selResult = await new sql.Request(pool)
      .input('id', sql.Int, requestId)
      .query(`
        SELECT id_option
        FROM request_form_value
        WHERE id_request_general = @id AND id_option IS NOT NULL
      `);
    const selectedOptions = new Set(selResult.recordset.map((r) => Number(r.id_option)));

    const taskEligible = (idTask) => {
      const conds = taskConditions[idTask];
      return !conds || conds.length === 0 || conds.some((o) => selectedOptions.has(o));
    };

    const eligibleRows = tasksResult.recordset.filter((r) => taskEligible(r.id_task));

    const orderKey = (r) => [r.display_order ?? 0, r.id_task];
    const firstTaskRow = eligibleRows.reduce((min, r) => {
      if (!min) return r;
      const [ma, mb] = orderKey(min);
      const [ra, rb] = orderKey(r);
      return ra < ma || (ra === ma && rb < mb) ? r : min;
    }, null);
    const firstTaskId = firstTaskRow ? firstTaskRow.id_task : null;
    const shouldCreateNow = (row) => !row.is_sequential || row.id_task === firstTaskId;

    const byTask = new Map();
    for (const row of eligibleRows) {
      if (!byTask.has(row.id_task)) {
        byTask.set(row.id_task, {
          id_task: row.id_task,
          task: row.task,
          is_sequential: row.is_sequential,
          is_authorization: !!row.is_authorization,
          display_order: row.display_order,
          assignees: [],
        });
      }
      if (row.id_user != null) {
        byTask.get(row.id_task).assignees.push({ id_user: row.id_user, email: row.email });
      }
    }

    for (const t of byTask.values()) {
      if (!shouldCreateNow(t)) continue;

      const existsResult = await new sql.Request(pool)
        .input('id_request', sql.Int, requestId)
        .input('id_task', sql.Int, t.id_task)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM task_request_general
          WHERE id_request_general = @id_request AND id_task = @id_task
        `);
      if ((existsResult.recordset[0]?.cnt ?? 0) > 0) continue;

      if (t.assignees.length === 0) {
        if (t.is_authorization) {
          const inserted = await new sql.Request(pool)
            .input('id_request', sql.Int, requestId)
            .input('id_task', sql.Int, t.id_task)
            .query(`
              INSERT INTO task_request_general
              (id_request_general, id_task, id_status, id_assigned)
              OUTPUT INSERTED.id
              VALUES (@id_request, @id_task, 4, NULL)
            `);
          const newTaskId = inserted.recordset[0]?.id;
          created.push({ id_task: t.id_task, newTaskId, userId: null });
          console.log(`${TAG} ✔ Creada task_request_general id=${newTaskId} (autorización sin responsable).`);
        }
        continue;
      }

      const createdForTask = [];
      for (const a of t.assignees) {
        const inserted = await new sql.Request(pool)
          .input('id_request', sql.Int, requestId)
          .input('id_task', sql.Int, t.id_task)
          .input('id_user', sql.NVarChar, a.id_user)
          .query(`
            INSERT INTO task_request_general
            (id_request_general, id_task, id_status, id_assigned)
            OUTPUT INSERTED.id
            VALUES (@id_request, @id_task, 4, @id_user)
          `);
        const newTaskId = inserted.recordset[0]?.id;
        createdForTask.push({ newTaskId, userId: a.id_user, email: a.email, taskName: t.task });
        created.push({ id_task: t.id_task, newTaskId, userId: a.id_user });
      }

      await Promise.all(
        createdForTask.map((ct) =>
          notifyActivityAssigned({
            taskId: ct.newTaskId,
            userId: ct.userId,
            requestId,
            subject,
            taskName: ct.taskName,
          }).catch((notifyErr) => {
            console.error(`${TAG} ✖ Error notificando a ${ct.email || ct.userId}:`, notifyErr);
          })
        )
      );
    }
  } catch (err) {
    console.error(`${TAG} ✖ Error disparando tareas condicionadas de la solicitud ${requestId}:`, err);
  }

  return created;
}
