import sql from 'mssql';
import { ORION_SIGNATURE_FIELD_TYPE } from './fieldType';
import {
  mergeOrionSignatureState,
  parseOrionSignatureState,
  serializeOrionSignatureState,
} from './formValue';
import type { OrionDocumentResponse, OrionSignatureState } from './types';
import { buildOrionExternalRef, resolveOrionTenantId, getOrionDefaultCreatedByEmail } from './config';
import { createOrionDocument, getOrionDocument, getOrionDocumentByRef } from './client';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';

type SqlPool = import('mssql').ConnectionPool;
type SqlTransaction = import('mssql').Transaction;

export type RequestOrionContext = {
  id: number;
  id_company: number;
  subject_request: string;
  process: string | null;
  category: string | null;
  requester_email: string | null;
  id_requester: string | null;
};

export async function getRequestOrionContext(
  pool: SqlPool,
  requestId: number
): Promise<RequestOrionContext | null> {
  const result = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`
      SELECT TOP 1
        rg.id,
        rg.id_company,
        rg.subject_request,
        pc.process,
        cr.category,
        u.email AS requester_email,
        rg.id_requester
      FROM requests_general rg
      LEFT JOIN process_category_request_general pcr ON pcr.id_request_general = rg.id
      LEFT JOIN process_category pc ON pc.id = pcr.id_process_category
      LEFT JOIN category_request cr ON cr.id = pc.id_category_request
      LEFT JOIN [user] u ON u.id = rg.id_requester
      WHERE rg.id = @id
    `);
  return result.recordset[0] ?? null;
}

