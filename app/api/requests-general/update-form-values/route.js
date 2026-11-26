import { NextResponse } from 'next/server';
import { checkCommittedDates } from '../../../../lib/workflow/followups';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { fireConditionalTasksForRequest } from '../../../../lib/workflow/fireConditionalTasks.js';

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

      const lockedCheckRequest = pool.request();
      const lockedParams = fieldIds.map((id, i) => {
        lockedCheckRequest.input(`l${i}`, sql.Int, id);
        return `@l${i}`;
      });
      lockedCheckRequest.input('idRequestLock', sql.Int, idRequest);
      const lockedResult = await lockedCheckRequest.query(`
        SELECT id_form_field FROM request_form_value
        WHERE id_request_general = @idRequestLock AND locked = 1
          AND id_form_field IN (${lockedParams.join(', ')})
      `);
      if (lockedResult.recordset.length > 0) {
        return NextResponse.json(
          {
            error: 'El campo ya fue editado y quedó bloqueado; no se puede volver a editar',
            fields: lockedResult.recordset.map((r) => r.id_form_field),
          },
          { status: 403 }
        );
      }

      const condRequest = pool.request();
      const condParams = fieldIds.map((id, i) => {
        condRequest.input(`c${i}`, sql.Int, id);
        return `@c${i}`;
      });
      const condResult = await condRequest.query(`
        SELECT DISTINCT o.id_form_field
        FROM task_condition_option tco
        INNER JOIN process_form_field_option o ON o.id = tco.id_option
        WHERE o.id_form_field IN (${condParams.join(', ')})
      `);
      const conditionedFieldIds = new Set(condResult.recordset.map((r) => r.id_form_field));

      // 2026-11-26: committed dates of an action plan — the committed date is not changed and only ONE extension.
      const trackRequest = pool.request();
      const trackParams = fieldIds.map((id, i) => {
        trackRequest.input(`t${i}`, sql.Int, id);
        return `@t${i}`;
      });
      const trackResult = await trackRequest.query(`
        SELECT id_form_field, date_col, extension_col, status_col, done_value, warn_business_days, single_extension
        FROM dbo.process_date_tracking WHERE id_form_field IN (${trackParams.join(', ')})
      `);
      for (const cfg of trackResult.recordset) {
        const incoming = values.find((v) => parseInt(v.id_field, 10) === cfg.id_form_field);
        if (!incoming) continue;
        const prev = await pool
          .request()
          .input('r', sql.Int, Number(id_request))
          .input('f', sql.Int, cfg.id_form_field)
          .query('SELECT value_text FROM request_form_value WHERE id_request_general = @r AND id_form_field = @f');
        const before = tableRowsOf(prev.recordset[0]?.value_text);
        const after = tableRowsOf(incoming.value_text);
        const problem = checkCommittedDates(before, after, { ...cfg, single_extension: Boolean(cfg.single_extension) }, bogotaToday());
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
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

          const lockedValue = conditionedFieldIds.has(idField) ? 1 : 0;

          await new sql.Request(transaction)
            .input('idRequest', sql.Int, idRequest)
            .input('idField', sql.Int, idField)
            .input('idOption', sql.Int, idOption)
            .input('valueText', sql.NVarChar(sql.MAX), valueText)
            .input('locked', sql.Bit, lockedValue)
            .query(`
              IF EXISTS (
                SELECT 1 FROM request_form_value
                WHERE id_request_general = @idRequest AND id_form_field = @idField
              )
                UPDATE request_form_value
                SET id_option = @idOption, value_text = @valueText, locked = @locked
                WHERE id_request_general = @idRequest AND id_form_field = @idField;
              ELSE
                INSERT INTO request_form_value (id_request_general, id_form_field, id_option, value_text, locked)
                VALUES (@idRequest, @idField, @idOption, @valueText, @locked);
            `);
        }

        await transaction.commit();
      } catch (dbError) {
        await transaction.rollback();
        throw dbError;
      }

      try {
        await fireConditionalTasksForRequest(pool, { requestId: idRequest });
      } catch (fireErr) {
        console.error('Error disparando tareas condicionadas:', fireErr);
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

/** Rows of a table field value ({ rows: [...] } JSON); [] if empty or invalid. */
function tableRowsOf(valueText) {
  try {
    const v = JSON.parse(String(valueText ?? ''));
    return Array.isArray(v?.rows) ? v.rows : [];
  } catch {
    return [];
  }
}

function bogotaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}
