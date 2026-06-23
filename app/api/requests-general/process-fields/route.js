import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const idProcess = searchParams.get('id_process');

    if (!idProcess) {
      return NextResponse.json(
        { error: 'Se requiere el parámetro id_process' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const id = parseInt(idProcess);

    const [fieldsResult, optionsResult, condResult] = await Promise.all([
      pool.request().input('idProcess', sql.Int, id).query(`
        SELECT id, field_label, field_type, required, display_order
        FROM process_form_field
        WHERE active = 1 AND id_process_category = @idProcess
        ORDER BY display_order, id
      `),
      pool.request().input('idProcess', sql.Int, id).query(`
        SELECT o.id, o.id_form_field, o.option_label, o.display_order
        FROM process_form_field_option o
        INNER JOIN process_form_field f ON f.id = o.id_form_field
        WHERE o.active = 1 AND f.active = 1 AND f.id_process_category = @idProcess
        ORDER BY o.display_order, o.id
      `),
      pool.request().input('idProcess', sql.Int, id).query(`
        SELECT fco.id_form_field, fco.id_option
        FROM field_condition_option fco
        INNER JOIN process_form_field f ON f.id = fco.id_form_field
        WHERE f.active = 1 AND f.id_process_category = @idProcess
      `),
    ]);

    const fields = fieldsResult.recordset;

    if (fields.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    const optionsByField = {};
    for (const opt of optionsResult.recordset) {
      (optionsByField[opt.id_form_field] ||= []).push({
        id: opt.id,
        option_label: opt.option_label,
      });
    }

    const condByField = {};
    for (const c of condResult.recordset) {
      (condByField[c.id_form_field] ||= []).push(c.id_option);
    }

    const response = fields.map((f) => ({
      id: f.id,
      field_label: f.field_label,
      field_type: f.field_type,
      required: Boolean(f.required),
      options: optionsByField[f.id] || [],
      conditions: condByField[f.id] || [],
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