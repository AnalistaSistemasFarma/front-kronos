import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

/**
 * Reporte de "Solicitudes de Pago" para el Excel del panel de solicitudes.
 *
 * Recibe una lista de ids de solicitud (las que están cargadas en el panel) y
 * devuelve, SOLO para las del proceso "Solicitud de Pago", los campos extra
 * pivoteados desde request_form_value (Tipo, Subtipo, Valor, Fecha Solicitada,
 * Acreedor, Subempresa) — los mismos que usa el tablero de Programación de Pago,
 * pero agrupados por SOLICITUD y filtrando por PROCESO (no por la tarea
 * "Programación de Pago"), para incluir también las que aún no llegaron a esa
 * etapa.
 */
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
        rg.id AS id_solicitud,
        rg.subject_request AS asunto,
        c.company AS empresa,
        uc.name AS creador_solicitud,
        sc.status AS estado,
        rg.created_at AS fecha_creación_solicitud,

        MAX(CASE
            WHEN f.field_label = 'Tipo de Solicitud'
            THEN COALESCE(rfv.value_text, o.option_label)
        END) AS tipo_solicitud,

        MAX(CASE
            WHEN f.field_label LIKE 'Subtipo de Solicitud%'
            THEN COALESCE(rfv.value_text, o.option_label)
        END) AS subtipo_solicitud,

        MAX(CASE
            WHEN f.field_label = 'Valor a Pagar'
            THEN rfv.value_text
        END) AS valor_pagar,

        MAX(CASE
            WHEN f.field_label = 'Fecha Solicitada de Pago'
            THEN rfv.value_text
        END) AS fecha_solicitada_pago,

        MAX(CASE
            WHEN f.field_label = 'Acreedor'
            THEN rfv.value_text
        END) AS acreedor,

        MAX(CASE
            WHEN f.field_label = 'Subempresa'
            THEN COALESCE(rfv.value_text, o.option_label)
        END) AS subempresa

      FROM requests_general rg

      INNER JOIN company c
          ON c.id_company = rg.id_company

      INNER JOIN [user] uc
          ON uc.id = rg.id_requester

      INNER JOIN process_category_request_general pcrg
          ON pcrg.id_request_general = rg.id

      INNER JOIN process_category pc
          ON pc.id = pcrg.id_process_category

      LEFT JOIN status_case sc
          ON sc.id_status_case = rg.status_req

      LEFT JOIN request_form_value rfv
          ON rfv.id_request_general = rg.id

      LEFT JOIN process_form_field f
          ON f.id = rfv.id_form_field

      LEFT JOIN process_form_field_option o
          ON o.id = rfv.id_option

      WHERE pc.process = 'Solicitud de Pago'
        AND rg.id IN (${idParams})

      GROUP BY
        rg.id,
        rg.subject_request,
        c.company,
        uc.name,
        sc.status,
        rg.created_at

      ORDER BY rg.id DESC;
    `;

    const result = await request.query(query);
    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error generando el reporte de pagos:', err);
    return NextResponse.json(
      { error: 'Error generando el reporte de pagos', details: err.message },
      { status: 500 }
    );
  }
}
