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
import { acceptOrionSignerTurn, buildOrionSignedFileApiUrl, createOrionDocument, getOrionDocument, getOrionDocumentByRef, rebuildOrionSignedPdf, returnOrionDocument, saveOrionSignatureFields } from './client';
import { mapOrionFieldsToPlacements, normalizeFieldsForStorage, parseEmbedTokenFromUrl, toOrionSignatureFields, type SignatureFieldPlacement } from './signatureFields';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';
import {
  applyOrionVersionHistory,
  ensureOriginalOrionVersion,
  rebuildOrionVersionHistory,
} from './documentVersions';
import {
  allSignersCompleted,
  allSlotsCompletedForEmail,
  getCurrentPendingSigner,
  isSignerCompleted,
  newlyCompletedSigners,
  orderedSigners,
  signerSlotKey,
} from './signerStatus';
import {
  cancelOpenSignerTasks,
  findOrionSignatureTaskTemplate,
  syncOrionSignerTasks,
} from './signerTasks';
import { openNextOrionSignerAuthorization } from './signerAuthorizations';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken.jsx';
import type { SignerAcceptIdentity } from './signerIdentity';
import { normalizeSignerIdentity } from './signerIdentity';
import {
  fireAndForgetNotification,
  notifyOrionSignatureProgress,
} from '../notificationEvents.js';
import {
  applyPendingSignerTurnDeadline,
  isSignerTurnExpired,
} from './signerDeadline';

type SqlPool = import('mssql').ConnectionPool;
type SqlTransaction = import('mssql').Transaction;

/** Descarga el PDF original desde URL pública o OneDrive (item id = fileId). */
export async function resolveOriginalPdfBase64(params: {
  fileId: string;
  originalFileUrl?: string | null;
  versions?: OrionSignatureState['versions'];
}): Promise<{ base64: string | null; sourceUrl: string | null }> {
  const tryUrl = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.byteLength > 0 ? buf.toString('base64') : null;
    } catch {
      return null;
    }
  };

  const candidates = [
    String(params.originalFileUrl || '').trim(),
    String(params.versions?.find((v) => v.kind === 'original')?.url || '').trim(),
  ].filter(Boolean);

  for (const url of candidates) {
    const base64 = await tryUrl(url);
    if (base64) return { base64, sourceUrl: url };
  }

  const fileId = String(params.fileId || '').trim();
  const graph = String(process.env.MICROSOFTGRAPHUSERROUTE || '').trim();
  if (!fileId || !graph || fileId === ORION_LEGACY_FILE_ID) {
    return { base64: null, sourceUrl: null };
  }

  try {
    const token = await getMicrosoftToken();
    const metaRes = await fetch(`${graph}items/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        '@microsoft.graph.downloadUrl'?: string;
        webUrl?: string;
      };
      const downloadUrl = String(meta['@microsoft.graph.downloadUrl'] || '').trim();
      if (downloadUrl) {
        const base64 = await tryUrl(downloadUrl);
        if (base64) return { base64, sourceUrl: downloadUrl };
      }
    }

    const contentRes = await fetch(`${graph}items/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'follow',
    });
    if (contentRes.ok) {
      const buf = Buffer.from(await contentRes.arrayBuffer());
      if (buf.byteLength > 0) {
        return { base64: buf.toString('base64'), sourceUrl: contentRes.url || null };
      }
    }
  } catch (err) {
    console.warn('[orion] resolveOriginalPdfBase64 OneDrive:', err);
  }

  return { base64: null, sourceUrl: null };
}

