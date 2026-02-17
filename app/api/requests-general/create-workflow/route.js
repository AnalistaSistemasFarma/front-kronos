import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      id_company,
      id_category,
      process,
      task,
      cost_center_pc,
      cost_center_t,
      cost,
      id_user
    } = body;


    /* =========================
       VALIDACIÓN
    ========================= */

    if (
      !id_category ||
      !process ||
      !id_company ||
      !task ||
      !id_user
    ) {
      return new Response(
        JSON.stringify({
          error: "Campos obligatorios faltantes",
        }),
        { status: 400 }
      );
    }


    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);


    try {
      await transaction.begin();

      /* =========================
         3️⃣ INSERT PROCESS
      ========================= */

      const insertProcessQuery = `
        INSERT INTO process_category
        (
          process,
          id_category_request,
          active,
          id_status,
          cost_center
        )
        OUTPUT INSERTED.id
        VALUES
        (
          @process,
          @id_category,
          0,
          6,
          @cost_center_pc
        );
      `;

      const processRequest = new sql.Request(transaction);

      processRequest.input("process", sql.NVarChar(1000), process);
      processRequest.input("id_category", sql.Int, id_category);
      processRequest.input("cost_center_pc", sql.NVarChar(1000), cost_center_pc || null);

      const processResult =
        await processRequest.query(insertProcessQuery);

      const processId = processResult.recordset[0].id;


      /* =========================
         4️⃣ USER - PROCESS
      ========================= */

      const insertUserProcessQuery = `
        INSERT INTO user_process_category_request_general
        (id_process_category, id_user)
        VALUES (@id_process, @id_user);
      `;

      await new sql.Request(transaction)
        .input("id_process", sql.Int, processId)
        .input("id_user", sql.NVarChar(1000), id_user)
        .query(insertUserProcessQuery);


      /* =========================
        5️⃣ INSERT TASKS (LOOP)
        ========================= */

        for (const t of task) {

        const insertTaskQuery = `
            INSERT INTO task_process_category
            (
            task,
            id_process_category,
            active,
            cost,
            cost_center
            )
            OUTPUT INSERTED.id
            VALUES
            (
            @task,
            @id_process,
            1,
            @cost,
            @cost_center
            );
        `;

        const taskRequest = new sql.Request(transaction);

        taskRequest.input("task", sql.NVarChar(1000), t.task);
        taskRequest.input("id_process", sql.Int, processId);
        taskRequest.input("cost", sql.Numeric(12,0), t.cost || 0);
        taskRequest.input("cost_center", sql.NVarChar(1000), t.cost_center || null);

        const taskResult = await taskRequest.query(insertTaskQuery);

        const taskId = taskResult.recordset[0].id;


        /* =========================
            USER - TASK
        ========================= */

        if (t.id_user) {

            const insertUserTaskQuery = `
            INSERT INTO user_task_request_general
            (id_task, id_user)
            VALUES (@id_task, @id_user);
            `;

            await new sql.Request(transaction)
            .input("id_task", sql.Int, taskId)
            .input("id_user", sql.NVarChar(1000), t.id_user)
            .query(insertUserTaskQuery);
        }

        }


      /* =========================
         COMMIT
      ========================= */

      await transaction.commit();


      return new Response(
        JSON.stringify({
          success: true,
          message: "Flujo creado correctamente",
          data: {
            categoryId,
            processId,
            taskId
          }
        }),
        { status: 201 }
      );


    } catch (dbError) {

      await transaction.rollback();

      console.error("Error transacción:", dbError);

      return new Response(
        JSON.stringify({
          error: "Error creando el flujo",
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
