import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";

export async function POST(req) {
  try {
    const body = await req.json();

  const {
      category,
      id_user,
      id_company
    } = body;

    if (!id_company || !id_user || !category) {
      return new Response(
        JSON.stringify({ message: "Campos obligatorios faltantes" }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      
        /* =========================
            1️⃣ INSERT CATEGORY
        ========================= */
    
        const insertCategoryQuery = `
            INSERT INTO category_request (category)
            OUTPUT INSERTED.id
            VALUES (@category);
        `;
    
        const categoryRequest = new sql.Request(transaction);
    
        categoryRequest.input("category", sql.NVarChar(255), category);
    
        const categoryResult =
            await categoryRequest.query(insertCategoryQuery);
    
        const categoryId = categoryResult.recordset[0].id;
    
    
        /* =========================
            2️⃣ USER - CATEGORY
        ========================= */
    
        const insertUserCategoryQuery = `
            INSERT INTO user_category_request_general
            (id_category, id_user)
            VALUES (@id_category, @id_user);
        `;
    
        await new sql.Request(transaction)
            .input("id_category", sql.Int, categoryId)
            .input("id_user", sql.NVarChar(1000), id_user)
            .query(insertUserCategoryQuery);
    
    
            const insertCompanyCategoryQuery = `
            INSERT INTO company_category_request
            (id_category_request, id_company)
            VALUES (@id_category_request, @id_company);
        `;
    
        await new sql.Request(transaction)
            .input("id_category_request", sql.Int, categoryId)
            .input("id_company", sql.Int, id_company)
            .query(insertCompanyCategoryQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: "Solicitud creada correctamente",
          id_request: categoryId,
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
