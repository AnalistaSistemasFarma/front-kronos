import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idProcess = searchParams.get('id_process');

    if (!idProcess) {
      return NextResponse.json(
        { error: 'Se requiere el parámetro id_process' },
        { status: 400 }
      );
    }

    const request = pool.request();
    request.input('idProcess', sql.Int, parseInt(idProcess));

    const fieldsResult = await request.query(`
      SELECT id, field_label, field_type, required, display_order
      FROM process_form_field
      WHERE active = 1 AND id_process_category = @idProcess
      ORDER BY display_order, id
    `);

    const fields = fieldsResult.recordset;

    if (fields.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    const optionsResult = await pool
      .request()
      .input('idProcess', sql.Int, parseInt(idProcess))
      .query(`
        SELECT o.id, o.id_form_field, o.option_label, o.display_order
        FROM process_form_field_option o
        INNER JOIN process_form_field f ON f.id = o.id_form_field
        WHERE o.active = 1 AND f.active = 1 AND f.id_process_category = @idProcess
        ORDER BY o.display_order, o.id
      `);

    const optionsByField = {};
    for (const opt of optionsResult.recordset) {
      (optionsByField[opt.id_form_field] ||= []).push({
        id: opt.id,
        option_label: opt.option_label,
      });
    }

    const response = fields.map((f) => ({
      id: f.id,
      field_label: f.field_label,
      field_type: f.field_type,
      required: Boolean(f.required),
      options: optionsByField[f.id] || [],
    }));

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('Error en process-fields:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
