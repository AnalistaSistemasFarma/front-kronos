import sql from 'mssql';
import { ORION_SIGNATURE_FIELD_TYPE } from './fieldType';
import {
  adoptLegacyOrionDocument,
  allOrionDocumentsFullySigned,
  anyOrionDocumentRejected,
  emptyOrionFormBag,
  findOrionDocumentByExternalRef,
  findOrionDocumentByOrionId,
  getOrionDocumentFromBag,
  mergeOrionSignatureState,
  parseOrionSignatureBagBag,
  serializeOrionSignatureBagBag,
  setOrionDocumentInBag,
} from './formValue';
import type { OrionDocumentResponse, OrionSignatureBagBag, OrionSignatureState } from './types';
import {
  ORION_LEGACY_FILE_ID,
  buildOrionExternalRef,
  getOrionDefaultCreatedByEmail,
  parseFileIdFromExternalRef,
  resolveOrionTenantId,
} from './config';
import { acceptOrionSignerTurn, createOrionDocument, getOrionDocument, getOrionDocumentByRef, saveOrionSignatureFields } from './client';
import { mapOrionFieldsToPlacements, normalizeFieldsForStorage, parseEmbedTokenFromUrl, toOrionSignatureFields, type SignatureFieldPlacement } from './signatureFields';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';
import {
  applyOrionVersionHistory,
  ensureOriginalOrionVersion,
} from './documentVersions';
import {
  allSignersCompleted,
  getCurrentPendingSigner,
  isSignerCompleted,
  newlyCompletedSigners,
} from './signerStatus';
import {
  cancelOpenSignerTasks,
  findOrionSignatureTaskTemplate,
  syncOrionSignerTasks,
} from './signerTasks';
import { createOrionSignerAuthorizations, openNextOrionSignerAuthorization } from './signerAuthorizations';

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

