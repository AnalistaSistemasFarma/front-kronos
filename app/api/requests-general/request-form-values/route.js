import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const idRequest = searchParams.get('id_request');

    if (!idRequest) {
      return NextResponse.json(
        { error: 'Se requiere el parámetro id_request' },
        { status: 400 }
      );
    }

    const result = await withMssqlPool(async (pool) => {
      return pool
        .request()
        .input('idRequest', sql.Int, parseInt(idRequest, 10))
        .query(`
        SELECT
          COALESCE(rfv.id, 0) AS id,
          pff.id AS id_form_field,
          pff.field_label,
          pff.field_type,
          pff.config_json,
          rfv.id_option,
          o.option_label,
          rfv.value_text
        FROM process_category_request_general pcr
        INNER JOIN process_form_field pff
          ON pff.id_process_category = pcr.id_process_category AND pff.active = 1
        LEFT JOIN request_form_value rfv
          ON rfv.id_form_field = pff.id AND rfv.id_request_general = pcr.id_request_general
        LEFT JOIN process_form_field_option o ON o.id = rfv.id_option
        WHERE pcr.id_request_general = @idRequest
        ORDER BY pff.display_order, pff.id
      `);
    });

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en request-form-values:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
