import 'server-only';
import sql from 'mssql';
import { buildAppUrl } from '../notificationEvents.js';
import { createAndSendNotifications } from '../notifications.js';
import { fireAndForgetOrionDocumentEvent, isMissingTableError } from './documentEvents';
import { getOrionDocumentFromBag, setOrionDocumentInBag } from './formValue';
import {
  buildPendingApprovals,
  completedApprovals,
  currentPendingApproval,
  isOrionReadyForSigning,
  orderDocumentValidators,
  previousReviewValidatorIds,
  type OrionReviewValidator,
} from './reviewState';
import {
  assertUserIsOrionDocumentPreparer,
  buildNextVersionBaseState,
  getRequestOrionContext,
  loadOrionFormBagEnsured,
  replaceSynerlinkAttachmentContent,
  upsertOrionFormBag,
  userIsOrionFlowSignatureResponsible,
  userCanManageOrionRequest,
} from './service';
import { buildOrionReviewResolution } from './signerAuthMarkers';
import type { OrionReviewState, OrionSignatureState } from './types';
import { nextOrionSubversionLabel, resolveOrionVersionLabel } from './versionLabel';

type SqlPool = import('mssql').ConnectionPool;

export const ORION_REVIEW_AUTH_TYPE_NAME = 'Validación de documento';
const REVIEW_TASK_NAME = 'Validar documento';

