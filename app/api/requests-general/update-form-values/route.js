import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

export async function POST(req) {
  try {
    const body = await req.json();
    const { id_request, values } = body;

    if (!id_request || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json(
        { error: 'id_request y values son requeridos' },
        { status: 400 }
      );
    }

    const idRequest = parseInt(id_request, 10);

    return await withMssqlPool(async (pool) => {
      const reqResult = await pool
        .request()
        .input('idRequest', sql.Int, idRequest)
        .query(
          `SELECT id, status_req FROM requests_general WHERE id = @idRequest`
        );

      if (reqResult.recordset.length === 0) {
        return NextResponse.json(
          { error: 'Solicitud no encontrada' },
          { status: 404 }
        );
      }

      const statusReq = reqResult.recordset[0].status_req;
      if (statusReq === 2 || statusReq === 3) {
        return NextResponse.json(
          { error: 'La solicitud está cerrada; sus campos ya no se pueden editar' },
          { status: 403 }
        );
      }

      const fieldIds = values
        .map((v) => parseInt(v.id_field, 10))
        .filter((n) => Number.isInteger(n));

      if (fieldIds.length !== values.length) {
        return NextResponse.json(
          { error: 'Cada value debe incluir un id_field válido' },
          { status: 400 }
        );
      }

      const editableRequest = pool.request();
      const idParams = fieldIds.map((id, i) => {
        editableRequest.input(`f${i}`, sql.Int, id);
        return `@f${i}`;
      });
      const editableResult = await editableRequest.query(`
        SELECT id FROM process_form_field
        WHERE active = 1 AND editable = 1 AND id IN (${idParams.join(', ')})
      `);

      const editableIds = new Set(editableResult.recordset.map((r) => r.id));
      const notEditable = fieldIds.filter((id) => !editableIds.has(id));
      if (notEditable.length > 0) {
        return NextResponse.json(
          {
            error: 'Uno o más campos no están marcados como editables durante el proceso',
            fields: notEditable,
          },
          { status: 403 }
        );
      }

      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();

        for (const value of values) {
          const idField = parseInt(value.id_field, 10);
          const idOption =
            value.id_option !== undefined && value.id_option !== null
              ? parseInt(value.id_option, 10)
              : null;
          const valueText =
            value.value_text !== undefined && value.value_text !== null
              ? String(value.value_text)
              : null;

          await new sql.Request(transaction)
            .input('idRequest', sql.Int, idRequest)
            .input('idField', sql.Int, idField)
            .input('idOption', sql.Int, idOption)
            .input('valueText', sql.NVarChar(sql.MAX), valueText)
            .query(`
              IF EXISTS (
                SELECT 1 FROM request_form_value
                WHERE id_request_general = @idRequest AND id_form_field = @idField
              )
                UPDATE request_form_value
                SET id_option = @idOption, value_text = @valueText
                WHERE id_request_general = @idRequest AND id_form_field = @idField;
              ELSE
                INSERT INTO request_form_value (id_request_general, id_form_field, id_option, value_text)
                VALUES (@idRequest, @idField, @idOption, @valueText);
            `);
        }

        await transaction.commit();
      } catch (dbError) {
        await transaction.rollback();
        throw dbError;
      }

      return NextResponse.json(
        { message: 'Valores actualizados correctamente', count: values.length },
        { status: 200 }
      );
    });
  } catch (err) {
    console.error('Error en update-form-values:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
