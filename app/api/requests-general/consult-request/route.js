import sql from "mssql";
import sqlConfig from "../../../../dbconfig";
import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    let query = `
      SELECT 
        c.id_company, c.company
      FROM company c
    `;

    const request = pool.request();

    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error("Error en el procesamiento de la solicitud:", err);
    return NextResponse.json(
      { error: "Error procesando la solicitud", details: err.message },
      { status: 500 }
    );
  }
}
