import sql from "mssql";
import sqlConfig from "../../../dbconfig";
import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idUser = searchParams.get('idUser');

    console.log('API requests-general: idUser recibido:', idUser);

    let query = `
      SELECT
        rg.id, cr.category as category, up.name as [user], rg.[description], rg.id_company, c.company ,rg.created_at, u.name as 'requester', sc.status as [status], rg.subject_request as [subject], pc.process, cr.id as id_category
      FROM requests_general rg
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] u ON u.id = rg.id_requester
        LEFT JOIN process_category pc ON pc.id = rg.id_process_category
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN [user] up ON up.id = pc.assigned
        INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
      WHERE 1=1
    `;

    if (idUser) {
      query += ` AND rg.id_requester = @idUser`;
      console.log('API requests-general: Agregando filtro por idRequester:', idUser);
    } else {
      console.log('API requests-general: No se proporcionó idUser, devolviendo error');
      return NextResponse.json(
        { error: "Se requiere el parámetro idUser para filtrar tickets" },
        { status: 400 }
      );
    }

    const request = pool.request();
    request.input('idUser', sql.NVarChar, idUser);
    console.log('API requests-general: Usando sql.NVarChar para idUser');

    console.log('API requests-general: Ejecutando consulta:', query);
    const result = await request.query(query);
    console.log('API requests-general: Resultados obtenidos:', result.recordset.length, 'registros');

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error("Error en el procesamiento de la solicitud:", err);
    return NextResponse.json(
      { error: "Error procesando la solicitud", details: err.message },
      { status: 500 }
    );
  }
}
