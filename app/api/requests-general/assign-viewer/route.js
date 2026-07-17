import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";
import { NextResponse } from "next/server";

// Devuelve los observadores actuales de un proceso (para precargar el selector)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id_process_category = searchParams.get("id_process_category");

    if (!id_process_category) {
      return NextResponse.json(
        { error: "id_process_category es requerido" },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("id_process_category", sql.Int, parseInt(id_process_category))
      .query(
        `SELECT id_viewer FROM viewers_process_category WHERE id_process_category = @id_process_category`
      );

    const observers = result.recordset.map((r) => String(r.id_viewer));

    return NextResponse.json({ observers }, { status: 200 });
  } catch (err) {
    console.error("Error al obtener observadores:", err);
    return NextResponse.json(
      { error: "Error al obtener observadores", details: err.message },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    const { observers, id_process_category } = body;

    if (!Array.isArray(observers) || observers.length === 0 || !id_process_category) {
      return new Response(
        JSON.stringify({ message: "Campos obligatorios faltantes" }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Reemplaza el conjunto de observadores del proceso (evita duplicados y permite quitar)
      await new sql.Request(transaction)
        .input("id_process_category", sql.Int, id_process_category)
        .query(
          `DELETE FROM viewers_process_category WHERE id_process_category = @id_process_category`
        );

      // Inserta una fila por observador
      const insertedIds = [];
      for (const viewer of observers) {
        const result = await new sql.Request(transaction)
          .input("id_viewer", sql.NVarChar(1000), String(viewer))
          .input("id_process_category", sql.Int, id_process_category)
          .query(`
            INSERT INTO viewers_process_category (
              id_viewer,
              id_process_category
            )
            OUTPUT INSERTED.id
            VALUES (
              @id_viewer,
              @id_process_category
            );
          `);
        insertedIds.push(result.recordset[0].id);
      }

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: "Observadores asignados correctamente",
          count: insertedIds.length,
          ids: insertedIds,
        }),
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();

      console.error("Error en transacción:", dbError);

      return new Response(
        JSON.stringify({
          error: "Error al asignar el observador",
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
