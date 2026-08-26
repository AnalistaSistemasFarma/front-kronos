import { sql, getPool } from '../mssqlPool';
import {
  fireAndForgetNotification,
  notifyNewRequest,
} from '../notificationEvents.js';
import { syncRequestToSapsend } from '../sapsend/treasury.js';

/**
 * Crea una solicitud general e instancia el workflow (tareas, form values, notificaciones).
 * Misma lógica que POST /api/requests-general/create-request.
 *
 * @param {{
 *   company: number,
 *   subject: string,
 *   descripcion: string,
 *   process: number,
 *   createdby: string,
 *   url?: string | null,
 *   formValues?: Array<{ id_field: number, id_option?: number | null, value_text?: string | null }>,
 *   notify?: boolean,
 *   syncSapsend?: boolean,
 * }} input
 * @returns {Promise<{ id_request: number, processEmail: string | null, taskEmails: string[] }>}
 */
export async function createRequestGeneral(input) {
  const {
    company,
    subject,
    descripcion,
    process,
    createdby,
    url,
    formValues,
    notify = true,
    syncSapsend = true,
  } = input;

  if (!company || !subject || !process || !descripcion || !createdby) {
    const err = new Error('Campos obligatorios faltantes');
    err.status = 400;
    throw err;
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const insertRequest = `
      INSERT INTO requests_general (
        description,
        subject_request,
        id_company,
        id_requester,
        status_req,
        url,
        created_at
      )
      OUTPUT INSERTED.id
      VALUES (
        @descripcion,
        @subject,
        @company,
        @createdby,
        1,
        @url,
        GETDATE()
      );
    `;

    const reqInsert = new sql.Request(transaction);
    reqInsert.input('descripcion', sql.NVarChar(1000), descripcion);
    reqInsert.input('subject', sql.NVarChar(255), subject);
    reqInsert.input('company', sql.Int, company);
    reqInsert.input('createdby', sql.NVarChar(255), createdby);
    reqInsert.input('url', sql.NVarChar(1000), url ?? null);

    const insertResult = await reqInsert.query(insertRequest);
    const newRequestId = insertResult.recordset[0].id;

    await new sql.Request(transaction)
      .input('id_request', sql.Int, newRequestId)
      .input('process', sql.Int, process)
      .query(`
        INSERT INTO process_category_request_general
        (id_request_general, id_process_category)
        VALUES (@id_request, @process);
      `);

    const tasksResult = await new sql.Request(transaction)
      .input('process', sql.Int, process)
      .query(`
        SELECT
          tpc.id AS id_task,
          tpc.is_sequential,
          tpc.display_order,
          tpc.is_authorization,
          utrg.id_user,
          u.email
        FROM task_process_category tpc
        LEFT JOIN user_task_request_general utrg
          ON utrg.id_task = tpc.id
        LEFT JOIN [user] u
          ON u.id = utrg.id_user
        WHERE tpc.id_process_category = @process
          AND tpc.active = 1
        ORDER BY tpc.display_order, tpc.id;
      `);

    const taskCondResult = await new sql.Request(transaction)
      .input('process', sql.Int, process)
      .query(`
        SELECT tco.id_task, tco.id_option
        FROM task_condition_option tco
        INNER JOIN task_process_category tpc ON tpc.id = tco.id_task
        WHERE tpc.id_process_category = @process AND tpc.active = 1
      `);

    const taskConditions = {};
    for (const row of taskCondResult.recordset) {
      (taskConditions[row.id_task] ||= []).push(row.id_option);
    }

    const selectedOptions = new Set(
      (Array.isArray(formValues) ? formValues : [])
        .filter((fv) => fv && fv.id_option != null)
        .map((fv) => Number(fv.id_option))
    );

    const taskEligible = (idTask) => {
      const conds = taskConditions[idTask];
      return !conds || conds.length === 0 || conds.some((o) => selectedOptions.has(o));
    };

    const eligibleTaskRows = tasksResult.recordset.filter((r) => taskEligible(r.id_task));

    const orderKey = (r) => [r.display_order ?? 0, r.id_task];
    const firstTaskRow = eligibleTaskRows.reduce((min, r) => {
      if (!min) return r;
      const [ma, mb] = orderKey(min);
      const [ra, rb] = orderKey(r);
      return ra < ma || (ra === ma && rb < mb) ? r : min;
    }, null);
    const firstTaskId = firstTaskRow ? firstTaskRow.id_task : null;

    const shouldCreateNow = (row) => !row.is_sequential || row.id_task === firstTaskId;

    const insertTaskQuery = `
      INSERT INTO task_request_general
      (id_request_general, id_task, id_status, id_assigned)
      VALUES (@id_request, @id_task, 4, @id_user);
    `;

    const createdRows = [];

    for (const row of eligibleTaskRows) {
      if (!shouldCreateNow(row)) continue;

      const hasAssignee = row.id_user != null;
      const isAuthorization = !!row.is_authorization;

      if (!hasAssignee && !isAuthorization) continue;

      await new sql.Request(transaction)
        .input('id_request', sql.Int, newRequestId)
        .input('id_task', sql.Int, row.id_task)
        .input('id_user', sql.NVarChar, hasAssignee ? row.id_user : null)
        .query(insertTaskQuery);

      createdRows.push(row);
    }

    if (Array.isArray(formValues)) {
      for (const fv of formValues) {
        if (!fv || fv.id_field == null) continue;

        await new sql.Request(transaction)
          .input('id_request', sql.Int, newRequestId)
          .input('id_field', sql.Int, fv.id_field)
          .input('id_option', sql.Int, fv.id_option ?? null)
          .input('value_text', sql.NVarChar(sql.MAX), fv.value_text ?? null)
          .query(`
            INSERT INTO request_form_value
            (id_request_general, id_form_field, id_option, value_text)
            VALUES (@id_request, @id_field, @id_option, @value_text)
          `);
      }
    }

    const processUserResult = await new sql.Request(transaction)
      .input('process', sql.Int, process)
      .query(`
        SELECT u.email
        FROM user_process_category_request_general upcrg
        INNER JOIN process_category pc ON pc.id = upcrg.id_process_category
        INNER JOIN [user] u ON u.id = upcrg.id_user
        WHERE pc.id = @process
      `);

    const processEmail = processUserResult.recordset[0]?.email || null;
    const taskEmails = [...new Set(createdRows.map((t) => t.email).filter(Boolean))];

    await transaction.commit();

    if (notify) {
      fireAndForgetNotification(
        notifyNewRequest({
          requestId: newRequestId,
          subject,
          processEmail,
          taskEmails,
          requestUrl: url,
        })
      );
    }

    if (syncSapsend) {
      fireAndForgetNotification(syncRequestToSapsend(newRequestId));
    }

    return {
      id_request: newRequestId,
      processEmail,
      taskEmails,
    };
  } catch (dbError) {
    try {
      await transaction.rollback();
    } catch {
      /* transacción ya abortada o no iniciada */
    }
    throw dbError;
  }
}

/**
 * Idempotencia: busca una solicitud ya creada por la URL externa (Farmadosis).
 * @param {string} url
 * @returns {Promise<number | null>}
 */
export async function findRequestIdByUrl(url) {
  if (!url) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('url', sql.NVarChar(1000), url)
    .query(`SELECT TOP 1 id FROM requests_general WHERE url = @url ORDER BY id DESC`);
  return result.recordset[0]?.id ?? null;
}

/**
 * Nota con el dump completo del formulario (description de la solicitud es NVarChar(1000)).
 * @param {{ id_request: number, note: string, created_by: string }} input
 */
export async function insertRequestNote({ id_request, note, created_by }) {
  if (!id_request || !note || !created_by) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('note', sql.NVarChar(sql.MAX), note)
    .input('id_request', sql.Int, id_request)
    .input('created_by', sql.NVarChar(255), created_by)
    .query(`
      INSERT INTO notes (note, id_request, created_by)
      OUTPUT INSERTED.id_note
      VALUES (@note, @id_request, @created_by);
    `);
  return result.recordset[0]?.id_note ?? null;
}
