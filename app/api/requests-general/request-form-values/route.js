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

    const { values, options } = await withMssqlPool(async (pool) => {
      const valuesResult = await pool
        .request()
        .input('idRequest', sql.Int, parseInt(idRequest, 10))
        .query(`
        SELECT
          rfv.id,
          rfv.id_form_field,
          ff.field_label,
          ff.field_type,
          ff.editable,
          ff.config_json,
          rfv.id_option,
          o.option_label,
          rfv.value_text
        FROM request_form_value rfv
        INNER JOIN process_form_field ff ON ff.id = rfv.id_form_field
        LEFT JOIN process_form_field_option o ON o.id = rfv.id_option
        WHERE rfv.id_request_general = @idRequest
        ORDER BY ff.display_order, ff.id
      `);

      const optionsResult = await pool
        .request()
        .input('idRequest', sql.Int, parseInt(idRequest, 10))
        .query(`
        SELECT o.id, o.id_form_field, o.option_label
        FROM process_form_field_option o
        INNER JOIN process_form_field ff ON ff.id = o.id_form_field
        WHERE o.active = 1
          AND ff.editable = 1
          AND ff.id IN (
            SELECT rfv.id_form_field
            FROM request_form_value rfv
            WHERE rfv.id_request_general = @idRequest
          )
        ORDER BY o.display_order, o.id
      `);

      return { values: valuesResult.recordset, options: optionsResult.recordset };
    });

    const optionsByField = {};
    for (const opt of options) {
      (optionsByField[opt.id_form_field] ||= []).push({
        id: opt.id,
        option_label: opt.option_label,
      });
    }

    const response = values.map((v) => ({
      ...v,
      editable: Boolean(v.editable),
      options: optionsByField[v.id_form_field] || [],
    }));

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('Error en request-form-values:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