export type OrionReviewActor = {
  userId: string;
  email: string;
  name?: string | null;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * Personas validadoras del flujo (Administración de flujo). Es solo el grupo habilitado:
 * el orden lo define el preparador por documento al enviarlo a validación.
 * Tabla sin migrar = sin validadores.
 */
export async function listRequestValidators(
  pool: SqlPool,
  requestId: number
): Promise<OrionReviewValidator[]> {
  try {
    const result = await pool
      .request()
      .input('id', sql.Int, requestId)
      .query(`
        SELECT DISTINCT v.id_validator, u.email, u.name
        FROM validators_process_category v
        INNER JOIN process_category_request_general pcr
          ON pcr.id_process_category = v.id_process_category
        LEFT JOIN [user] u ON CAST(u.id AS NVARCHAR(1000)) = v.id_validator
        WHERE pcr.id_request_general = @id
      `);
    return result.recordset
      .filter((row) => normalizeEmail(row.email))
      .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'es'))
      .map((row, index) => ({
        userId: String(row.id_validator),
        email: normalizeEmail(row.email),
        name: row.name ?? null,
        jobTitle: null,
        order: index + 1,
      }));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/** Validadores elegidos para el documento, en el orden indicado por el preparador. */
function resolveDocumentValidators(
  flowValidators: OrionReviewValidator[],
  selectedUserIds: unknown
): OrionReviewValidator[] {
  if (flowValidators.length === 0) {
    throw httpError('Este flujo no tiene validadores configurados.', 422);
  }
  const { validators, unknownIds } = orderDocumentValidators(flowValidators, selectedUserIds);
  if (unknownIds.length > 0) {
    throw httpError(
      'Uno de los validadores elegidos ya no está habilitado en el flujo. Recargue y vuelva a elegir.',
      422
    );
  }
  if (validators.length === 0) {
    throw httpError('Elija al menos un validador y el orden en que debe aprobar el documento.', 400);
  }
  return validators;
}

export async function flowHasOrionValidators(pool: SqlPool, requestId: number): Promise<boolean> {
  return (await listRequestValidators(pool, requestId)).length > 0;
}

/** Con validadores en el flujo, no se prepara ni se envía a firma sin la aprobación final. */
export async function assertOrionReviewApprovedForSigning(
  pool: SqlPool,
  params: { requestId: number; state: OrionSignatureState }
): Promise<void> {
  const hasValidators = await flowHasOrionValidators(pool, params.requestId);
  if (isOrionReadyForSigning(params.state, hasValidators)) return;
  const status = params.state.review?.status;
  const message =
    status === 'EN_VALIDACION'
      ? 'El documento está en validación. Podrá prepararlo para firma cuando lo apruebe el último validador.'
      : status === 'DEVUELTO_CORRECCION'
        ? 'El documento fue devuelto para corrección. Suba la versión corregida para reiniciar la validación.'
        : 'Este flujo requiere validación antes de firmar. Envíe el documento a validación.';
  throw httpError(message, 422);
}

async function ensureReviewAuthTypeId(pool: SqlPool): Promise<number | null> {
  const found = await pool
    .request()
    .input('name', sql.NVarChar(255), ORION_REVIEW_AUTH_TYPE_NAME)
    .query(`SELECT TOP 1 id FROM types_authorization WHERE type_authorization = @name ORDER BY id`);
  const existing = Number(found.recordset[0]?.id);
  if (Number.isInteger(existing) && existing > 0) return existing;
  const inserted = await pool
    .request()
    .input('name', sql.NVarChar(255), ORION_REVIEW_AUTH_TYPE_NAME)
    .query(`INSERT INTO types_authorization (type_authorization) OUTPUT INSERTED.id VALUES (@name)`);
  const id = Number(inserted.recordset[0]?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Plantilla de tarea "Validar documento" del flujo. Queda inactiva a propósito:
 * así la creación de solicitudes no la instancia; solo la abre este servicio.
 */
async function ensureReviewTaskTemplateId(pool: SqlPool, requestId: number): Promise<number> {
  const pc = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`
      SELECT TOP 1 id_process_category
      FROM process_category_request_general
      WHERE id_request_general = @id
      ORDER BY id
    `);
  const processId = Number(pc.recordset[0]?.id_process_category);
  if (!Number.isInteger(processId) || processId <= 0) {
    throw httpError('La solicitud no tiene flujo asociado', 422);
  }
  const typeId = await ensureReviewAuthTypeId(pool);
  if (!typeId) throw httpError('No se pudo crear el tipo de autorización de validación', 500);

  const existing = await pool
    .request()
    .input('pc', sql.Int, processId)
    .input('typeId', sql.Int, typeId)
    .query(`
      SELECT TOP 1 id FROM task_process_category
      WHERE id_process_category = @pc AND is_authorization = 1 AND type_authorization = @typeId
      ORDER BY id
    `);
  const found = Number(existing.recordset[0]?.id);
  if (Number.isInteger(found) && found > 0) return found;

  const inserted = await pool
    .request()
    .input('task', sql.NVarChar(1000), REVIEW_TASK_NAME)
    .input('pc', sql.Int, processId)
    .input('typeId', sql.Int, typeId)
    .query(`
      INSERT INTO task_process_category
        (task, id_process_category, active, cost, is_sequential, display_order, is_authorization, type_authorization)
      OUTPUT INSERTED.id
      VALUES (@task, @pc, 0, 0, 0, 905, 1, @typeId)
    `);
  const id = Number(inserted.recordset[0]?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError('No se pudo crear la tarea de validación', 500);
  }
  return id;
}

async function openReviewTask(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    fileName?: string | null;
    review: OrionReviewState;
    subject?: string | null;
  }
): Promise<void> {
  const pending = currentPendingApproval(params.review);
  if (!pending?.userId) return;
  const templateId = await ensureReviewTaskTemplateId(pool, params.requestId);
  const needle = `[orionReviewFile:${params.fileId}]`;

  const open = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_task', sql.Int, templateId)
    .input('id_user', sql.NVarChar(255), pending.userId)
    .input('needle', sql.NVarChar(500), needle)
    .query(`
      SELECT TOP 1 id FROM task_request_general
      WHERE id_request_general = @id_request AND id_task = @id_task AND id_assigned = @id_user
        AND id_status NOT IN (2, 3)
        AND CHARINDEX(@needle, ISNULL(resolution, N'')) > 0
    `);
  if (open.recordset[0]?.id) return;

  const resolution = buildOrionReviewResolution({
    fileId: params.fileId,
    fileName: params.fileName,
    versionLabel: params.review.versionLabel,
    step: pending.order,
    totalSteps: params.review.approvals.length,
  });
  const inserted = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_task', sql.Int, templateId)
    .input('id_user', sql.NVarChar(255), pending.userId)
    .input('resolution', sql.NVarChar(sql.MAX), resolution)
    .query(`
      INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned, resolution)
      OUTPUT INSERTED.id
      VALUES (@id_request, @id_task, 4, @id_user, @resolution)
    `);
  const taskId = inserted.recordset[0]?.id;
  if (!taskId) return;

  const docLabel = String(params.fileName || '').trim();
  void createAndSendNotifications([pending.email], {
    title: docLabel ? `Validar: ${docLabel}` : 'Validar documento · SynerLink',
    body: [
      `Solicitud #${params.requestId}`,
      docLabel ? `Documento: ${docLabel}` : null,
      params.review.versionLabel ? `Versión ${params.review.versionLabel}` : null,
      `Paso ${pending.order} de ${params.review.approvals.length}`,
      params.subject ? String(params.subject) : null,
    ]
      .filter(Boolean)
      .join(' · '),
    url: buildAppUrl(
      `/process/authorization?highlight=${encodeURIComponent(String(taskId))}&orionReviewFileId=${encodeURIComponent(params.fileId)}`
    ),
    tag: `orion-review-${taskId}`,
  }).catch((err: unknown) => console.warn('[orion/review] Notificación falló:', err));
}

/** Cierra las tareas de validación abiertas del archivo (todas o solo las de un usuario). */
async function closeReviewTasks(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    status: 2 | 3;
    note: string;
    executorId: string;
    onlyUserId?: string | null;
  }
): Promise<void> {
  await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('needle', sql.NVarChar(500), `[orionReviewFile:${params.fileId}]`)
    .input('status', sql.Int, params.status)
    .input('note', sql.NVarChar(1000), params.note)
    .input('executor', sql.NVarChar(255), params.executorId)
    .input('only_user', sql.NVarChar(255), params.onlyUserId ?? null)
    .query(`
      UPDATE task_request_general
      SET id_status = @status,
          start_date = COALESCE(start_date, GETDATE()),
          end_date = GETDATE(),
          date_resolution = GETDATE(),
          id_executor_final = @executor,
          resolution = CONCAT(ISNULL(resolution, N''), N' · ', @note)
      WHERE id_request_general = @id_request
        AND id_status NOT IN (2, 3)
        AND CHARINDEX(N'[orionReview]', ISNULL(resolution, N'')) > 0
        AND CHARINDEX(@needle, ISNULL(resolution, N'')) > 0
        AND (@only_user IS NULL OR id_assigned = @only_user)
    `);
}

