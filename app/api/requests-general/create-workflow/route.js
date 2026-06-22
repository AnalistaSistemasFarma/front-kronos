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
      files,
      formFields,
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
        6️⃣ INSERT CAMPOS CONDICIONALES (LOOP)
        Construye un mapa tempId(opción) -> id real para resolver la condición
        de los archivos más abajo.
        ========================= */

        const optionTempToId = {};

        if (Array.isArray(formFields)) {
          let fieldOrder = 0;
          for (const field of formFields) {
            if (!field.field_label || !field.field_label.trim()) continue;

            const insertFieldQuery = `
              INSERT INTO process_form_field
              (id_process_category, field_label, field_type, required, active, display_order)
              OUTPUT INSERTED.id
              VALUES (@id_process, @field_label, @field_type, @required, 1, @display_order);
            `;

            const fieldResult = await new sql.Request(transaction)
              .input("id_process", sql.Int, processId)
              .input("field_label", sql.NVarChar(255), field.field_label)
              .input("field_type", sql.NVarChar(30), field.field_type || "select")
              .input("required", sql.Bit, field.required ? 1 : 0)
              .input("display_order", sql.Int, fieldOrder++)
              .query(insertFieldQuery);

            const fieldId = fieldResult.recordset[0].id;

            if (Array.isArray(field.options)) {
              let optionOrder = 0;
              for (const opt of field.options) {
                if (!opt.option_label || !opt.option_label.trim()) continue;

                const insertOptionQuery = `
                  INSERT INTO process_form_field_option
                  (id_form_field, option_label, active, display_order)
                  OUTPUT INSERTED.id
                  VALUES (@id_form_field, @option_label, 1, @display_order);
                `;

                const optionResult = await new sql.Request(transaction)
                  .input("id_form_field", sql.Int, fieldId)
                  .input("option_label", sql.NVarChar(255), opt.option_label)
                  .input("display_order", sql.Int, optionOrder++)
                  .query(insertOptionQuery);

                if (opt.tempId !== undefined && opt.tempId !== null) {
                  optionTempToId[opt.tempId] = optionResult.recordset[0].id;
                }
              }
            }
          }
        }

      /* =========================
        7️⃣ INSERT ARCHIVOS REQUERIDOS (LOOP)
        ========================= */

        if (Array.isArray(files)) {
          let order = 0;
          for (const f of files) {
            if (!f.file_label || !f.file_label.trim()) continue;

            const conditionOptionId =
              f.condition_option_temp !== undefined && f.condition_option_temp !== null
                ? optionTempToId[f.condition_option_temp] ?? null
                : null;

            const insertFileQuery = `
              INSERT INTO file_process_category
              (id_process_category, file_label, required, active, display_order, id_condition_option)
              VALUES (@id_process, @file_label, @required, 1, @display_order, @id_condition_option);
            `;

            await new sql.Request(transaction)
              .input("id_process", sql.Int, processId)
              .input("file_label", sql.NVarChar(255), f.file_label)
              .input("required", sql.Bit, f.required ? 1 : 0)
              .input("display_order", sql.Int, order++)
              .input("id_condition_option", sql.Int, conditionOptionId)
              .query(insertFileQuery);
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
