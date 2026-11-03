import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids)
      ? body.ids.map(Number).filter((n) => Number.isInteger(n))
      : [];

    if (ids.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    const pool = await sql.connect(sqlConfig);
    const request = pool.request();

    const idParams = ids
      .map((id, i) => {
        request.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
      })
      .join(', ');

    const query = `
        SELECT 
              rg.id as id,
              rg.description as descripcion,
              c.company as empresa,
              rg.created_at as fecha_creación,
              ucr.name as nombre_solicitante,
              pc.process as proceso,
              sc.status as estado_solicitud, 
              rg.subject_request as asunto,
              rg.resolution as resolución,
              rg.date_resolution as fecha_resolución,

        MAX(CASE
            WHEN f.field_label = 'Destinatario - Persona que recibe'
            THEN  rfv.value_text
        END) AS destinatario,

        MAX(CASE
            WHEN f.field_label = 'Destinatario - Persona que recibe'
            THEN  f.config_json
        END) AS destinatario_config,

        MAX(CASE
            WHEN f.field_label = 'Remitente - Persona que envía'
            THEN  rfv.value_text
        END) AS remitente,

        MAX(CASE
            WHEN f.field_label = 'Remitente - Persona que envía'
            THEN  f.config_json
        END) AS remitente_config,

        MAX(CASE
            WHEN f.field_label = 'Observaciones'
            THEN  rfv.value_text
        END) AS observacion

        FROM requests_general rg
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] ucr ON ucr.id = rg.id_requester
        INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
        INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
        LEFT JOIN request_form_value rfv ON rfv.id_request_general = rg.id
        LEFT JOIN process_form_field f ON f.id = rfv.id_form_field
        LEFT JOIN process_form_field_option o ON o.id = rfv.id_option

        WHERE pc.process LIKE '%Mensaj%'
            AND rg.id IN (${idParams})

        GROUP BY
            rg.id , rg.description, rg.id_company, c.company ,rg.created_at, rg.id_requester, ucr.name, 
            pcrg.id_process_category, pc.process, rg.status_req, sc.status, rg.subject_request, rg.resolution,
            rg.date_resolution

        ORDER BY rg.id DESC;
    `;

    const result = await request.query(query);
    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error generando el reporte de mensajeria:', err);
    return NextResponse.json(
      { error: 'Error generando el reporte de mensajeria', details: err.message },
      { status: 500 }
    );
  }
}
