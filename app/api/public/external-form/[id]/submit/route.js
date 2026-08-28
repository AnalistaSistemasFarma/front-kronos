import { sql, getPool } from '../../../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';
import {
  fireAndForgetNotification,
  notifyNewRequest,
} from '../../../../../../lib/notificationEvents.js';
import { syncRequestToSapsend } from '../../../../../../lib/sapsend/treasury.js';
import { createGeneralRequest } from '../../../../../../lib/requests-general/createGeneralRequest.js';
import {
  PORTAL_EXTERNO_USER_ID,
  MAX_EXTERNAL_PAYLOAD_BYTES,
  MAX_EXTERNAL_FIELDS,
  sanitizeText,
  buildExternalSubject,
  buildExternalDescription,
} from '../../../../../../lib/requests-general/externalForm.js';

// ⚠️ ANTI-ABUSO pendiente antes de exponer en prod: rate-limit por IP + CAPTCHA/Turnstile;
// hoy solo hay validación server-side (pertenencia de campos/opciones al proceso, requeridos)
// y tope de tamaño de payload. NO hay control de volumen por origen.

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const idProcess = parseInt(id, 10);
    if (!idProcess || Number.isNaN(idProcess)) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    // Tope de payload (anti-abuso básico): se lee el cuerpo crudo y se limita el tamaño.
    const rawBody = await req.text();
    if (rawBody.length > MAX_EXTERNAL_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Solicitud demasiado grande' }, { status: 413 });
    }

    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const formValues = Array.isArray(body.formValues) ? body.formValues : [];
    if (formValues.length > MAX_EXTERNAL_FIELDS) {
      return NextResponse.json({ error: 'Demasiados campos' }, { status: 400 });
    }

    const pool = await getPool();

    // Gate en el server: re-derivamos el proceso desde la URL y re-validamos is_external = 1.
    const processResult = await pool
      .request()
      .input('id', sql.Int, idProcess)
      .query(`SELECT process, is_external FROM process_category WHERE id = @id`);
    const processRow = processResult.recordset[0];
    if (!processRow || processRow.is_external !== true) {
      return NextResponse.json({ error: 'Formulario no disponible' }, { status: 404 });
    }
    const processName = processRow.process;

    // Empresa derivada en el server (no la envía el cliente). TOP 1 si la categoría
    // estuviera asociada a varias empresas.
    const companyResult = await pool
      .request()
      .input('id', sql.Int, idProcess)
      .query(`
        SELECT TOP 1 ccr.id_company AS id_company
        FROM process_category pc
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN company_category_request ccr ON ccr.id_category_request = cr.id
        WHERE pc.id = @id
        ORDER BY ccr.id_company
      `);
    const idCompany = companyResult.recordset[0]?.id_company;
    if (idCompany == null) {
      return NextResponse.json(
        { error: 'El proceso no tiene empresa asociada' },
        { status: 409 }
      );
    }

    // Definición del formulario del proceso (para validar pertenencia y requeridos).
    const [fieldsResult, optionsResult, condResult] = await Promise.all([
      pool.request().input('idProcess', sql.Int, idProcess).query(`
        SELECT id, field_label, field_type, required
        FROM process_form_field
        WHERE active = 1 AND id_process_category = @idProcess
      `),
      pool.request().input('idProcess', sql.Int, idProcess).query(`
        SELECT o.id, o.id_form_field, o.option_label
        FROM process_form_field_option o
        INNER JOIN process_form_field f ON f.id = o.id_form_field
        WHERE o.active = 1 AND f.active = 1 AND f.id_process_category = @idProcess
      `),
      pool.request().input('idProcess', sql.Int, idProcess).query(`
        SELECT fco.id_form_field, fco.id_option
        FROM field_condition_option fco
        INNER JOIN process_form_field f ON f.id = fco.id_form_field
        WHERE f.active = 1 AND f.id_process_category = @idProcess
      `),
    ]);

    const fieldById = new Map();
    for (const f of fieldsResult.recordset) fieldById.set(f.id, f);
    const optionById = new Map();
    for (const o of optionsResult.recordset) optionById.set(o.id, o);
    const condByField = {};
    for (const c of condResult.recordset) {
      (condByField[c.id_form_field] ||= []).push(c.id_option);
    }

    // Opciones seleccionadas (para requeridos condicionales y validación de pertenencia).
    const selectedOptionIds = new Set();
    for (const fv of formValues) {
      if (fv && fv.id_option != null) selectedOptionIds.add(Number(fv.id_option));
    }

    // Validación server-side: cada id_field/id_option debe PERTENECER a este proceso.
    const cleanFormValues = [];
    const providedByField = new Map(); // id_field -> tiene valor
    const descriptionLines = [];

    for (const fv of formValues) {
      if (!fv || fv.id_field == null) continue;
      const idField = Number(fv.id_field);
      const field = fieldById.get(idField);
      if (!field) {
        // Campo que no pertenece a este proceso: se rechaza (evita inyección de campos ajenos).
        return NextResponse.json(
          { error: 'Campo no válido para este formulario' },
          { status: 400 }
        );
      }

      let idOption = null;
      if (fv.id_option != null) {
        idOption = Number(fv.id_option);
        const opt = optionById.get(idOption);
        if (!opt || opt.id_form_field !== idField) {
          return NextResponse.json(
            { error: 'Opción no válida para este formulario' },
            { status: 400 }
          );
        }
      }

      const valueText =
        fv.value_text != null ? sanitizeText(fv.value_text, 4000) : null;

      const hasValue = idOption != null || (valueText != null && valueText !== '');
      if (!hasValue) continue;

      providedByField.set(idField, true);
      cleanFormValues.push({
        id_field: idField,
        id_option: idOption,
        value_text: idOption != null ? null : valueText,
      });

      const displayValue =
        idOption != null ? optionById.get(idOption).option_label : valueText;
      descriptionLines.push({ label: field.field_label, value: displayValue });
    }

    // Requeridos: solo se exigen los campos VISIBLES (sin condiciones o con alguna
    // opción-condición seleccionada), igual que el formulario interno.
    for (const field of fieldById.values()) {
      if (!field.required) continue;
      const conds = condByField[field.id];
      const visible =
        !conds || conds.length === 0 || conds.some((o) => selectedOptionIds.has(o));
      if (visible && !providedByField.get(field.id)) {
        return NextResponse.json(
          { error: `Falta un campo obligatorio: ${field.field_label}` },
          { status: 400 }
        );
      }
    }

    // Asunto y descripción se construyen y sanitizan en el SERVER (no los controla el cliente).
    const subject = buildExternalSubject(processName);
    const descripcion = buildExternalDescription(processName, descriptionLines);

    let result;
    try {
      result = await createGeneralRequest({
        company: idCompany,
        subject,
        descripcion,
        process: idProcess,
        createdby: PORTAL_EXTERNO_USER_ID,
        url: null,
        formValues: cleanFormValues,
      });
    } catch (dbError) {
      console.error('Error creando solicitud externa:', dbError);
      return NextResponse.json(
        { error: 'No se pudo registrar la solicitud' },
        { status: 500 }
      );
    }

    const { id_request: newRequestId, processEmail, taskEmails } = result;

    // Notifica al encargado del proceso (y responsables de tareas), igual que create-request.
    fireAndForgetNotification(
      notifyNewRequest({
        requestId: newRequestId,
        subject,
        processEmail,
        taskEmails,
        requestUrl: null,
      })
    );

    // Mirror de create-request: sync a SAPSEND (gated internamente; no bloquea).
    fireAndForgetNotification(syncRequestToSapsend(newRequestId));

    return NextResponse.json(
      { message: 'Solicitud enviada correctamente', id_request: newRequestId },
      { status: 201 }
    );
  } catch (err) {
    console.error('Error en external-form submit:', err);
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}