async function notifyEmails(
  emails: Array<string | null | undefined>,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<void> {
  const list = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (list.length === 0) return;
  await createAndSendNotifications(list, payload).catch((err: unknown) =>
    console.warn('[orion/review] Notificación falló:', err)
  );
}

async function assertCanSubmit(
  pool: SqlPool,
  requestId: number,
  actor: OrionReviewActor,
  isAdmin: boolean
): Promise<void> {
  if (isAdmin) return;
  await assertUserIsOrionDocumentPreparer(pool, {
    requestId,
    userId: actor.userId,
    userEmail: actor.email,
  });
}

export type OrionReviewInfo = {
  hasValidators: boolean;
  validators: OrionReviewValidator[];
  review: OrionReviewState | null;
  versionLabel: string;
  canSubmit: boolean;
  canDecide: boolean;
  canUploadCorrection: boolean;
  readyForSigning: boolean;
};

export async function getOrionReviewInfo(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: OrionReviewActor | null;
    isAdmin: boolean;
  }
): Promise<OrionReviewInfo> {
  const actorUserId = params.isAdmin ? null : params.actor?.userId || null;
  const [validators, loaded, canPrepare, isFlowPreparer] = await Promise.all([
    listRequestValidators(pool, params.requestId),
    loadOrionFormBagEnsured(pool, params.requestId),
    actorUserId
      ? userCanManageOrionRequest(pool, params.requestId, actorUserId, false)
      : Promise.resolve(false),
    actorUserId
      ? userIsOrionFlowSignatureResponsible(pool, params.requestId, actorUserId)
      : Promise.resolve(false),
  ]);
  const state = getOrionDocumentFromBag(loaded.bag, params.fileId);
  const review = state.review ?? null;
  const hasValidators = validators.length > 0;
  const me = normalizeEmail(params.actor?.email);
  const pending = currentPendingApproval(review);
  const statusUpper = String(state.status || '').toUpperCase();
  const isPreparer = params.isAdmin || (canPrepare && isFlowPreparer);

  const inSigning = ['PENDIENTE_FIRMA', 'EN_PROCESO', 'FIRMADO'].includes(statusUpper);
  const returnedBySigner = statusUpper === 'DEVUELTO';

  return {
    hasValidators,
    validators,
    review,
    versionLabel: resolveOrionVersionLabel(state.versionLabel),
    canSubmit:
      hasValidators &&
      isPreparer &&
      !inSigning &&
      (!review || review.status === 'SIN_VALIDACION'),
    canDecide: Boolean(pending && me && normalizeEmail(pending.email) === me),
    canUploadCorrection:
      isPreparer &&
      (review?.status === 'DEVUELTO_CORRECCION' || (returnedBySigner && !hasValidators)),
    readyForSigning: isOrionReadyForSigning(state, hasValidators),
  };
}

