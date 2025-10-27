import sql from "mssql";
import sqlConfig from "../../../../dbconfig";
import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    // 🧩 Leer parámetros desde la URL
    const { searchParams } = new URL(req.url);
    const priority = searchParams.get("priority");
    const status = searchParams.get("status");
    const assigned_user = searchParams.get("assigned_user");
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");

    let query = `
      SELECT 
        c.case_type, c.creation_date, c.description, c.end_date, 
        c.id_case, c.id_department, c.id_technical, c.place, 
        c.priority, c.requester, c.subject_case, 
        cg.category, sg.subcategory, a.activity, sc.status, 
        u.name AS nombreTecnico, d.department
      FROM [case] c
      LEFT JOIN category_case cc ON cc.id_case = c.id_case
      INNER JOIN category cg ON cg.id_category = cc.id_category
      INNER JOIN subcategory sg ON sg.id_subcategory = cc.id_subcategory
      INNER JOIN activity a ON a.id_activity = cc.id_activity
      INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
      LEFT JOIN company_user cu ON cu.id_company_user = c.id_technical
      LEFT JOIN [user] u ON u.id = cu.id_user
      INNER JOIN department d ON d.id_department = c.id_department
      WHERE 1=1
    `;

    // 🧩 Agregar filtros dinámicamente
    if (priority) query += ` AND c.priority = @priority`;
    if (status) query += ` AND sc.status = @status`;
    if (assigned_user) query += ` AND u.name LIKE '%' + @assigned_user + '%'`;
    if (date_from && date_to)
      query += ` AND c.creation_date BETWEEN @date_from AND @date_to`;

    const request = pool.request();
    if (priority) request.input("priority", sql.NVarChar, priority);
    if (status) request.input("status", sql.NVarChar, status);
    if (assigned_user) request.input("assigned_user", sql.NVarChar, assigned_user);
    if (date_from && date_to) {
      request.input("date_from", sql.Date, date_from);
      request.input("date_to", sql.Date, date_to);
    }

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
