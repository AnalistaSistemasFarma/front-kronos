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
      // Orion: LEFT JOIN desde process_form_field para devolver todos los campos
      // activos del proceso (incl. firma Orion sin valor aún). Testing: editable + options.
      const valuesResult = await pool
        .request()
        .input('idRequest', sql.Int, parseInt(idRequest, 10))
        .query(`
        SELECT
          COALESCE(rfv.id, 0) AS id,
          pff.id AS id_form_field,
          pff.field_label,
          pff.field_type,
          pff.editable,
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

      const optionsResult = await pool
        .request()
        .input('idRequest', sql.Int, parseInt(idRequest, 10))
        .query(`
        SELECT o.id, o.id_form_field, o.option_label
        FROM process_form_field_option o
        INNER JOIN process_form_field ff ON ff.id = o.id_form_field
        INNER JOIN process_category_request_general pcr
          ON pcr.id_process_category = ff.id_process_category
        WHERE o.active = 1
          AND ff.editable = 1
          AND ff.active = 1
          AND pcr.id_request_general = @idRequest
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
