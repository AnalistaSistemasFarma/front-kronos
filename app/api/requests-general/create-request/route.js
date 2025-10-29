import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      company,
      usuario,
      descripcion,
      category,
      createdby,
    } = body;

    if (
      !company ||
      !usuario ||
      !category ||
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
          category,
          [user],
          id_company,
          created_at,
          requester,
          [status]
        )
        OUTPUT INSERTED.id
        VALUES (
          @descripcion,
          @category,
          @usuario,
          @company,
          @creation_date,
          @createdby,
          'Pendiente'
        );
      `;

      const request = new sql.Request(transaction);
      request.input("creation_date", sql.Date, creation_date);
      request.input("descripcion", sql.NVarChar(255), descripcion);
      request.input("category", sql.NVarChar(255), category);
      request.input("usuario", sql.NVarChar(255), usuario);
      request.input("company", sql.Int, company);
      request.input("createdby", sql.NVarChar(255), createdby);

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