export async function submitOrionReview(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    fileName?: string | null;
    /** Validadores elegidos para este documento, en orden de aprobación. */
    validatorIds: unknown;
    actor: OrionReviewActor;
    isAdmin: boolean;
  }
): Promise<{ state: OrionSignatureState; documents: Record<string, OrionSignatureState> }> {
  await assertCanSubmit(pool, params.requestId, params.actor, params.isAdmin);
  const validators = resolveDocumentValidators(
    await listRequestValidators(pool, params.requestId),
    params.validatorIds
  );

  const loaded = await loadOrionFormBagEnsured(pool, params.requestId);
  const current = getOrionDocumentFromBag(loaded.bag, params.fileId);
  if (current.review && current.review.status !== 'SIN_VALIDACION') {
    throw httpError(
      current.review.status === 'DEVUELTO_CORRECCION'
        ? 'El documento fue devuelto: suba la versión corregida para reiniciar la validación.'
        : 'El documento ya está en validación o aprobado.',
      409
    );
  }
  const statusUpper = String(current.status || '').toUpperCase();
  if (['PENDIENTE_FIRMA', 'EN_PROCESO', 'FIRMADO'].includes(statusUpper)) {
    throw httpError('El documento ya está en firma; no se puede enviar a validación.', 409);
  }

  const versionLabel = resolveOrionVersionLabel(current.versionLabel);
  const now = new Date().toISOString();
  const review: OrionReviewState = {
    status: 'EN_VALIDACION',
    approvals: buildPendingApprovals(validators),
    versionLabel,
    submittedAt: now,
    submittedBy: normalizeEmail(params.actor.email),
    approvedAt: null,
    returnReason: null,
    returnedBy: null,
    returnedAt: null,
    round: (current.review?.round ?? 0) + 1,
  };
  const state: OrionSignatureState = {
    ...current,
    fileName: params.fileName ?? current.fileName ?? null,
    signatureIntent: 'sign',
    versionLabel,
    review,
  };
  const bag = setOrionDocumentInBag(loaded.bag, params.fileId, state);
  await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, bag);

  const ctx = await getRequestOrionContext(pool, params.requestId);
  await openReviewTask(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    fileName: state.fileName,
    review,
    subject: ctx?.subject_request ?? null,
  });
  fireAndForgetOrionDocumentEvent(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    orionDocumentId: current.orionDocumentId ?? null,
    versionLabel,
    eventType: 'ENVIADO_VALIDACION',
    actorEmail: params.actor.email,
    actorName: params.actor.name ?? null,
    detail: review.approvals.map((a) => `${a.order}. ${a.name || a.email}`).join(' · '),
  });

  return { state: getOrionDocumentFromBag(bag, params.fileId), documents: bag.documents };
}

