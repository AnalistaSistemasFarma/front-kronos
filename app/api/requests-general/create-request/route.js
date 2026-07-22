import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";
import {
  fireAndForgetNotification,
  notifyNewRequest,
} from "../../../../lib/notificationEvents.js";

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
      reqInsert.input("createdby", sql.NVarChar(255), createdby);
      reqInsert.input("url", sql.NVarChar(1000), url);

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

      // Creación diferida (lazy) de tareas secuenciales: al crear la solicitud solo se
      // instancian las tareas NO secuenciales (paralelas) + la PRIMERA del orden. Cada tarea
      // secuencial posterior se crea recién cuando su tarea anterior se cierra (ver update-activities).
      const orderKey = (r) => [r.display_order ?? 0, r.id_task];
      const firstTaskRow = tasksResult.recordset.reduce((min, r) => {
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

      for (const row of tasksResult.recordset) {

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
            .input("value_text", sql.NVarChar(1000), fv.value_text ?? null)
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
