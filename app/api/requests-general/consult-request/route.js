import sql from "mssql";
import sqlConfig from "../../../../dbconfig";
import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    // --- Consultas ---
    const queryCompanies = `
      SELECT 
        c.id_company, c.company
      FROM company c
    `;

    const queryCategories = `
      SELECT * FROM category_request
    `;

    const queryProcessCategories = `
      SELECT 
        pc.id as id_process,
        pc.process,
        pc.id_category_request,
        cr.category
      FROM process_category pc 
      INNER JOIN category_request cr 
        ON cr.id = pc.id_category_request
    `;

    // Ejecutar en paralelo para mejorar rendimiento
    const [companiesRes, categoriesRes, processCategoriesRes] = await Promise.all([
      pool.request().query(queryCompanies),
      pool.request().query(queryCategories),
      pool.request().query(queryProcessCategories),
    ]);

    return NextResponse.json(
      {
        companies: companiesRes.recordset,
        categories: categoriesRes.recordset,
        processCategories: processCategoriesRes.recordset,
      },
      { status: 200 }
    );

  } catch (err) {
    console.error("Error en el procesamiento de la solicitud:", err);
    return NextResponse.json(
      { error: "Error procesando la solicitud", details: err.message },
      { status: 500 }
    );
  }
}
