import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";
import {
  fireAndForgetNotification,
  notifyNewRequest,
} from "../../../../lib/notificationEvents.js";
import { syncRequestToSapsend } from "../../../../lib/sapsend/treasury.js";

export async function POST(req) {
  try {
    const body = await req.json();

  const {
      company,
      subject,
      descripcion,
      category,
      process,
      createdby,
      url,
      formValues,
    } = body;

    if (!company || !subject || !process || !descripcion) {
      return new Response(
        JSON.stringify({ message: "Campos obligatorios faltantes" }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
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
          url
        )
        OUTPUT INSERTED.id
        VALUES (
          @descripcion,
          @subject,
          @company,
          @createdby,
          1,
          @url
        );
      `;

      const reqInsert = new sql.Request(transaction);

      reqInsert.input("descripcion", sql.NVarChar(1000), descripcion);
      reqInsert.input("subject", sql.NVarChar(255), subject);
      reqInsert.input("company", sql.Int, company);
      // id_requester se guarda como NVARCHAR: hay que enviar string, no number.
      reqInsert.input(
        "createdby",
        sql.NVarChar(255),
        createdby == null || createdby === ""
          ? null
          : String(createdby),
      );
      reqInsert.input(
        "url",
        sql.NVarChar(1000),
        url == null ? null : String(url),
      );

      const insertResult = await reqInsert.query(insertRequest);

      const newRequestId = insertResult.recordset[0].id;

      const insertProcess = `
        INSERT INTO process_category_request_general
        (id_request_general, id_process_category)
        VALUES (@id_request, @process);
      `;

      await new sql.Request(transaction)
        .input("id_request", sql.Int, newRequestId)
        .input("process", sql.Int, process)
        .query(insertProcess);

      // LEFT JOIN (no INNER): así también aparecen las tareas SIN responsable asignado.
      // Las de autorización sin responsable se instancian igual (id_assigned = NULL); las
      // normales sin responsable se omiten en el loop de abajo.
      const getTasksQuery = `
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
      `;

      const tasksResult = await new sql.Request(transaction)
        .input("process", sql.Int, process)
        .query(getTasksQuery);

      // Condiciones por opción de las tareas (M:N). Una tarea condicionada solo se instancia
      // si se eligió alguna de sus opciones ligadas (OR); sin condiciones se instancia siempre.
      const taskCondResult = await new sql.Request(transaction)
        .input("process", sql.Int, process)
        .query(`
          SELECT tco.id_task, tco.id_option
          FROM task_condition_option tco
          INNER JOIN task_process_category tpc ON tpc.id = tco.id_task
          WHERE tpc.id_process_category = @process AND tpc.active = 1
        `);
      const taskConditions = {}; // id_task -> [id_option]
      for (const row of taskCondResult.recordset) {
        (taskConditions[row.id_task] ||= []).push(row.id_option);
      }
      // Opciones elegidas por el usuario (llegan en el body; aún no están en request_form_value).
      const selectedOptions = new Set(
        (Array.isArray(formValues) ? formValues : [])
          .filter((fv) => fv && fv.id_option != null)
          .map((fv) => Number(fv.id_option))
      );
      const taskEligible = (idTask) => {
        const conds = taskConditions[idTask];
        return !conds || conds.length === 0 || conds.some((o) => selectedOptions.has(o));
      };

      // Solo las tareas elegibles participan en la instanciación y en el cálculo de "la primera".
      const eligibleTaskRows = tasksResult.recordset.filter((r) => taskEligible(r.id_task));

      // Creación diferida (lazy) de tareas secuenciales: al crear la solicitud solo se
      // instancian las tareas NO secuenciales (paralelas) + la PRIMERA del orden. Cada tarea
      // secuencial posterior se crea recién cuando su tarea anterior se cierra (ver update-activities).
      const orderKey = (r) => [r.display_order ?? 0, r.id_task];
      const firstTaskRow = eligibleTaskRows.reduce((min, r) => {
        if (!min) return r;
        const [ma, mb] = orderKey(min);
        const [ra, rb] = orderKey(r);
        return ra < ma || (ra === ma && rb < mb) ? r : min;
      }, null);
      const firstTaskId = firstTaskRow ? firstTaskRow.id_task : null;

      const shouldCreateNow = (row) =>
        !row.is_sequential || row.id_task === firstTaskId;

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

        // Tarea normal sin responsable: no se puede trabajar, se omite (comportamiento previo).
        // Tarea de autorización sin responsable: se crea igual con id_assigned = NULL.
        if (!hasAssignee && !isAuthorization) continue;

        await new sql.Request(transaction)
          .input("id_request", sql.Int, newRequestId)
          .input("id_task", sql.Int, row.id_task)
          .input("id_user", sql.NVarChar, hasAssignee ? row.id_user : null)
          .query(insertTaskQuery);

        createdRows.push(row);

      }

      // Guardar respuestas de los campos condicionales del formulario
      if (Array.isArray(formValues)) {
        for (const fv of formValues) {
          if (!fv || fv.id_field == null) continue;

          await new sql.Request(transaction)
            .input("id_request", sql.Int, newRequestId)
            .input("id_field", sql.Int, fv.id_field)
            .input("id_option", sql.Int, fv.id_option ?? null)
            .input("value_text", sql.NVarChar(sql.MAX), fv.value_text ?? null)
            .query(`
              INSERT INTO request_form_value
              (id_request_general, id_form_field, id_option, value_text)
              VALUES (@id_request, @id_field, @id_option, @value_text)
            `);
        }
      }

      const processUserResult = await new sql.Request(transaction)
        .input("process", sql.Int, process)
        .query(`
          SELECT u.email
          FROM user_process_category_request_general upcrg
          INNER JOIN process_category pc ON pc.id = upcrg.id_process_category
          INNER JOIN [user] u ON u.id = upcrg.id_user
          WHERE pc.id = @process
        `);

      const processEmail = processUserResult.recordset[0]?.email || null;

      const taskEmails = [
        ...new Set(createdRows.map(t => t.email).filter(Boolean))
      ];

      await transaction.commit();

      fireAndForgetNotification(
        notifyNewRequest({
          requestId: newRequestId,
          subject,
          processEmail,
          taskEmails,
          requestUrl: url,
        })
      );

      // Integración SAPSEND: si es una solicitud de pago de tesorería, crea la solicitud de
      // tesorería en SAPSEND. No bloquea ni hace fallar la creación (el gate y el registro de
      // estado/errores viven dentro de syncRequestToSapsend).
      fireAndForgetNotification(syncRequestToSapsend(newRequestId));

      return new Response(
        JSON.stringify({
          message: "Solicitud creada correctamente",
          id_request: newRequestId,
          notifications: {
            processEmail,
            taskEmails
          }
        }),
        { status: 201 }
      );

    } catch (dbError) {

      await transaction.rollback();

      console.error("Error en transacción:", dbError);

      return new Response(
        JSON.stringify({
          error: "Error al crear la solicitud",
          details: dbError.message,
        }),
        { status: 500 }
      );
    }

  } catch (err) {

    console.error("Error general:", err);

    return new Response(
      JSON.stringify({
        error: "Error general",
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