export type RequestOrionContext = {
  id: number;
  id_company: number;
  subject_request: string;
  process: string | null;
  category: string | null;
  requester_email: string | null;
  id_requester: string | null;
  company_name: string | null;
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
        rg.id_requester,
        c.company AS company_name
      FROM requests_general rg
      LEFT JOIN process_category_request_general pcr ON pcr.id_request_general = rg.id
      LEFT JOIN process_category pc ON pc.id = pcr.id_process_category
      LEFT JOIN category_request cr ON cr.id = pc.id_category_request
      LEFT JOIN [user] u ON u.id = rg.id_requester
      LEFT JOIN company c ON c.id_company = rg.id_company
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

/**
 * Asegura campo orion_signature en el proceso de la solicitud
 * (solicitudes normales sin plantilla FIRMA previa).
 */
export async function ensureOrionSignatureFieldForRequest(
  pool: SqlPool,
  requestId: number
): Promise<{ id_form_field: number; value_text: string | null; rfv_id: number | null }> {
  const existing = await findOrionSignatureField(pool, requestId);
  if (existing) return existing;

  const pc = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`
      SELECT TOP 1 id_process_category
      FROM process_category_request_general
      WHERE id_request_general = @id
      ORDER BY id
    `);
  const idProcessCategory = Number(pc.recordset[0]?.id_process_category);
  if (!Number.isInteger(idProcessCategory) || idProcessCategory <= 0) {
    throw Object.assign(
      new Error('La solicitud no tiene proceso asociado para firma digital'),
      { status: 422 }
    );
  }

  const found = await pool
    .request()
    .input('pc', sql.Int, idProcessCategory)
    .input('fieldType', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
    .query(`
      SELECT TOP 1 id, active
      FROM process_form_field
      WHERE id_process_category = @pc AND field_type = @fieldType
      ORDER BY id
    `);

  let formFieldId = Number(found.recordset[0]?.id);
  if (Number.isInteger(formFieldId) && formFieldId > 0) {
    if (!(Number(found.recordset[0]?.active) === 1 || found.recordset[0]?.active === true)) {
      await pool
        .request()
        .input('id', sql.Int, formFieldId)
        .query(`UPDATE process_form_field SET active = 1 WHERE id = @id`);
    }
  } else {
    const inserted = await pool
      .request()
      .input('pc', sql.Int, idProcessCategory)
      .input('label', sql.NVarChar(255), 'Firma digital')
      .input('fieldType', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
      .query(`
        INSERT INTO process_form_field
          (id_process_category, field_label, field_type, required, active, display_order)
        OUTPUT INSERTED.id
        VALUES (@pc, @label, @fieldType, 0, 1, 900)
      `);
    formFieldId = Number(inserted.recordset[0]?.id);
  }

  if (!Number.isInteger(formFieldId) || formFieldId <= 0) {
    throw Object.assign(new Error('No se pudo crear el campo de firma digital'), {
      status: 500,
    });
  }

  return {
    id_form_field: formFieldId,
    value_text: null,
    rfv_id: null,
  };
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

/** Carga el bag; si el proceso no tiene campo orion_signature, lo crea. */
export async function loadOrionFormBagEnsured(
  pool: SqlPool,
  requestId: number
): Promise<{
  field: { id_form_field: number; value_text: string | null; rfv_id: number | null };
  bag: OrionSignatureBagBag;
}> {
  const field = await ensureOrionSignatureFieldForRequest(pool, requestId);
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

  const field = await ensureOrionSignatureFieldForRequest(pool, params.requestId);

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
    if (!tenantId) {
      throw Object.assign(
        new Error(
          `Empresa SynerLink id_company=${ctx.id_company} (${ctx.company_name || 'sin nombre'}) no está mapeada a un tenant Orion. Configure ORION_TENANT_MAP (p. ej. {"1":"farmalogica"}).`
        ),
        { status: 422 }
      );
    }
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

    let pdfBase64 = params.pdfBase64;
    let resolvedOriginalUrl = params.originalFileUrl ?? current.originalFileUrl ?? null;
    if (!pdfBase64 && fileId !== ORION_LEGACY_FILE_ID) {
      const resolved = await resolveOriginalPdfBase64({
        fileId,
        originalFileUrl: resolvedOriginalUrl,
        versions: current.versions,
      });
      if (resolved.base64) {
        pdfBase64 = resolved.base64;
        if (resolved.sourceUrl) resolvedOriginalUrl = resolved.sourceUrl;
      }
    }

    const createRes = await createOrionDocument({
      externalRef,
      synerlinkRequestId: params.requestId,
      synerlinkCompanyId: ctx.id_company,
      tenantId,
      title:
        params.title ||
        params.fileName ||
        ctx.subject_request ||
        `Solicitud #${params.requestId}`,
      createdByEmail,
      pdfBase64,
      metadata: {
        source: 'synerlink',
        synerlinkRequestId: params.requestId,
        synerlinkCompanyId: ctx.id_company,
        companyName: ctx.company_name ?? undefined,
        processName: ctx.process ?? undefined,
        categoryName: ctx.category ?? undefined,
        fileId: fileId === ORION_LEGACY_FILE_ID ? undefined : fileId,
        fileName: params.fileName ?? undefined,
        createdByEmail,
      },
    });

    if (!createRes.ok || !createRes.data) {
      throw Object.assign(new Error(createRes.error || 'No se pudo crear el documento en Orion'), {
        status: createRes.status >= 500 ? 503 : 502,
      });
    }
    doc = createRes.data;
    created = createRes.status === 201;

    const state = applyOrionVersionHistory({
      previous: current,
      next: mergeOrionSignatureState(current, {
        ...mapOrionResponseToState(externalRef, doc, fileId, params.fileName ?? current.fileName),
        originalFileUrl: resolvedOriginalUrl,
        signatureIntent: 'sign',
      }),
      previousSigners: current.signers,
      originalUrl: resolvedOriginalUrl,
    });
    bag = setOrionDocumentInBag(bag, fileId, ensureOriginalOrionVersion(state, resolvedOriginalUrl));
    await upsertOrionFormBag(pool, params.requestId, field.id_form_field, bag);

    return { state, bag, formFieldId: field.id_form_field, created, fileId };
  }

  const state = applyOrionVersionHistory({
    previous: current,
    next: mergeOrionSignatureState(current, {
      ...mapOrionResponseToState(externalRef, doc, fileId, params.fileName ?? current.fileName),
      originalFileUrl:
        params.originalFileUrl ??
        current.originalFileUrl ??
        null,
      // Siempre "sign" al tocar el doc en Orion: evita residual "view" que bloquea Firmar
      signatureIntent: 'sign',
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
    /** Bag ya cargado en memoria (evita re-leer el campo). */
    bag?: OrionSignatureBagBag;
    fieldId?: number;
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
  let fieldId = params.fieldId;
  let bag = params.bag;
  if (!bag || !fieldId) {
    const field = await findOrionSignatureField(pool, params.requestId);
    if (!field) {
      throw Object.assign(new Error('Campo orion_signature no encontrado para la solicitud'), {
        status: 404,
      });
    }
    fieldId = field.id_form_field;
    bag = bag ?? parseOrionSignatureBagBag(field.value_text);
  }

  const ctx = await getRequestOrionContext(pool, params.requestId);
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
  await upsertOrionFormBag(pool, params.requestId, fieldId, bag);

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

  // Asegura autorización Kronos del firmante en turno (notificación → Autorizaciones).
  if (
    statusUpper !== 'RECHAZADO' &&
    statusUpper !== 'BORRADOR' &&
    statusUpper !== 'DEVUELTO'
  ) {
    try {
      const authNext = await openNextOrionSignerAuthorization(pool, {
        requestId: params.requestId,
        fileId,
        fileName: state.fileName,
        signers: state.signers,
        subject: ctx?.subject_request ?? null,
      });
      if (authNext.errors.length) {
        console.warn('[orion/applyWebhook] Auth siguiente firmante:', authNext.errors);
      }
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
        : statusUpper === 'DEVUELTO'
          ? `Documento devuelto para corrección (Orion)${state.fileName ? `: ${state.fileName}` : ''}.`
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
  } else if (statusUpper === 'DEVUELTO') {
    // Devolución: cancela turnos de firma, NO cierra la solicitud (coordinador corrige y reenvía).
    tasksUpdated += await cancelOpenSignerTasks(
      pool,
      params.requestId,
      `Documento devuelto para corrección${state.fileName ? `: ${state.fileName}` : ''}.`,
      fileId
    );
  } else if (statusUpper === 'FIRMADO' && allSigned) {
    // Firmas completas: avanza el workflow secuencial de firma, pero NO cierra la
    // solicitud. Pueden quedar otras tareas (p. ej. Validación Planeación).
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
  }

  if (params.noteAuthorUserId) {
    const completed = newlyCompletedSigners(previousSigners, state.signers);
    const totalSigners = orderedSigners(state.signers).length;
    if (completed.length > 0 && statusUpper !== 'RECHAZADO' && statusUpper !== 'DEVUELTO') {
      for (const signer of completed) {
        const order = Number(signer.order);
        const position =
          Number.isFinite(order) && order > 0
            ? order
            : orderedSigners(state.signers).findIndex(
                (s) =>
                  String(s.email || '').trim().toLowerCase() ===
                  String(signer.email || '').trim().toLowerCase()
              ) + 1;
        const positionLabel =
          totalSigners > 0 && position > 0 ? `firmante ${position}/${totalSigners}` : 'firmante';
        await insertRequestNote(
          pool,
          params.requestId,
          `GSS Firma (${state.fileName || fileId}): ${positionLabel} — ${signer.name || signer.email} completó su firma.`,
          params.noteAuthorUserId
        );
        fireAndForgetNotification(
          notifyOrionSignatureProgress({
            requestId: params.requestId,
            subject: ctx?.subject_request ?? null,
            fileName: state.fileName || null,
            event: 'signer_completed',
            signerLabel: signer.name || signer.email || null,
            positionLabel,
            excludeEmail: signer.email || null,
          })
        );
      }
      if (statusUpper === 'FIRMADO' && allSigned) {
        fireAndForgetNotification(
          notifyOrionSignatureProgress({
            requestId: params.requestId,
            subject: ctx?.subject_request ?? null,
            fileName: state.fileName || null,
            event: 'all_signed',
          })
        );
      } else if (syncResult.currentSignerEmail) {
        fireAndForgetNotification(
          notifyOrionSignatureProgress({
            requestId: params.requestId,
            subject: ctx?.subject_request ?? null,
            fileName: state.fileName || null,
            event: 'turn',
            nextSignerEmail: syncResult.currentSignerEmail,
            excludeEmail: syncResult.currentSignerEmail,
          })
        );
      }
    } else if (statusUpper === 'FIRMADO' && allSigned) {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma: todos los documentos firmados. ${resolution}`,
        params.noteAuthorUserId
      );
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'all_signed',
        })
      );
    } else if (statusUpper === 'RECHAZADO') {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma: documento rechazado. ${resolution}`,
        params.noteAuthorUserId
      );
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'rejected',
        })
      );
    } else if (statusUpper === 'DEVUELTO') {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma: documento devuelto para corrección. ${resolution}`,
        params.noteAuthorUserId
      );
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'returned',
        })
      );
    } else if (statusUpper === 'EN_PROCESO' && syncResult.tasksOpened > 0) {
      await insertRequestNote(
        pool,
        params.requestId,
        `GSS Firma (${state.fileName || fileId}): turno de firma para ${syncResult.currentSignerEmail}.`,
        params.noteAuthorUserId
      );
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'turn',
          nextSignerEmail: syncResult.currentSignerEmail,
          excludeEmail: syncResult.currentSignerEmail,
        })
      );
    }
  } else {
    // Webhook Orion sin autor de nota: igual notificar progreso al solicitante.
    const completed = newlyCompletedSigners(previousSigners, state.signers);
    const totalSigners = orderedSigners(state.signers).length;
    if (completed.length > 0 && statusUpper !== 'RECHAZADO' && statusUpper !== 'DEVUELTO') {
      for (const signer of completed) {
        const order = Number(signer.order);
        const position =
          Number.isFinite(order) && order > 0
            ? order
            : orderedSigners(state.signers).findIndex(
                (s) =>
                  String(s.email || '').trim().toLowerCase() ===
                  String(signer.email || '').trim().toLowerCase()
              ) + 1;
        const positionLabel =
          totalSigners > 0 && position > 0 ? `firmante ${position}/${totalSigners}` : 'firmante';
        fireAndForgetNotification(
          notifyOrionSignatureProgress({
            requestId: params.requestId,
            subject: ctx?.subject_request ?? null,
            fileName: state.fileName || null,
            event: 'signer_completed',
            signerLabel: signer.name || signer.email || null,
            positionLabel,
            excludeEmail: signer.email || null,
          })
        );
      }
      if (statusUpper === 'FIRMADO' && allSigned) {
        fireAndForgetNotification(
          notifyOrionSignatureProgress({
            requestId: params.requestId,
            subject: ctx?.subject_request ?? null,
            fileName: state.fileName || null,
            event: 'all_signed',
          })
        );
      } else if (syncResult.currentSignerEmail) {
        fireAndForgetNotification(
          notifyOrionSignatureProgress({
            requestId: params.requestId,
            subject: ctx?.subject_request ?? null,
            fileName: state.fileName || null,
            event: 'turn',
            nextSignerEmail: syncResult.currentSignerEmail,
            excludeEmail: syncResult.currentSignerEmail,
          })
        );
      }
    } else if (statusUpper === 'FIRMADO' && allSigned) {
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'all_signed',
        })
      );
    } else if (statusUpper === 'RECHAZADO') {
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'rejected',
        })
      );
    } else if (statusUpper === 'DEVUELTO') {
      fireAndForgetNotification(
        notifyOrionSignatureProgress({
          requestId: params.requestId,
          subject: ctx?.subject_request ?? null,
          fileName: state.fileName || null,
          event: 'returned',
        })
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
  fileId?: string | null,
  options?: {
    /** Regenerar PDF acumulado en Orion (lento; solo cuando haga falta). */
    rebuildSigned?: boolean;
    /** Solo docs en flujo activo (omite FIRMADO/RECHAZADO/BORRADOR). */
    activeOnly?: boolean;
  }
): Promise<{ state: OrionSignatureState; bag: OrionSignatureBagBag; fileId: string } | null> {
  const rebuildSigned = Boolean(options?.rebuildSigned);
  const loaded = await loadOrionFormBag(pool, requestId);
  if (!loaded) return null;

  let { bag } = loaded;
  const bagBefore = serializeOrionSignatureBagBag(bag);
  const requested = String(fileId || '').trim();

  let targets = requested
    ? [requested]
    : Object.keys(bag.documents).length > 0
      ? Object.keys(bag.documents)
      : [];

  if (options?.activeOnly && !requested) {
    targets = targets.filter((fid) => {
      const st = String(getOrionDocumentFromBag(bag, fid).status || '').toUpperCase();
      return st === 'PENDIENTE_FIRMA' || st === 'EN_PROCESO' || st === 'DEVUELTO';
    });
  }

  if (targets.length === 0) {
    return {
      state: {},
      bag,
      fileId: ORION_LEGACY_FILE_ID,
    };
  }

  const withOrionId = targets.filter((fid) => Boolean(getOrionDocumentFromBag(bag, fid).orionDocumentId));

  // Soft multi-doc: GETs Orion en paralelo (límite pequeño).
  const CONCURRENCY = 4;
  const liveByFile = new Map<
    string,
    { ok: boolean; data: OrionDocumentResponse | null; error?: string }
  >();
  for (let i = 0; i < withOrionId.length; i += CONCURRENCY) {
    const chunk = withOrionId.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (fid) => {
        const current = getOrionDocumentFromBag(bag, fid);
        const live = await getOrionDocument(String(current.orionDocumentId));
        return [fid, live] as const;
      })
    );
    for (const [fid, live] of results) {
      liveByFile.set(fid, live);
    }
  }

  for (const fid of targets) {
    const current = getOrionDocumentFromBag(bag, fid);
    if (!current.orionDocumentId) continue;

    const live = liveByFile.get(fid);
    if (!live?.ok || !live.data) continue;

    const externalRef =
      current.externalRef ||
      buildOrionExternalRef(requestId, fid === ORION_LEGACY_FILE_ID ? null : fid);
    let state = mergeOrionSignatureState(
      current,
      mapOrionResponseToState(externalRef, live.data, fid, current.fileName)
    );

    // Solo normalizar slots con evidencia de firma (signedAt / status).
    // No marcar PENDIENTE→FIRMADO solo porque Orion diga FIRMADO: eso bloquea
    // la notificación/autorización del siguiente firmante.
    const liveStatus = String(state.status || '').toUpperCase();
    if ((state.signers?.length ?? 0) > 0) {
      const normalized = (state.signers ?? []).map((s) => {
        if (isSignerCompleted(s.status) || !s.signedAt) return s;
        return { ...s, status: 'FIRMADO' as const };
      });
      const changed = normalized.some((s, i) => s !== state.signers![i]);
      if (changed || (['FIRMADO', 'SIGNED', 'COMPLETED'].includes(liveStatus) && allSignersCompleted(normalized))) {
        state = {
          ...state,
          signers: normalized,
          status: allSignersCompleted(normalized)
            ? 'FIRMADO'
            : state.status && liveStatus !== 'BORRADOR'
              ? state.status
              : 'EN_PROCESO',
        };
      }
    }

    const signedCount = (state.signers ?? []).filter((s) => isSignerCompleted(s.status)).length;
    // Documentos ya firmados: regenera PDF acumulado en Orion (corrige solo-1.ª-firma).
    // Costoso (OneDrive + Orion); omitir en bootstrap/polling rutinario.
    if (rebuildSigned && signedCount > 0 && state.orionDocumentId) {
      const resolved = await resolveOriginalPdfBase64({
        fileId: fid,
        originalFileUrl: state.originalFileUrl ?? current.originalFileUrl,
        versions: state.versions ?? current.versions,
      });
      if (resolved.sourceUrl && !state.originalFileUrl) {
        state = { ...state, originalFileUrl: resolved.sourceUrl };
      }
      const rebuild = await rebuildOrionSignedPdf(String(state.orionDocumentId), {
        originalPdfBase64: resolved.base64,
      });
      if (rebuild.ok && rebuild.data) {
        state = mergeOrionSignatureState(
          state,
          mapOrionResponseToState(externalRef, rebuild.data, fid, current.fileName)
        );
      }
    }

    // Fuerza historial correcto (original → firmantes en orden → final)
    state = rebuildOrionVersionHistory(
      state,
      state.originalFileUrl ?? current.originalFileUrl ?? null,
      buildOrionSignedFileApiUrl(String(state.orionDocumentId || current.orionDocumentId))
    );
    bag = setOrionDocumentInBag(bag, fid, state);
  }

  const bagAfter = serializeOrionSignatureBagBag(bag);
  if (bagAfter !== bagBefore) {
    await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);
  }

  const primaryId = requested || targets[0]!;
  return {
    state: getOrionDocumentFromBag(bag, primaryId),
    bag,
    fileId: primaryId,
  };
}

export type RepairOrionDocumentResult = {
  requestId: number;
  fileId: string;
  orionDocumentId: string | null;
  rebuiltPdf: boolean;
  versions: number;
  signedCount: number;
  error?: string;
};

/**
 * Corrige documentos ya firmados: regenera PDF en Orion + reconstruye versiones en Kronos.
 */
export async function repairOrionDocuments(
  pool: SqlPool,
  params: { requestId?: number | null; all?: boolean } = {}
): Promise<{ repaired: RepairOrionDocumentResult[]; total: number }> {
  const requestIds: number[] = [];

  if (params.requestId != null && Number.isInteger(params.requestId) && params.requestId > 0) {
    requestIds.push(params.requestId);
  } else if (params.all) {
    const rows = await pool.request().query(`
      SELECT DISTINCT rfv.id_request_general AS id_request
      FROM request_form_value rfv
      INNER JOIN process_form_field pff ON pff.id = rfv.id_form_field
      WHERE pff.field_type = 'orion_signature'
        AND rfv.value_text IS NOT NULL
        AND LEN(LTRIM(RTRIM(rfv.value_text))) > 2
      ORDER BY rfv.id_request_general DESC
    `);
    for (const row of rows.recordset as Array<{ id_request: number }>) {
      const id = Number(row.id_request);
      if (Number.isInteger(id) && id > 0) requestIds.push(id);
    }
  } else {
    throw Object.assign(new Error('Indique requestId o all=true'), { status: 400 });
  }

  const repaired: RepairOrionDocumentResult[] = [];

  for (const requestId of requestIds) {
    const loaded = await loadOrionFormBag(pool, requestId);
    if (!loaded) {
      repaired.push({
        requestId,
        fileId: ORION_LEGACY_FILE_ID,
        orionDocumentId: null,
        rebuiltPdf: false,
        versions: 0,
        signedCount: 0,
        error: 'Sin campo orion_signature',
      });
      continue;
    }

    let bag = loaded.bag;
    const fileIds = Object.keys(bag.documents);
    if (fileIds.length === 0) {
      repaired.push({
        requestId,
        fileId: ORION_LEGACY_FILE_ID,
        orionDocumentId: null,
        rebuiltPdf: false,
        versions: 0,
        signedCount: 0,
        error: 'Sin documentos en bag',
      });
      continue;
    }

    for (const fileId of fileIds) {
      const current = getOrionDocumentFromBag(bag, fileId);
      const orionDocumentId = String(current.orionDocumentId || '').trim() || null;
      if (!orionDocumentId) {
        repaired.push({
          requestId,
          fileId,
          orionDocumentId: null,
          rebuiltPdf: false,
          versions: current.versions?.length ?? 0,
          signedCount: 0,
          error: 'Sin orionDocumentId',
        });
        continue;
      }

      let rebuiltPdf = false;
      let error: string | undefined;
      const signedCount = (current.signers ?? []).filter((s) => isSignerCompleted(s.status)).length;

      if (signedCount > 0) {
        const resolved = await resolveOriginalPdfBase64({
          fileId,
          originalFileUrl: current.originalFileUrl,
          versions: current.versions,
        });

        const rebuild = await rebuildOrionSignedPdf(orionDocumentId, {
          originalPdfBase64: resolved.base64,
        });

        if (rebuild.ok) {
          rebuiltPdf = true;
          error = undefined;
          if (resolved.sourceUrl && !current.originalFileUrl) {
            bag = setOrionDocumentInBag(bag, fileId, {
              ...current,
              originalFileUrl: resolved.sourceUrl,
            });
          }
        } else {
          error = rebuild.error || `Orion rebuild ${rebuild.status}`;
          if (!resolved.base64) {
            error = `${error} (sin PDF original en bag/OneDrive)`;
          }
        }
      }

      const live = await getOrionDocument(orionDocumentId);
      const externalRef =
        current.externalRef ||
        buildOrionExternalRef(requestId, fileId === ORION_LEGACY_FILE_ID ? null : fileId);
      const latest = getOrionDocumentFromBag(bag, fileId);
      let state =
        live.ok && live.data
          ? mergeOrionSignatureState(
              latest,
              mapOrionResponseToState(externalRef, live.data, fileId, latest.fileName)
            )
          : { ...latest };

      state = rebuildOrionVersionHistory(
        state,
        state.originalFileUrl ?? latest.originalFileUrl ?? null,
        buildOrionSignedFileApiUrl(orionDocumentId)
      );
      bag = setOrionDocumentInBag(bag, fileId, state);

      repaired.push({
        requestId,
        fileId,
        orionDocumentId,
        rebuiltPdf,
        versions: state.versions?.length ?? 0,
        signedCount,
        error,
      });
    }

    await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);
  }

  return { repaired, total: repaired.length };
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

export async function userHasOrionFirmaManage(
  pool: SqlPool,
  userId: string,
  _isAdmin = false
): Promise<boolean> {
  // Compat: “Firma digital” / manage = permiso Preparar.
  return userHasOrionPreparePermission(pool, userId, _isAdmin);
}

/** Permiso Preparar firma (URL prepare o legacy manage). Sin bypass admin. */
export async function userHasOrionPreparePermission(
  pool: SqlPool,
  userId: string,
  _isAdmin = false
): Promise<boolean> {
  void _isAdmin;
  if (!userId) return false;

  const {
    ORION_FIRMA_PREPARE_URL,
    ORION_FIRMA_MANAGE_URL,
  } = await import('./access');
  const permitted = await pool
    .request()
    .input('id_user', sql.NVarChar(255), userId)
    .input('urlPrepare', sql.NVarChar(255), ORION_FIRMA_PREPARE_URL)
    .input('urlManage', sql.NVarChar(255), ORION_FIRMA_MANAGE_URL)
    .query(`
      SELECT TOP 1 suc.id_subprocess_user_company AS id
      FROM subprocess_user_company suc
      INNER JOIN company_user cu
        ON cu.id_company_user = suc.id_company_user
      INNER JOIN subprocess s
        ON s.id_subprocess = suc.id_subprocess
      WHERE cu.id_user = @id_user
        AND (
          LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, N'')))) = LOWER(LTRIM(RTRIM(@urlPrepare)))
          OR LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, N'')))) = LOWER(LTRIM(RTRIM(@urlManage)))
          OR LOWER(LTRIM(RTRIM(ISNULL(s.subprocess, N'')))) LIKE N'%preparar firma%'
          OR LOWER(LTRIM(RTRIM(ISNULL(s.subprocess, N'')))) LIKE N'%firma digital%'
        )
    `);

  return Boolean(permitted.recordset[0]?.id);
}

/** Resuelve id Kronos desde sesión (id o email). */
export async function resolveOrionActorUserId(
  pool: SqlPool,
  params: { userId?: string | null; email?: string | null }
): Promise<string | null> {
  const uid = String(params.userId || '').trim();
  if (uid) {
    const byId = await pool
      .request()
      .input('id', sql.NVarChar(255), uid)
      .query(`SELECT TOP 1 id FROM [user] WHERE id = @id`);
    if (byId.recordset[0]?.id) return String(byId.recordset[0].id);
  }
  const email = String(params.email || '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  const byEmail = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(`
      SELECT TOP 1 id FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = @email
    `);
  return byEmail.recordset[0]?.id ? String(byEmail.recordset[0].id) : null;
}

/** Permiso Firmar documento. Sin bypass admin. */
export async function userHasOrionSignPermission(
  pool: SqlPool,
  userId: string,
  _isAdmin = false
): Promise<boolean> {
  void _isAdmin;
  if (!userId) return false;

  const { ORION_FIRMA_SIGN_URL } = await import('./access');
  const permitted = await pool
    .request()
    .input('id_user', sql.NVarChar(255), userId)
    .input('urlSign', sql.NVarChar(255), ORION_FIRMA_SIGN_URL)
    .query(`
      SELECT TOP 1 suc.id_subprocess_user_company AS id
      FROM subprocess_user_company suc
      INNER JOIN company_user cu
        ON cu.id_company_user = suc.id_company_user
      INNER JOIN subprocess s
        ON s.id_subprocess = suc.id_subprocess
      WHERE cu.id_user = @id_user
        AND (
          LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, N'')))) = LOWER(LTRIM(RTRIM(@urlSign)))
          OR LOWER(LTRIM(RTRIM(ISNULL(s.subprocess, N'')))) LIKE N'%firmar documento%'
        )
    `);

  return Boolean(permitted.recordset[0]?.id);
}

/**
 * Puede preparar firma en la solicitud: solo permiso Preparar (no creador/admin automático).
 */
export async function userCanManageOrionRequest(
  pool: SqlPool,
  requestId: number,
  userId: string,
  _isAdmin: boolean
): Promise<boolean> {
  void requestId;
  void _isAdmin;
  if (!userId) return false;
  return userHasOrionPreparePermission(pool, userId, false);
}

/**
 * Edición de preparación: permiso Preparar + abierta + sin firmas completadas.
 */
export async function assertUserCanEditOrionPreparation(
  pool: SqlPool,
  params: {
    requestId: number;
    userId: string;
    userEmail: string;
    isAdmin?: boolean;
    fileId?: string | null;
  }
): Promise<{ ctx: RequestOrionContext; state: OrionSignatureState | null }> {
  const { canEditOrionPreparation } = await import('./permissions');
  const canManage = await userCanManageOrionRequest(
    pool,
    params.requestId,
    params.userId,
    Boolean(params.isAdmin)
  );
  if (!canManage) {
    throw Object.assign(
      new Error(
        'No tiene permiso “Preparar firma”. Asígueselo en Administración → Usuarios.'
      ),
      { status: 403 }
    );
  }
  const locked = await isOrionRequestWorkflowLocked(pool, params.requestId);
  const ctx = await getRequestOrionContext(pool, params.requestId);
  if (!ctx) {
    throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  }

  let state: OrionSignatureState | null = null;
  if (params.fileId) {
    const loaded = await loadOrionFormBag(pool, params.requestId);
    if (loaded) {
      state = getOrionDocumentFromBag(loaded.bag, params.fileId);
    }
  }

  const allowed = canEditOrionPreparation({
    canManage,
    workflowLocked: locked,
    state,
    currentUserEmail: params.userEmail,
    currentUserId: params.userId,
    createdByEmail: ctx.requester_email,
    requesterId: ctx.id_requester,
  });

  if (!allowed) {
    throw Object.assign(
      new Error(
        'Solo quien tiene permiso Preparar firma puede editar el documento, firmantes o posiciones mientras la solicitud esté abierta y nadie haya firmado.'
      ),
      { status: 403 }
    );
  }

  return { ctx, state };
}

/** Marca un PDF como para firmar o solo ver (permiso Preparar). */
export async function setOrionDocumentSignatureIntent(
  pool: SqlPool,
  params: {
    requestId: number;
    userId: string;
    userEmail: string;
    isAdmin?: boolean;
    fileId: string;
    fileName?: string | null;
    intent: 'sign' | 'view';
    originalFileUrl?: string | null;
  }
): Promise<{ state: OrionSignatureState; bag: OrionSignatureBagBag; fileId: string }> {
  const fileId = String(params.fileId || '').trim();
  if (!fileId) {
    throw Object.assign(new Error('fileId es obligatorio'), { status: 400 });
  }
  if (params.intent !== 'sign' && params.intent !== 'view') {
    throw Object.assign(new Error('intent inválido'), { status: 400 });
  }

  const canManage = await userCanManageOrionRequest(
    pool,
    params.requestId,
    params.userId,
    Boolean(params.isAdmin)
  );
  if (!canManage) {
    throw Object.assign(
      new Error(
        'No tiene permiso “Preparar firma”. Asígueselo en Administración → Usuarios.'
      ),
      { status: 403 }
    );
  }

  const locked = await isOrionRequestWorkflowLocked(pool, params.requestId);
  if (locked) {
    throw Object.assign(new Error('La solicitud está cerrada'), { status: 403 });
  }

  const { field, bag: loadedBag } = await loadOrionFormBagEnsured(pool, params.requestId);
  const current = getOrionDocumentFromBag(loadedBag, fileId);

  if (params.intent === 'view' && hasAnyCompletedSignatureLocal(current)) {
    throw Object.assign(
      new Error('No se puede quitar de firma un documento que ya tiene firmas'),
      { status: 422 }
    );
  }

  const next: OrionSignatureState = {
    ...current,
    fileId,
    fileName: params.fileName ?? current.fileName ?? null,
    originalFileUrl: params.originalFileUrl ?? current.originalFileUrl ?? null,
    signatureIntent: params.intent,
  };

  const bag = setOrionDocumentInBag(loadedBag, fileId, next);
  await upsertOrionFormBag(pool, params.requestId, field.id_form_field, bag);
  return { state: next, bag, fileId };
}

function hasAnyCompletedSignatureLocal(state: OrionSignatureState | null | undefined): boolean {
  return (state?.signers ?? []).some((s) =>
    ['FIRMADO', 'SIGNED', 'COMPLETED'].includes(String(s.status || '').toUpperCase())
  );
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
    /** Rúbrica opcional enviada en el mismo accept-sign (Orion la persiste si falta). */
    signatureDataUrl?: string | null;
    /** Identidad del firmante (nombre, CC/NIT, cargo) para el sello Orion. */
    identity?: SignerAcceptIdentity | null;
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
  const canSign = await userHasOrionSignPermission(pool, params.userId, false);
  if (!canSign) {
    throw Object.assign(
      new Error(
        'No tiene permiso “Firmar documento”. Sin ese permiso no puede firmar aunque esté asignado como firmante. Asígueselo en Administración → Usuarios.'
      ),
      { status: 403 }
    );
  }

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

  const mySlots = liveState.signers?.filter(
    (s) => normalizeSignerEmail(s.email) === me
  );
  if (!mySlots?.length) {
    throw Object.assign(new Error('No es firmante de este documento'), { status: 403 });
  }

  const pending = getCurrentPendingSigner(liveState.signers);
  const isMyTurn = Boolean(pending && normalizeSignerEmail(pending.email) === me);
  // Completó todas sus apariciones (mismo email puede tener varios slots).
  const alreadyCompletedAll = allSlotsCompletedForEmail(liveState.signers, me);
  // Firmante activo de ESTE turno (no el primer slot del email).
  const turnSigner = isMyTurn && pending ? pending : mySlots[0]!;

  if (alreadyCompletedAll) {
    // Idempotente: Orion/Kronos ya tienen su firma. No volver a llamar accept-sign.
    liveState = applyOrionVersionHistory({
      previous: current,
      next: liveState,
      previousSigners,
      originalUrl: liveState.originalFileUrl ?? current.originalFileUrl ?? null,
    });
    const statusUpperDone = String(liveState.status || 'EN_PROCESO').toUpperCase();
    const outcomeDone = await applyOrionWebhookToRequest(pool, {
      requestId: params.requestId,
      status: statusUpperDone,
      auditSummary: liveState.auditSummary,
      noteAuthorUserId: params.userId,
      patch: liveState,
      fileId,
      bag,
      fieldId: loaded.field.id_form_field,
    });
    return {
      state: outcomeDone.state,
      bag: outcomeDone.bag,
      fileId: outcomeDone.fileId,
      signerCompleted: true,
      tasksUpdated: outcomeDone.tasksUpdated,
      requestClosed: outcomeDone.requestClosed,
      signerTasksClosed: outcomeDone.signerTasksClosed,
      signerTasksOpened: outcomeDone.signerTasksOpened,
      currentSignerEmail: outcomeDone.currentSignerEmail,
    };
  }

  if (!isMyTurn) {
    throw Object.assign(new Error('Aún no es su turno para firmar'), { status: 403 });
  }

  // Plazo 24h vive en el bag Kronos (Orion no lo gestiona).
  const localPending = getCurrentPendingSigner(current.signers);
  if (isSignerTurnExpired(localPending)) {
    throw Object.assign(
      new Error(
        'Su plazo de 24 horas para firmar venció. Solicite firmar este documento al líder del proceso.'
      ),
      { status: 403 }
    );
  }

  // Aplicar firma real en Orion (rúbrica guardada o signatureDataUrl)
  {
    const identity = params.identity
      ? normalizeSignerIdentity(params.identity, turnSigner.name || params.userEmail)
      : null;
    // Cliente omite signatureDataUrl si Orion ya tiene rúbrica (hasSignature).
    const acceptPayload = {
      signatureDataUrl: params.signatureDataUrl,
      ...(identity
        ? {
            fullName: identity.fullName,
            idDocumentType: identity.idDocumentType,
            idNumber: identity.idNumber,
            companySlug: identity.companySlug,
            companyName: identity.companyName,
            companyNit: identity.companyNit,
            jobTitle: identity.jobTitle,
          }
        : {}),
    };

    let accept = await acceptOrionSignerTurn(
      current.orionDocumentId,
      params.userEmail,
      acceptPayload
    );

    // Orion a veces pierde el PDF en disco; reenviar el original desde OneDrive y reintentar.
    const needsOriginalPdf =
      !accept.ok &&
      /original|almacenamiento|storage|pdf/i.test(String(accept.error || '')) &&
      (accept.status === 422 || accept.status === 404 || accept.status === 409);

    if (needsOriginalPdf) {
      const resolved = await resolveOriginalPdfBase64({
        fileId,
        originalFileUrl: current.originalFileUrl ?? null,
        versions: current.versions,
      });
      if (resolved.base64) {
        if (resolved.sourceUrl && resolved.sourceUrl !== current.originalFileUrl) {
          liveState = {
            ...liveState,
            originalFileUrl: resolved.sourceUrl,
          };
        }
        // Restaurar PDF en Orion y luego reintentar la firma.
        await rebuildOrionSignedPdf(String(current.orionDocumentId), {
          originalPdfBase64: resolved.base64,
        });
        accept = await acceptOrionSignerTurn(current.orionDocumentId, params.userEmail, {
          ...acceptPayload,
          originalPdfBase64: resolved.base64,
        });
      } else if (!accept.ok) {
        throw Object.assign(
          new Error(
            'PDF original no disponible en OneDrive/almacenamiento. Vuelva a adjuntar el documento o reabra la gestión del PDF.'
          ),
          { status: 422 }
        );
      }
    }

    const alreadyDoneOnOrion =
      !accept.ok &&
      /ya complet[oó]|already\s*complet|already\s*sign|firmante ya/i.test(
        String(accept.error || '')
      );

    if (alreadyDoneOnOrion) {
      // Orion ya registró la firma (doble clic / reintento). Sincronizar y tratar como OK.
      const refreshed = await getOrionDocument(current.orionDocumentId);
      if (refreshed.ok && refreshed.data) {
        liveState = mergeOrionSignatureState(
          liveState,
          mapOrionResponseToState(externalRef, refreshed.data, fileId, current.fileName)
        );
      }
      const turnKeyDone = signerSlotKey(turnSigner);
      const forcedDone = orderedSigners(liveState.signers).map((s, idx) => {
        if (signerSlotKey(s, idx) !== turnKeyDone) return s;
        if (isSignerCompleted(s.status)) return s;
        return {
          ...s,
          status: 'FIRMADO' as const,
          signedAt: s.signedAt || new Date().toISOString(),
        };
      });
      liveState = {
        ...liveState,
        signers: forcedDone,
        status: allSignersCompleted(forcedDone)
          ? 'FIRMADO'
          : liveState.status && String(liveState.status).toUpperCase() !== 'BORRADOR'
            ? liveState.status
            : 'EN_PROCESO',
      };
    } else if (!accept.ok || !accept.data) {
      const status = accept.status || 502;
      const raw = String(accept.error || '').trim();
      const message =
        raw ||
        (status === 422
          ? 'No se pudo aplicar la firma. Verifique su rúbrica e intente de nuevo.'
          : status === 409
            ? 'Aún no es su turno para firmar.'
            : 'No se pudo confirmar la firma en GSS Firma (Orion).');
      throw Object.assign(new Error(message), { status: status === 404 ? 502 : status });
    } else {
      liveState = mergeOrionSignatureState(
        liveState,
        mapOrionResponseToState(externalRef, accept.data, fileId, current.fileName)
      );
      // Si Orion no marcó el slot, forzar FIRMADO del turno para abrir auth/tarea del siguiente.
      const turnKey = signerSlotKey(turnSigner);
      const forcedSigners = orderedSigners(liveState.signers).map((s, idx) => {
        if (signerSlotKey(s, idx) !== turnKey) return s;
        if (isSignerCompleted(s.status)) return s;
        return {
          ...s,
          status: 'FIRMADO' as const,
          signedAt: s.signedAt || new Date().toISOString(),
        };
      });
      liveState = {
        ...liveState,
        signers: forcedSigners,
        status: allSignersCompleted(forcedSigners)
          ? 'FIRMADO'
          : liveState.status && String(liveState.status).toUpperCase() !== 'BORRADOR'
            ? liveState.status
            : 'EN_PROCESO',
      };
    }
  }

  liveState = applyOrionVersionHistory({
    previous: current,
    next: liveState,
    previousSigners,
    originalUrl: liveState.originalFileUrl ?? current.originalFileUrl ?? null,
  });

  const statusUpper = String(liveState.status || 'EN_PROCESO').toUpperCase();
  const outcome = await applyOrionWebhookToRequest(pool, {
    requestId: params.requestId,
    status: statusUpper,
    auditSummary: liveState.auditSummary,
    noteAuthorUserId: params.userId,
    patch: liveState,
    fileId,
    bag,
    fieldId: loaded.field.id_form_field,
  });

  const completed = newlyCompletedSigners(previousSigners, outcome.state.signers);
  const turnOrder = Number(turnSigner.order);
  const justCompletedThisTurn = completed.some((s) => {
    if (Number.isFinite(turnOrder) && turnOrder > 0) {
      return Number(s.order) === turnOrder;
    }
    return normalizeSignerEmail(s.email) === me;
  });
  const signerCompleted =
    justCompletedThisTurn ||
    (isMyTurn &&
      outcome.state.signers?.some(
        (s) =>
          Number(s.order) === turnOrder && isSignerCompleted(s.status)
      )) ||
    allSlotsCompletedForEmail(outcome.state.signers, me);

  // Tras avanzar turno: nuevo plazo 24h para el firmante pendiente.
  let finalState = outcome.state;
  let finalBag = outcome.bag;
  if (signerCompleted && !allSignersCompleted(outcome.state.signers)) {
    finalState = {
      ...outcome.state,
      signers: applyPendingSignerTurnDeadline(outcome.state.signers),
    };
    finalBag = setOrionDocumentInBag(outcome.bag, fileId, finalState);
    await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, finalBag);
  }

  return {
    state: finalState,
    bag: finalBag,
    fileId: outcome.fileId,
    signerCompleted,
    tasksUpdated: outcome.tasksUpdated,
    requestClosed: outcome.requestClosed,
    signerTasksClosed: outcome.signerTasksClosed,
    signerTasksOpened: outcome.signerTasksOpened,
    currentSignerEmail: outcome.currentSignerEmail,
  };
}

/**
 * Firmante en turno devuelve el documento al coordinador (Orion DEVUELTO).
 * No cierra la solicitud Kronos.
 */
export async function returnDocumentFromSigner(
  pool: SqlPool,
  params: {
    requestId: number;
    userId: string;
    userEmail: string;
    fileId?: string | null;
    reason: string;
  }
): Promise<{
  state: OrionSignatureState;
  bag: OrionSignatureBagBag;
  fileId: string;
  tasksUpdated: number;
  requestClosed: boolean;
}> {
  const reason = String(params.reason || '').trim();
  if (reason.length < 3) {
    throw Object.assign(new Error('Indique el motivo de la devolución (mín. 3 caracteres).'), {
      status: 400,
    });
  }

  const loaded = await loadOrionFormBag(pool, params.requestId);
  if (!loaded) {
    throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
  }

  const me = normalizeSignerEmail(params.userEmail);
  let fileId = String(params.fileId || '').trim();
  if (!fileId) {
    for (const [fid, doc] of Object.entries(loaded.bag.documents)) {
      const pending = getCurrentPendingSigner(doc.signers);
      if (pending && normalizeSignerEmail(pending.email) === me) {
        fileId = fid;
        break;
      }
    }
  }
  if (!fileId) {
    fileId = Object.keys(loaded.bag.documents)[0] || ORION_LEGACY_FILE_ID;
  }

  const current = getOrionDocumentFromBag(loaded.bag, fileId);
  if (!current.orionDocumentId) {
    throw Object.assign(new Error('No hay documento Orion para este archivo'), { status: 422 });
  }

  const pending = getCurrentPendingSigner(current.signers);
  if (!pending || normalizeSignerEmail(pending.email) !== me) {
    throw Object.assign(new Error('Solo el firmante en turno puede devolver el documento'), {
      status: 403,
    });
  }

  const returned = await returnOrionDocument(current.orionDocumentId, {
    email: params.userEmail,
    reason,
  });

  const externalRef =
    current.externalRef ||
    buildOrionExternalRef(params.requestId, fileId === ORION_LEGACY_FILE_ID ? null : fileId);

  let patch: OrionSignatureState;
  if (returned.ok && returned.data) {
    patch = mapOrionResponseToState(externalRef, returned.data, fileId, current.fileName);
  } else {
    // Orion puede no exponer /return o fallar (502): en Kronos igual marcamos DEVUELTO
    // para que quien gestiona pueda corregir y reenviar.
    console.warn(
      '[orion/return] Orion no devolvió OK; aplicando DEVUELTO local:',
      returned.status,
      returned.error
    );
    patch = {
      ...current,
      fileId,
      externalRef,
      status: 'DEVUELTO',
      returnReason: reason,
      returnedBy: params.userEmail,
      auditSummary: `Devuelto por ${params.userEmail}: ${reason}`,
      signers: (current.signers ?? []).map((s) => ({
        ...s,
        status: 'PENDIENTE',
        signedAt: null,
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  const outcome = await applyOrionWebhookToRequest(pool, {
    requestId: params.requestId,
    status: 'DEVUELTO',
    auditSummary:
      patch.auditSummary ||
      `Devuelto por ${params.userEmail}: ${reason}`,
    noteAuthorUserId: params.userId,
    fileId,
    patch: {
      ...patch,
      status: 'DEVUELTO',
      returnReason: reason,
      returnedBy: params.userEmail,
      auditSummary: `Devuelto por ${params.userEmail}: ${reason}`,
    },
  });

  return {
    state: outcome.state,
    bag: outcome.bag,
    fileId: outcome.fileId,
    tasksUpdated: outcome.tasksUpdated,
    requestClosed: outcome.requestClosed,
  };
}
