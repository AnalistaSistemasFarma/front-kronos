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
    } = body;

    if (
      !company ||
      !subject ||
      !process ||
      !descripcion
    ) {
      return new Response(
        JSON.stringify({ message: "Campos obligatorios faltantes" }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);
    const creation_date = new Date().toISOString().split("T")[0];

    try {
      await transaction.begin();

      const insertCaseQuery = `
        INSERT INTO [requests_general] (
          [description],
          subject_request,
          id_process_category,
          id_company,
          created_at,
          id_requester,
          status_req
        )
        OUTPUT INSERTED.id
        VALUES (
          @descripcion,
          @subject,
          @process,
          @company,
          @creation_date,
          @createdby,
          1
        );
      `;

      const request = new sql.Request(transaction);
      request.input("creation_date", sql.Date, creation_date);
      request.input("descripcion", sql.NVarChar(255), descripcion);
      request.input("subject", sql.NVarChar(255), subject);
      request.input("category", sql.Int, category);
      request.input("process", sql.Int, process);
      request.input("company", sql.Int, company);
      request.input("createdby", sql.NVarChar(1000), createdby);

      const caseResult = await request.query(insertCaseQuery);
      const newCaseId = caseResult.recordset[0].id_case;

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: "Solicitud creada exitosamente",
          id_request: newCaseId,
        }),
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error("Error en el proceso de creación:", dbError);
      return new Response(
        JSON.stringify({
          error: "Error en el proceso de creación",
          details: dbError.message,
        }),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Error general en la solicitud:", err);
    return new Response(
      JSON.stringify({
        error: "Error general en la solicitud",
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