export async function findOrionSignatureField(
  pool: SqlPool,
  requestId: number
): Promise<{ id_form_field: number; value_text: string | null; rfv_id: number | null } | null> {
  const result = await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('fieldType', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
    .query(`
      SELECT TOP 1
        pff.id AS id_form_field,
        rfv.id AS rfv_id,
        rfv.value_text
      FROM process_category_request_general pcr
      INNER JOIN process_form_field pff ON pff.id_process_category = pcr.id_process_category
      LEFT JOIN request_form_value rfv
        ON rfv.id_form_field = pff.id AND rfv.id_request_general = @id
      WHERE pcr.id_request_general = @id
        AND pff.field_type = @fieldType
        AND pff.active = 1
      ORDER BY pff.display_order, pff.id
    `);
  return result.recordset[0] ?? null;
}

export async function upsertOrionFormValue(
  executor: SqlPool | SqlTransaction,
  requestId: number,
  formFieldId: number,
  state: OrionSignatureState
): Promise<void> {
  const valueText = serializeOrionSignatureState(state);
  const req = executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

  const existing = await req
    .input('id_request', sql.Int, requestId)
    .input('id_field', sql.Int, formFieldId)
    .query(`
      SELECT TOP 1 id FROM request_form_value
      WHERE id_request_general = @id_request AND id_form_field = @id_field
    `);

  if (existing.recordset[0]?.id) {
    await (executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request())
      .input('id', sql.Int, existing.recordset[0].id)
      .input('value_text', sql.NVarChar(sql.MAX), valueText)
      .query(`UPDATE request_form_value SET value_text = @value_text WHERE id = @id`);
    return;
  }

  await (executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request())
    .input('id_request', sql.Int, requestId)
    .input('id_field', sql.Int, formFieldId)
    .input('value_text', sql.NVarChar(sql.MAX), valueText)
    .query(`
      INSERT INTO request_form_value (id_request_general, id_form_field, value_text)
      VALUES (@id_request, @id_field, @value_text)
    `);
}

function mapOrionResponseToState(
  externalRef: string,
  doc: OrionDocumentResponse
): OrionSignatureState {
  return {
    orionDocumentId: doc.orionDocumentId,
    externalRef: doc.externalRef ?? externalRef,
    status: doc.status,
    embedUrl: doc.embedUrl ?? null,
    signedFileUrl: doc.signedFileUrl ?? null,
    signedAt: doc.signedAt ?? null,
    signers: doc.signers,
    auditSummary: doc.auditSummary ?? null,
  };
}

export async function ensureOrionDocumentForRequest(
  pool: SqlPool,
  params: {
    requestId: number;
    createdByEmail: string;
    title?: string;
    pdfBase64?: string;
    refresh?: boolean;
  }
): Promise<{
  state: OrionSignatureState;
  formFieldId: number;
  created: boolean;
}> {
  const ctx = await getRequestOrionContext(pool, params.requestId);
  if (!ctx) {
    throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  }

  const field = await findOrionSignatureField(pool, params.requestId);
  if (!field) {
    throw Object.assign(
      new Error('El proceso de esta solicitud no tiene campo de firma digital (orion_signature)'),
      { status: 422 }
    );
  }

  const externalRef = buildOrionExternalRef(params.requestId);
  const current = parseOrionSignatureState(field.value_text);

  if (current.orionDocumentId && current.embedUrl && !params.refresh && !params.pdfBase64) {
    return { state: current, formFieldId: field.id_form_field, created: false };
  }

  let doc: OrionDocumentResponse | null = null;
  let created = false;

  if (current.orionDocumentId && (params.refresh || !current.embedUrl)) {
    const live = await getOrionDocument(current.orionDocumentId);
    if (live.ok && live.data) {
      doc = live.data;
    }
  }

  if (!doc) {
    const byRef = await getOrionDocumentByRef(externalRef);
    if (byRef.ok && byRef.data?.orionDocumentId) {
      doc = byRef.data;
    } else if (byRef.status !== 404) {
      throw Object.assign(new Error(byRef.error || 'Error consultando Orion'), {
        status: byRef.status >= 500 ? 503 : 502,
      });
    }
  }

  if (!doc) {
    const tenantId = resolveOrionTenantId(ctx.id_company);
    const createdByEmail =
      params.createdByEmail?.trim() ||
      ctx.requester_email?.trim() ||
      getOrionDefaultCreatedByEmail() ||
      '';
    if (!createdByEmail) {
      throw Object.assign(
        new Error(
          'No hay createdByEmail. Configure ORION_DEFAULT_CREATED_BY_EMAIL o use un solicitante con correo en Orion.'
        ),
        { status: 422 }
      );
    }
    const createRes = await createOrionDocument({
      externalRef,
      synerlinkRequestId: params.requestId,
      synerlinkCompanyId: ctx.id_company,
      tenantId: tenantId ?? undefined,
      title: params.title || ctx.subject_request || `Solicitud #${params.requestId}`,
      createdByEmail,
      pdfBase64: params.pdfBase64,
      metadata: {
        processName: ctx.process ?? undefined,
        categoryName: ctx.category ?? undefined,
      },
    });

    if (!createRes.ok || !createRes.data) {
      throw Object.assign(new Error(createRes.error || 'No se pudo crear el documento en Orion'), {
        status: createRes.status >= 500 ? 503 : 502,
      });
    }
    doc = createRes.data;
    created = createRes.status === 201;
  }

  const state = mergeOrionSignatureState(current, mapOrionResponseToState(externalRef, doc));
  await upsertOrionFormValue(pool, params.requestId, field.id_form_field, state);

  return { state, formFieldId: field.id_form_field, created };
}

export async function insertRequestNote(
  pool: SqlPool,
  requestId: number,
  note: string,
  createdBy: string
): Promise<void> {
  await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('note', sql.NVarChar(sql.MAX), note)
    .input('created_by', sql.NVarChar(255), createdBy)
    .query(`
      INSERT INTO notes (id_request, note, created_by, creation_date)
      VALUES (@id_request, @note, @created_by, GETDATE())
    `);
}

export async function applyOrionWebhookToRequest(
  pool: SqlPool,
  params: {
    requestId: number;
    patch: OrionSignatureState;
    status: string;
    auditSummary?: string | null;
    noteAuthorUserId: string | null;
  }
): Promise<{ tasksUpdated: number; requestClosed: boolean }> {
  const field = await findOrionSignatureField(pool, params.requestId);
  if (!field) {
    throw Object.assign(new Error('Campo orion_signature no encontrado para la solicitud'), {
      status: 404,
    });
  }

  const current = parseOrionSignatureState(field.value_text);
  const state = mergeOrionSignatureState(current, params.patch);
  await upsertOrionFormValue(pool, params.requestId, field.id_form_field, state);

  const statusUpper = String(params.status).toUpperCase();
  let tasksUpdated = 0;
  let requestClosed = false;

  const openTasks = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .query(`
      SELECT trg.id, trg.id_assigned, trg.id_task, trg.id_status,
             tpc.task, tpc.is_sequential, tpc.display_order, tpc.id_process_category,
             rg.subject_request
      FROM task_request_general trg
      INNER JOIN requests_general rg ON rg.id = trg.id_request_general
      LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id_request
        AND trg.id_status NOT IN (2, 3)
      ORDER BY ISNULL(tpc.display_order, 0), trg.id
    `);

  const resolution =
    params.auditSummary ||
    (statusUpper === 'FIRMADO'
      ? 'Documento firmado vía GSS Firma (Orion).'
      : 'Documento rechazado vía GSS Firma (Orion).');

  if (statusUpper === 'FIRMADO') {
    for (const task of openTasks.recordset) {
      const assigned = task.id_assigned || params.noteAuthorUserId;
      if (!assigned) continue;

      await pool
        .request()
        .input('id', sql.Int, task.id)
        .input('id_status', sql.Int, 2)
        .input('id_assigned', sql.NVarChar(255), assigned)
        .input('resolution', sql.NVarChar(sql.MAX), resolution)
        .query(`
          UPDATE task_request_general
          SET id_status = @id_status,
              id_assigned = @id_assigned,
              resolution = @resolution,
              end_date = GETDATE(),
              date_resolution = GETDATE(),
              id_executor_final = @id_assigned
          WHERE id = @id
        `);
      tasksUpdated += 1;

      await advanceSequentialTask(pool, {
        id_request_general: params.requestId,
        id_task: task.id_task,
        id_process_category: task.id_process_category,
        display_order: task.display_order,
        subject_request: task.subject_request,
      });
    }

    await pool
      .request()
      .input('id', sql.Int, params.requestId)
      .input('resolution', sql.NVarChar(sql.MAX), resolution)
      .input('executor', sql.NVarChar(255), params.noteAuthorUserId)
      .query(`
        UPDATE requests_general
        SET status_req = 2,
            resolution = @resolution,
            date_resolution = GETDATE(),
            id_executor_final = COALESCE(@executor, id_executor_final)
        WHERE id = @id AND status_req NOT IN (2, 3)
      `);
    requestClosed = true;
  } else if (statusUpper === 'RECHAZADO') {
    for (const task of openTasks.recordset) {
      const assigned = task.id_assigned || params.noteAuthorUserId;
      if (!assigned) continue;

      await pool
        .request()
        .input('id', sql.Int, task.id)
        .input('id_status', sql.Int, 3)
        .input('id_assigned', sql.NVarChar(255), assigned)
        .input('resolution', sql.NVarChar(sql.MAX), resolution)
        .query(`
          UPDATE task_request_general
          SET id_status = @id_status,
              id_assigned = @id_assigned,
              resolution = @resolution,
              end_date = GETDATE(),
              date_resolution = GETDATE(),
              id_executor_final = @id_assigned
          WHERE id = @id
        `);
      tasksUpdated += 1;
    }

    await pool
      .request()
      .input('id', sql.Int, params.requestId)
      .input('resolution', sql.NVarChar(sql.MAX), resolution)
      .query(`
        UPDATE requests_general
        SET status_req = 3,
            resolution = @resolution,
            date_resolution = GETDATE()
        WHERE id = @id AND status_req NOT IN (2, 3)
      `);
    requestClosed = true;
  }

  if (params.noteAuthorUserId) {
    const note =
      statusUpper === 'FIRMADO'
        ? `GSS Firma: documento firmado. ${resolution}`
        : `GSS Firma: documento rechazado. ${resolution}`;
    await insertRequestNote(pool, params.requestId, note, params.noteAuthorUserId);
  }

  return { tasksUpdated, requestClosed };
}

/** Sincroniza estado desde Orion GET y persiste en request_form_value. */
export async function syncOrionDocumentState(
  pool: SqlPool,
  requestId: number
): Promise<OrionSignatureState | null> {
  const field = await findOrionSignatureField(pool, requestId);
  if (!field) return null;

  const current = parseOrionSignatureState(field.value_text);
  if (!current.orionDocumentId) return current;

  const live = await getOrionDocument(current.orionDocumentId);
  if (!live.ok || !live.data) return current;

  const externalRef = current.externalRef || buildOrionExternalRef(requestId);
  const state = mergeOrionSignatureState(current, mapOrionResponseToState(externalRef, live.data));
  await upsertOrionFormValue(pool, requestId, field.id_form_field, state);
  return state;
}

export async function userCanManageOrionRequest(
  pool: SqlPool,
  requestId: number,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;

  const assigned = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_user', sql.NVarChar(255), userId)
    .query(`
      SELECT TOP 1 trg.id
      FROM task_request_general trg
      WHERE trg.id_request_general = @id_request
        AND trg.id_assigned = @id_user
        AND trg.id_status NOT IN (2, 3)
    `);

  return Boolean(assigned.recordset[0]);
}
