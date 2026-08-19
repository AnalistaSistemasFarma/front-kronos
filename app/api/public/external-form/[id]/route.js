import { sql, getPool } from '../../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';

/**
 * Endpoint PÚBLICO (sin login): devuelve la configuración de un formulario externo.
 *
 * Seguridad:
 *  - Solo responde si el proceso existe Y tiene is_external = 1 (si no, 404).
 *  - Devuelve EXCLUSIVAMENTE lo necesario para pintar el formulario: nombre del
 *    proceso y sus campos parametrizados. NO expone encargados, costos, ids de
 *    usuario, tareas, empresa, ni ningún dato interno.
 */
export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const idProcess = parseInt(id, 10);

    if (!idProcess || Number.isNaN(idProcess)) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const pool = await getPool();

    // Gate: el proceso debe existir y estar marcado como externo.
    const processResult = await pool
      .request()
      .input('id', sql.Int, idProcess)
      .query(`
        SELECT process, is_external
        FROM process_category
        WHERE id = @id
      `);

    const processRow = processResult.recordset[0];
    // 404 tanto si no existe como si no es externo (no filtramos existencia interna).
    if (!processRow || processRow.is_external !== true) {
      return NextResponse.json({ error: 'Formulario no disponible' }, { status: 404 });
    }

    const [fieldsResult, optionsResult, condResult] = await Promise.all([
      pool.request().input('idProcess', sql.Int, idProcess).query(`
        SELECT id, field_label, field_type, required, display_order, config_json
        FROM process_form_field
        WHERE active = 1 AND id_process_category = @idProcess
        ORDER BY display_order, id
      `),
      pool.request().input('idProcess', sql.Int, idProcess).query(`
        SELECT o.id, o.id_form_field, o.option_label, o.display_order
        FROM process_form_field_option o
        INNER JOIN process_form_field f ON f.id = o.id_form_field
        WHERE o.active = 1 AND f.active = 1 AND f.id_process_category = @idProcess
        ORDER BY o.display_order, o.id
      `),
      pool.request().input('idProcess', sql.Int, idProcess).query(`
        SELECT fco.id_form_field, fco.id_option
        FROM field_condition_option fco
        INNER JOIN process_form_field f ON f.id = fco.id_form_field
        WHERE f.active = 1 AND f.id_process_category = @idProcess
      `),
    ]);

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

    const fields = fieldsResult.recordset.map((f) => ({
      id: f.id,
      field_label: f.field_label,
      field_type: f.field_type,
      required: Boolean(f.required),
      config_json: f.config_json ?? null,
      options: optionsByField[f.id] || [],
      conditions: condByField[f.id] || [],
    }));

    return NextResponse.json(
      { process_name: processRow.process, fields },
      { status: 200 }
    );
  } catch (err) {
    console.error('Error en external-form GET:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud' },
      { status: 500 }
    );
  }
}