export async function upsertOrionFormBag(
  executor: SqlPool | SqlTransaction,
  requestId: number,
  formFieldId: number,
  bag: OrionSignatureBagBag
): Promise<void> {
  const valueText = serializeOrionSignatureBagBag(bag);
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

/** @deprecated Usar upsertOrionFormBag con bag completo. */
export async function upsertOrionFormValue(
  executor: SqlPool | SqlTransaction,
  requestId: number,
  formFieldId: number,
  state: OrionSignatureState
): Promise<void> {
  const fileId = String(state.fileId || ORION_LEGACY_FILE_ID);
  const bag = setOrionDocumentInBag(emptyOrionFormBag(), fileId, state);
  await upsertOrionFormBag(executor, requestId, formFieldId, bag);
}

function mapOrionResponseToState(
  externalRef: string,
  doc: OrionDocumentResponse,
  fileId?: string,
  fileName?: string | null
): OrionSignatureState {
  const orionDocumentId = doc.orionDocumentId;
  return {
    orionDocumentId,
    externalRef: doc.externalRef ?? externalRef,
    fileId,
    fileName: fileName ?? null,
    status: doc.status,
    embedUrl: doc.embedUrl ?? null,
    signedFileUrl: doc.signedFileUrl ?? null,
    signedAt: doc.signedAt ?? null,
    signers: doc.signers,
    auditSummary: doc.auditSummary ?? null,
    ...(doc.signatureFields
      ? { signatureFields: mapOrionFieldsToPlacements(doc.signatureFields, orionDocumentId) }
      : {}),
  };
}

export async function loadOrionFormBag(
  pool: SqlPool,
  requestId: number
): Promise<{ field: NonNullable<Awaited<ReturnType<typeof findOrionSignatureField>>>; bag: OrionSignatureBagBag } | null> {
  const field = await findOrionSignatureField(pool, requestId);
  if (!field) return null;
  return { field, bag: parseOrionSignatureBagBag(field.value_text) };
}

export async function ensureOrionDocumentForRequest(
  pool: SqlPool,
  params: {
    requestId: number;
    createdByEmail: string;
    title?: string;
    pdfBase64?: string;
    refresh?: boolean;
    fileId?: string | null;
    fileName?: string | null;
    originalFileUrl?: string | null;
  }
): Promise<{
  state: OrionSignatureState;
  bag: OrionSignatureBagBag;
  formFieldId: number;
  created: boolean;
  fileId: string;
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

  let bag = parseOrionSignatureBagBag(field.value_text);
  const requestedFileId = String(params.fileId || '').trim();
  const fileId = requestedFileId || ORION_LEGACY_FILE_ID;

  if (requestedFileId && requestedFileId !== ORION_LEGACY_FILE_ID) {
    bag = adoptLegacyOrionDocument(bag, requestedFileId, params.fileName);
  }

  const current = getOrionDocumentFromBag(bag, fileId);
  const externalRef =
    current.externalRef ||
    buildOrionExternalRef(
      params.requestId,
      fileId === ORION_LEGACY_FILE_ID ? null : fileId
    );

  if (current.orionDocumentId && current.embedUrl && !params.refresh && !params.pdfBase64) {
    const state = { ...current, fileId, fileName: params.fileName ?? current.fileName };
    return { state, bag, formFieldId: field.id_form_field, created: false, fileId };
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
      title:
        params.title ||
        params.fileName ||
        ctx.subject_request ||
        `Solicitud #${params.requestId}`,
      createdByEmail,
      pdfBase64: params.pdfBase64,
      metadata: {
        processName: ctx.process ?? undefined,
        categoryName: ctx.category ?? undefined,
        fileId: fileId === ORION_LEGACY_FILE_ID ? undefined : fileId,
        fileName: params.fileName ?? undefined,
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

  const state = applyOrionVersionHistory({
    previous: current,
    next: mergeOrionSignatureState(current, {
      ...mapOrionResponseToState(externalRef, doc, fileId, params.fileName ?? current.fileName),
      originalFileUrl:
        params.originalFileUrl ??
        current.originalFileUrl ??
        null,
    }),
    previousSigners: current.signers,
    originalUrl: params.originalFileUrl ?? current.originalFileUrl ?? null,
  });
  bag = setOrionDocumentInBag(bag, fileId, ensureOriginalOrionVersion(state, params.originalFileUrl));
  await upsertOrionFormBag(pool, params.requestId, field.id_form_field, bag);

  return { state, bag, formFieldId: field.id_form_field, created, fileId };
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

function resolveWebhookFileId(
  bag: OrionSignatureBagBag,
  patch: OrionSignatureState,
  explicitFileId?: string | null
): string {
  const explicit = String(explicitFileId || '').trim();
  if (explicit) return explicit;

  const byId = findOrionDocumentByOrionId(bag, patch.orionDocumentId);
  if (byId) return byId.fileId;

  const byRef = findOrionDocumentByExternalRef(bag, patch.externalRef);
  if (byRef) return byRef.fileId;

  const fromRef = parseFileIdFromExternalRef(patch.externalRef);
  if (fromRef) return fromRef;

  if (bag.documents[ORION_LEGACY_FILE_ID]) return ORION_LEGACY_FILE_ID;

  const first = Object.keys(bag.documents)[0];
  return first || ORION_LEGACY_FILE_ID;
}

export async function applyOrionWebhookToRequest(
  pool: SqlPool,
  params: {
    requestId: number;
    patch: OrionSignatureState;
    status: string;
    auditSummary?: string | null;
    noteAuthorUserId: string | null;
    fileId?: string | null;
  }
): Promise<{
  tasksUpdated: number;
  requestClosed: boolean;
  signerTasksClosed: number;
  signerTasksOpened: number;
  currentSignerEmail: string | null;
  fileId: string;
  bag: OrionSignatureBagBag;
  state: OrionSignatureState;
}> {
  const field = await findOrionSignatureField(pool, params.requestId);
  if (!field) {
    throw Object.assign(new Error('Campo orion_signature no encontrado para la solicitud'), {
      status: 404,
    });
  }

  const ctx = await getRequestOrionContext(pool, params.requestId);
  let bag = parseOrionSignatureBagBag(field.value_text);
  const fileId = resolveWebhookFileId(bag, params.patch, params.fileId);
  const current = getOrionDocumentFromBag(bag, fileId);
  const previousSigners = current.signers;
  let state = mergeOrionSignatureState(current, {
    ...params.patch,
    fileId,
    fileName: params.patch.fileName ?? current.fileName,
  });
  state = applyOrionVersionHistory({
    previous: current,
    next: state,
    previousSigners,
    originalUrl: current.originalFileUrl ?? null,
  });
  bag = setOrionDocumentInBag(bag, fileId, ensureOriginalOrionVersion(state, current.originalFileUrl));
  await upsertOrionFormBag(pool, params.requestId, field.id_form_field, bag);

  const statusUpper = String(params.status).toUpperCase();
  let tasksUpdated = 0;
  let requestClosed = false;

  const syncResult = await syncOrionSignerTasks(pool, {
    requestId: params.requestId,
    state,
    previousSigners,
    subject: ctx?.subject_request ?? null,
    documentStatus: statusUpper,
    fileId,
    fileName: state.fileName,
  });

  tasksUpdated += syncResult.tasksClosed + syncResult.tasksOpened;

  // Asegura autorización Kronos del firmante en turno (el que aún no tiene [orionAuth]).
  if (statusUpper !== 'RECHAZADO' && statusUpper !== 'BORRADOR') {
    try {
      await openNextOrionSignerAuthorization(pool, {
        requestId: params.requestId,
        fileId,
        fileName: state.fileName,
        signers: state.signers,
        subject: ctx?.subject_request ?? null,
      });
    } catch (err) {
      console.warn('[orion/applyWebhook] No se pudo crear auth del siguiente firmante:', err);
    }
  }

  const resolution =
    params.auditSummary ||
    (statusUpper === 'FIRMADO'
      ? `Documento firmado vía GSS Firma (Orion)${state.fileName ? `: ${state.fileName}` : ''}.`
      : statusUpper === 'RECHAZADO'
        ? `Documento rechazado vía GSS Firma (Orion)${state.fileName ? `: ${state.fileName}` : ''}.`
        : 'Actualización de firma digital (Orion).');

  const allRejected = anyOrionDocumentRejected(bag) && statusUpper === 'RECHAZADO';
  const allSigned = allOrionDocumentsFullySigned(bag) && allSignersCompleted(state.signers);

  if (allRejected || (statusUpper === 'RECHAZADO' && Object.keys(bag.documents).length <= 1)) {
    tasksUpdated += await cancelOpenSignerTasks(
      pool,
      params.requestId,
      'Documento rechazado en GSS Firma (Orion).'
    );

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
  } else if (statusUpper === 'FIRMADO' && allSigned) {
    const template = await findOrionSignatureTaskTemplate(pool, params.requestId);
    if (template) {
      await advanceSequentialTask(pool, {
        id_request_general: params.requestId,
        id_task: template.id,
        id_process_category: template.id_process_category,
        display_order: template.display_order,
        subject_request: ctx?.subject_request ?? null,
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
  }

  if (params.noteAuthorUserId) {
    const completed = newlyCompletedSigners(previousSigners, state.signers);
    if (completed.length > 0 && statusUpper !== 'RECHAZADO') {
      for (const signer of completed) {
        await insertRequestNote(
          pool,
          params.requestId,
          `GSS Firma (${state.fileName || fileId}): ${signer.name || signer.email} completó su firma.`,
          params.noteAuthorUserId
        );
      }
    } else if (statusUpper === 'FIRMADO' && allSigned) {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma: todos los documentos firmados. ${resolution}`,
        params.noteAuthorUserId
      );
    } else if (statusUpper === 'RECHAZADO') {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma: documento rechazado. ${resolution}`,
        params.noteAuthorUserId
      );
    } else if (statusUpper === 'EN_PROCESO' && syncResult.tasksOpened > 0) {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma (${state.fileName || fileId}): turno de firma para ${syncResult.currentSignerEmail}.`,
        params.noteAuthorUserId
      );
    }
  }

  return {
    tasksUpdated,
    requestClosed,
    signerTasksClosed: syncResult.tasksClosed,
    signerTasksOpened: syncResult.tasksOpened,
    currentSignerEmail: syncResult.currentSignerEmail,
    fileId,
    bag,
    state,
  };
}

/** Sincroniza estado desde Orion GET y persiste en request_form_value (por fileId). */
export async function syncOrionDocumentState(
  pool: SqlPool,
  requestId: number,
  fileId?: string | null
): Promise<{ state: OrionSignatureState; bag: OrionSignatureBagBag; fileId: string } | null> {
  const loaded = await loadOrionFormBag(pool, requestId);
  if (!loaded) return null;

  let { bag } = loaded;
  const requested = String(fileId || '').trim();

  const targets = requested
    ? [requested]
    : Object.keys(bag.documents).length > 0
      ? Object.keys(bag.documents)
      : [];

  if (targets.length === 0) {
    return {
      state: {},
      bag,
      fileId: ORION_LEGACY_FILE_ID,
    };
  }

  for (const fid of targets) {
    const current = getOrionDocumentFromBag(bag, fid);
    if (!current.orionDocumentId) continue;

    const live = await getOrionDocument(current.orionDocumentId);
    if (!live.ok || !live.data) continue;

    const externalRef =
      current.externalRef ||
      buildOrionExternalRef(requestId, fid === ORION_LEGACY_FILE_ID ? null : fid);
    const state = mergeOrionSignatureState(
      current,
      mapOrionResponseToState(externalRef, live.data, fid, current.fileName)
    );
    bag = setOrionDocumentInBag(bag, fid, state);
  }

  await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

  const primaryId = requested || targets[0]!;
  return {
    state: getOrionDocumentFromBag(bag, primaryId),
    bag,
    fileId: primaryId,
  };
}

export async function persistOrionSignatureFields(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    fields: SignatureFieldPlacement[];
  }
): Promise<{ state: OrionSignatureState; bag: OrionSignatureBagBag }> {
  const loaded = await loadOrionFormBag(pool, params.requestId);
  if (!loaded) {
    throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
  }

  const fileId = String(params.fileId || '').trim();
  const current = getOrionDocumentFromBag(loaded.bag, fileId);
  const orionDocumentId = String(current.orionDocumentId || '').trim();
  if (!orionDocumentId) {
    throw Object.assign(new Error('Documento Orion no creado aún para este adjunto'), {
      status: 400,
    });
  }

  const normalized = normalizeFieldsForStorage(params.fields, orionDocumentId);
  let embedUrl = current.embedUrl ?? null;
  let embedToken = parseEmbedTokenFromUrl(embedUrl);

  if (!embedToken) {
    const live = await getOrionDocument(orionDocumentId);
    if (live.ok && live.data?.embedUrl) {
      embedUrl = live.data.embedUrl;
      embedToken = parseEmbedTokenFromUrl(embedUrl);
    }
  }

  if (!embedToken) {
    throw Object.assign(
      new Error('No se obtuvo token de embed de Orion para guardar ubicaciones de firma'),
      { status: 502 }
    );
  }

  const saved = await saveOrionSignatureFields({
    orionDocumentId,
    embedToken,
    signatureFields: toOrionSignatureFields(normalized),
  });

  if (!saved.ok) {
    throw Object.assign(new Error(saved.error || 'Orion rechazó las ubicaciones de firma'), {
      status: saved.status >= 400 ? saved.status : 502,
    });
  }

  const externalRef =
    current.externalRef ||
    buildOrionExternalRef(params.requestId, fileId === ORION_LEGACY_FILE_ID ? null : fileId);

  let merged = mergeOrionSignatureState(current, {
    signatureFields: normalized,
    embedUrl: saved.data?.embedUrl ?? embedUrl,
  });

  if (saved.data) {
    merged = mergeOrionSignatureState(
      merged,
      mapOrionResponseToState(externalRef, saved.data, fileId, current.fileName)
    );
    merged = { ...merged, signatureFields: normalized };
  }

  const bag = setOrionDocumentInBag(loaded.bag, fileId, merged);
  await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, bag);

  return { state: merged, bag };
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
        -- Tareas Orion de firmante/auth no otorgan rol de coordinador
        AND CHARINDEX(N'[orionFile:', ISNULL(trg.resolution, N'')) = 0
        AND CHARINDEX(N'[orionAuth]', ISNULL(trg.resolution, N'')) = 0
        AND CHARINDEX(N'Pendiente de firma', ISNULL(trg.resolution, N'')) = 0
    `);

  return Boolean(assigned.recordset[0]);
}

/** Solicitud cerrada (resuelta/cancelada) → no editar firmantes. */
export async function isOrionRequestWorkflowLocked(
  pool: SqlPool,
  requestId: number
): Promise<boolean> {
  const result = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`SELECT TOP 1 status_req FROM requests_general WHERE id = @id`);

  const status = Number(result.recordset[0]?.status_req);
  return status === 2 || status === 3;
}

function normalizeSignerEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * Sincroniza el estado desde Orion tras la firma de un firmante y cierra su tarea.
 */
export async function finalizeSignerTurn(
  pool: SqlPool,
  params: {
    requestId: number;
    userId: string;
    userEmail: string;
    fileId?: string | null;
  }
): Promise<{
  state: OrionSignatureState;
  bag: OrionSignatureBagBag;
  fileId: string;
  signerCompleted: boolean;
  tasksUpdated: number;
  requestClosed: boolean;
  signerTasksClosed: number;
  signerTasksOpened: number;
  currentSignerEmail: string | null;
}> {
  const loaded = await loadOrionFormBag(pool, params.requestId);
  if (!loaded) {
    throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
  }

  let { bag } = loaded;
  const me = normalizeSignerEmail(params.userEmail);

  let fileId = String(params.fileId || '').trim();
  if (!fileId) {
    // Si no viene fileId, buscar el doc donde el usuario es firmante pendiente
    for (const [fid, doc] of Object.entries(bag.documents)) {
      const pending = getCurrentPendingSigner(doc.signers);
      if (pending && normalizeSignerEmail(pending.email) === me) {
        fileId = fid;
        break;
      }
    }
  }
  if (!fileId) {
    fileId = Object.keys(bag.documents)[0] || ORION_LEGACY_FILE_ID;
  }

  const current = getOrionDocumentFromBag(bag, fileId);
  if (!current.orionDocumentId) {
    throw Object.assign(new Error('No hay documento Orion para este archivo'), { status: 422 });
  }

  const previousSigners = current.signers;
  const live = await getOrionDocument(current.orionDocumentId);
  if (!live.ok || !live.data) {
    throw Object.assign(new Error(live.error || 'No se pudo consultar Orion'), {
      status: live.status >= 500 ? 503 : 502,
    });
  }

  const externalRef =
    current.externalRef ||
    buildOrionExternalRef(params.requestId, fileId === ORION_LEGACY_FILE_ID ? null : fileId);
  let liveState = mergeOrionSignatureState(
    current,
    mapOrionResponseToState(externalRef, live.data, fileId, current.fileName)
  );

  const mySigner = liveState.signers?.find((s) => normalizeSignerEmail(s.email) === me);
  if (!mySigner) {
    throw Object.assign(new Error('No es firmante de este documento'), { status: 403 });
  }

  const pending = getCurrentPendingSigner(liveState.signers);
  const isMyTurn = Boolean(pending && normalizeSignerEmail(pending.email) === me);
  const alreadyCompleted = isSignerCompleted(mySigner.status);

  if (!isMyTurn && !alreadyCompleted) {
    throw Object.assign(new Error('Aún no es su turno para firmar'), { status: 403 });
  }

  // Aplicar firma con la rúbrica guardada (sin embed de gestión Orion)
  if (isMyTurn && !alreadyCompleted) {
    const accept = await acceptOrionSignerTurn(current.orionDocumentId, params.userEmail);
    let acceptedLocally = false;

    if (accept.ok && accept.data) {
      liveState = mergeOrionSignatureState(
        liveState,
        mapOrionResponseToState(externalRef, accept.data, fileId, current.fileName)
      );
    } else {
      console.warn(
        '[orion/finalizeSignerTurn] accept-sign no disponible, confirmación local:',
        accept.error || accept.status
      );
      acceptedLocally = true;
      liveState = {
        ...liveState,
        signers: (liveState.signers ?? []).map((s) =>
          normalizeSignerEmail(s.email) === me
            ? {
                ...s,
                status: 'FIRMADO',
                signedAt: s.signedAt ?? new Date().toISOString(),
              }
            : s
        ),
      };
    }

    const refreshed = await getOrionDocument(current.orionDocumentId);
    if (refreshed.ok && refreshed.data) {
      const refreshedState = mergeOrionSignatureState(
        liveState,
        mapOrionResponseToState(externalRef, refreshed.data, fileId, current.fileName)
      );
      const meRefreshed = refreshedState.signers?.find(
        (s) => normalizeSignerEmail(s.email) === me
      );
      // Si accept-sign falló y Orion aún no refleja FIRMADO, no pisar el cierre local
      // (si no, el turno no avanza y el firmante debe "firmar dos veces").
      if (acceptedLocally && meRefreshed && !isSignerCompleted(meRefreshed.status)) {
        liveState = {
          ...refreshedState,
          signers: (refreshedState.signers ?? []).map((s) =>
            normalizeSignerEmail(s.email) === me
              ? {
                  ...s,
                  status: 'FIRMADO',
                  signedAt: s.signedAt ?? new Date().toISOString(),
                }
              : s
          ),
        };
      } else {
        liveState = refreshedState;
      }
    }
  }

  liveState = applyOrionVersionHistory({
    previous: current,
    next: liveState,
    previousSigners,
    originalUrl: current.originalFileUrl ?? null,
  });

  const statusUpper = String(liveState.status || 'EN_PROCESO').toUpperCase();
  const outcome = await applyOrionWebhookToRequest(pool, {
    requestId: params.requestId,
    status: statusUpper,
    auditSummary: liveState.auditSummary,
    noteAuthorUserId: params.userId,
    patch: liveState,
    fileId,
  });

  const completed = newlyCompletedSigners(previousSigners, outcome.state.signers);
  const meAfter = outcome.state.signers?.find((s) => normalizeSignerEmail(s.email) === me);
  const signerCompleted =
    completed.some((s) => normalizeSignerEmail(s.email) === me) ||
    Boolean(meAfter && isSignerCompleted(meAfter.status));

  return {
    state: outcome.state,
    bag: outcome.bag,
    fileId: outcome.fileId,
    signerCompleted,
    tasksUpdated: outcome.tasksUpdated,
    requestClosed: outcome.requestClosed,
    signerTasksClosed: outcome.signerTasksClosed,
    signerTasksOpened: outcome.signerTasksOpened,
    currentSignerEmail: outcome.currentSignerEmail,
  };
}
