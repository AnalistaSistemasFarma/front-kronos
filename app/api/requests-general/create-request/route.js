import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";

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

      reqInsert.input("descripcion", sql.NVarChar(255), descripcion);
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

      const getTasksQuery = `
        SELECT
          tpc.id AS id_task,
          utrg.id_user,
          u.email
        FROM user_task_request_general utrg
        INNER JOIN task_process_category tpc
          ON tpc.id = utrg.id_task
        INNER JOIN [user] u
          ON u.id = utrg.id_user
        WHERE tpc.id_process_category = @process;
      `;

      const tasksResult = await new sql.Request(transaction)
        .input("process", sql.Int, process)
        .query(getTasksQuery);

      const insertTaskQuery = `
        INSERT INTO task_request_general
        (id_request_general, id_task, id_status, id_assigned)
        VALUES (@id_request, @id_task, 4, @id_user);
      `;

      for (const row of tasksResult.recordset) {

        await new sql.Request(transaction)
          .input("id_request", sql.Int, newRequestId)
          .input("id_task", sql.Int, row.id_task)
          .input("id_user", sql.NVarChar, row.id_user)
          .query(insertTaskQuery);

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
        ...new Set(tasksResult.recordset.map(t => t.email))
      ];

      await transaction.commit();

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