export async function decideOrionReview(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: OrionReviewActor;
    decision: 'APROBADO' | 'DEVUELTO';
    comment?: string | null;
  }
): Promise<{ state: OrionSignatureState; documents: Record<string, OrionSignatureState> }> {
  const loaded = await loadOrionFormBagEnsured(pool, params.requestId);
  const current = getOrionDocumentFromBag(loaded.bag, params.fileId);
  const review = current.review;
  const pending = currentPendingApproval(review);
  if (!review || !pending) {
    throw httpError('El documento no está esperando validación.', 409);
  }
  if (normalizeEmail(pending.email) !== normalizeEmail(params.actor.email)) {
    throw httpError('Solo el validador en turno puede aprobar o devolver este documento.', 403);
  }
  const comment = String(params.comment || '').trim();
  if (params.decision === 'DEVUELTO' && comment.length < 3) {
    throw httpError('Indique el motivo de la devolución (mín. 3 caracteres).', 400);
  }

  const now = new Date().toISOString();
  const approvals = review.approvals.map((a) =>
    a.order === pending.order
      ? {
          ...a,
          decision: params.decision,
          decidedAt: now,
          comment: comment || null,
          name: a.name || params.actor.name || null,
        }
      : a
  );
  const versionLabel = resolveOrionVersionLabel(review.versionLabel ?? current.versionLabel);
  const ctx = await getRequestOrionContext(pool, params.requestId);
  const docLabel = current.fileName || 'Documento';
  const eventBase = {
    requestId: params.requestId,
    fileId: params.fileId,
    orionDocumentId: current.orionDocumentId ?? null,
    versionLabel,
    actorEmail: params.actor.email,
    actorName: params.actor.name ?? null,
  };

  let nextReview: OrionReviewState;
  let nextState: OrionSignatureState;

  if (params.decision === 'DEVUELTO') {
    nextReview = {
      ...review,
      approvals,
      status: 'DEVUELTO_CORRECCION',
      returnReason: comment,
      returnedBy: normalizeEmail(params.actor.email),
      returnedAt: now,
    };
    nextState = { ...current, review: nextReview };
    await closeReviewTasks(pool, {
      requestId: params.requestId,
      fileId: params.fileId,
      status: 3,
      note: `Devuelto para corrección: ${comment}`,
      executorId: params.actor.userId,
    });
    fireAndForgetOrionDocumentEvent(pool, {
      ...eventBase,
      eventType: 'VALIDACION_DEVUELTA',
      detail: `Paso ${pending.order}/${approvals.length} · ${comment}`,
    });
    void notifyEmails([review.submittedBy, ctx?.requester_email], {
      title: `Devuelto para corrección: ${docLabel}`,
      body: `Solicitud #${params.requestId} · ${params.actor.name || params.actor.email}: ${comment}`,
      url: buildAppUrl(`/process/request-general/view-request?id=${params.requestId}`),
      tag: `orion-review-returned-${params.requestId}-${params.fileId}`,
    });
  } else {
    await closeReviewTasks(pool, {
      requestId: params.requestId,
      fileId: params.fileId,
      status: 2,
      note: `Aprobado${comment ? `: ${comment}` : ''}`,
      executorId: params.actor.userId,
      onlyUserId: params.actor.userId,
    });
    const provisional: OrionReviewState = { ...review, approvals };
    const stillPending = currentPendingApproval(provisional);
    fireAndForgetOrionDocumentEvent(pool, {
      ...eventBase,
      eventType: 'VALIDACION_APROBADA',
      detail: `Paso ${pending.order}/${approvals.length}${comment ? ` · ${comment}` : ''}`,
    });

    if (stillPending) {
      nextReview = provisional;
      nextState = { ...current, review: nextReview };
    } else {
      // El PDF no se modifica: el visto bueno se estampa al servirlo, en las cajas que
      // ubique el preparador (chulito en firma; firma guardada en la versión final).
      nextReview = { ...provisional, status: 'APROBADO', approvedAt: now };
      nextState = { ...current, review: nextReview };
      fireAndForgetOrionDocumentEvent(pool, {
        ...eventBase,
        eventType: 'APROBADO_PARA_FIRMA',
        detail: completedApprovals(nextReview)
          .map((a) => a.name || a.email)
          .join(', '),
      });
      void notifyEmails([review.submittedBy, ctx?.requester_email], {
        title: `Aprobado para firma: ${docLabel}`,
        body: `Solicitud #${params.requestId} · Ya puede preparar el documento, ubicar el visto bueno de los validadores y asignar firmantes.`,
        url: buildAppUrl(`/process/request-general/view-request?id=${params.requestId}`),
        tag: `orion-review-approved-${params.requestId}-${params.fileId}`,
      });
    }
  }

  const bag = setOrionDocumentInBag(loaded.bag, params.fileId, nextState);
  await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, bag);

  if (nextReview.status === 'EN_VALIDACION') {
    await openReviewTask(pool, {
      requestId: params.requestId,
      fileId: params.fileId,
      fileName: nextState.fileName,
      review: nextReview,
      subject: ctx?.subject_request ?? null,
    });
  }

  return { state: getOrionDocumentFromBag(bag, params.fileId), documents: bag.documents };
}

