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
          rfv.id,
          rfv.id_form_field,
          ff.field_label,
          rfv.id_option,
          o.option_label,
          rfv.value_text
        FROM request_form_value rfv
        INNER JOIN process_form_field ff ON ff.id = rfv.id_form_field
        LEFT JOIN process_form_field_option o ON o.id = rfv.id_option
        WHERE rfv.id_request_general = @idRequest
        ORDER BY ff.display_order, ff.id
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