/**
 * PDF corregido tras una devolución (de un validador o de un firmante):
 * subversión nueva y la validación arranca desde el primer validador.
 */
export async function resubmitOrionReview(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    pdfBase64: string;
    reason?: string | null;
    /** Opcional: nuevo orden de validadores; por defecto el de la ronda anterior. */
    validatorIds?: unknown;
    actor: OrionReviewActor;
    isAdmin: boolean;
  }
): Promise<{ state: OrionSignatureState; documents: Record<string, OrionSignatureState> }> {
  await assertCanSubmit(pool, params.requestId, params.actor, params.isAdmin);
  const flowValidators = await listRequestValidators(pool, params.requestId);
  const loaded = await loadOrionFormBagEnsured(pool, params.requestId);
  const current = getOrionDocumentFromBag(loaded.bag, params.fileId);
  if (current.review?.status !== 'DEVUELTO_CORRECCION') {
    throw httpError('Solo se puede subir una versión corregida de un documento devuelto.', 409);
  }
  const requested =
    Array.isArray(params.validatorIds) && params.validatorIds.length > 0
      ? params.validatorIds
      : previousReviewValidatorIds(current.review);
  const validators = resolveDocumentValidators(flowValidators, requested);

  const replaced = await replaceSynerlinkAttachmentContent(params.fileId, params.pdfBase64);
  if (!replaced) {
    throw httpError('No se pudo guardar el PDF corregido en SynerLink. Intente de nuevo.', 502);
  }

  const previousLabel = resolveOrionVersionLabel(current.versionLabel);
  const versionLabel = nextOrionSubversionLabel(previousLabel);
  const reason = String(params.reason || '').trim() || current.review.returnReason || null;
  const now = new Date().toISOString();
  const base = buildNextVersionBaseState(current, {
    versionLabel,
    previousVersionLabel: previousLabel,
    reason,
  });
  const review: OrionReviewState = {
    status: 'EN_VALIDACION',
    approvals: buildPendingApprovals(validators),
    versionLabel,
    submittedAt: now,
    submittedBy: normalizeEmail(params.actor.email),
    approvedAt: null,
    returnReason: null,
    returnedBy: null,
    returnedAt: null,
    round: (current.review.round ?? 1) + 1,
  };
  const state: OrionSignatureState = {
    ...base,
    orionDocumentId: null,
    externalRef: undefined,
    review,
  };
  const bag = setOrionDocumentInBag(loaded.bag, params.fileId, state);
  await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, bag);

  fireAndForgetOrionDocumentEvent(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    orionDocumentId: current.orionDocumentId ?? null,
    versionLabel,
    eventType: 'NUEVA_SUBVERSION',
    actorEmail: params.actor.email,
    actorName: params.actor.name ?? null,
    detail: `${previousLabel} → ${versionLabel}${reason ? ` · ${reason}` : ''}`,
  });
  fireAndForgetOrionDocumentEvent(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    versionLabel,
    eventType: 'ENVIADO_VALIDACION',
    actorEmail: params.actor.email,
    actorName: params.actor.name ?? null,
    detail: review.approvals.map((a) => `${a.order}. ${a.name || a.email}`).join(' · '),
  });

  const ctx = await getRequestOrionContext(pool, params.requestId);
  await openReviewTask(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    fileName: state.fileName,
    review,
    subject: ctx?.subject_request ?? null,
  });

  return { state: getOrionDocumentFromBag(bag, params.fileId), documents: bag.documents };
}
