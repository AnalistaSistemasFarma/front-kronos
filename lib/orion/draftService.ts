import 'server-only';
import { randomUUID } from 'crypto';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { buildAppUrl } from '../notificationEvents.js';
import { createAndSendNotifications } from '../notifications.js';
import {
  convertOneDriveItemToPdf,
  downloadOneDriveItemContent,
  ensureFolderAndUploadFile,
  getOneDriveItemMeta,
  isOneDriveItemInFolder,
  listOneDriveFolderFileNames,
  listOneDriveFolderFiles,
  replaceOneDriveItemContent,
  uniqueOneDriveFileName,
} from '../onedrive/graphFolderUpload';
import {
  createOrionDocument,
  fetchOrionDraftReviewUrl,
  rejectOrionDocument,
  revokeOrionDraftReviewUrls,
} from './client';
import { resolveOrionTenantId } from './config';
import { inspectDocxMarkup } from './docxClean';
import {
  activeClientReviewers,
  applyDraftClientDecision,
  applyDraftConverted,
  applyDraftEditValidators,
  applyDraftInternalDecision,
  applyDraftNewVersion,
  applyDraftReviewerInvite,
  applyDraftSendClient,
  applyDraftSubmitInternal,
  assertDraftBaseVersion,
  createDraftState,
  currentDraftValidator,
  draftVersionFileName,
  isWordDraftFileName,
  nextDraftVersionLabel,
  pendingDraftValidators,
  resolveDraftPermissions,
  type DraftActor,
  type DraftClientReviewerInput,
  type DraftPermissions,
} from './draftState';
import { docxToDraftBlocks } from './draftBlocks';
import {
  getCachedDraftBlocks,
  getCachedDraftPdfItem,
  getDraftMark,
  saveCachedDraftPdfItem,
  insertDraftEvent,
  insertDraftMark,
  insertDraftMarkReply,
  listDraftMarks,
  listDraftPresence,
  saveCachedDraftBlocks,
  touchDraftPresence,
  updateDraftMark,
  type DraftMark,
  type DraftMarkType,
  type DraftPresence,
} from './draftBoardDb';
import {
  alignBlocks,
  findAnchor,
  isCorrectionApplied,
  mapBlockIndex,
  type DraftBlock,
} from './draftDiff';
import { addCommentsToDocx } from './docxComments';
import { stampDraftWatermark } from './draftWatermark';
import { setOrionDocumentInBag } from './formValue';
import { sendExternalSignerInviteEmail } from './inviteEmail';
import { closeReviewTasks, listRequestValidators, openReviewTask } from './review';
import { orderDocumentValidators, type OrionReviewValidator } from './reviewState';
import {
  assertUserIsOrionDocumentPreparer,
  getRequestOrionContext,
  insertRequestNote,
  isOrionRequestWorkflowLocked,
  loadOrionFormBag,
  loadOrionFormBagEnsured,
  upsertOrionFormBag,
} from './service';
import type {
  OrionDraftClientReviewer,
  OrionDraftReviewWebhookPayload,
  OrionDraftState,
  OrionDraftVersion,
  OrionSignatureBagBag,
  OrionSignatureState,
} from './types';
import { ORION_INITIAL_VERSION_LABEL } from './versionLabel';

type SqlPool = import('mssql').ConnectionPool;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_DRAFT_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Carpeta de adjuntos de la solicitud (misma que `attachment-file`). */
function requestFolderSegments(requestId: number): string[] {
  return ['SAPSEND', 'TEC', 'SG', `Request-${requestId}`];
}

/** Copias congeladas: subcarpeta de la solicitud (las carpetas no salen en la lista de adjuntos). */
function versionFolderSegments(requestId: number, fileId: string): string[] {
  const safeId = String(fileId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'documento';
  return [...requestFolderSegments(requestId), '_versiones-word', safeId];
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function actorDisplay(actor: DraftActor): string {
  return actor.name || actor.email;
}

async function graphToken(): Promise<string> {
  const token = await getMicrosoftToken();
  if (!token) throw httpError('No se pudo conectar con OneDrive. Intente de nuevo.', 502);
  return token;
}

/** El .docx debe ser un adjunto de esta solicitud (evita leer archivos ajenos por id). */
async function assertAttachmentOfRequest(
  token: string,
  requestId: number,
  fileId: string
): Promise<{ name: string }> {
  const segments = requestFolderSegments(requestId);
  const meta = await getOneDriveItemMeta(token, fileId);
  if (!meta) throw httpError('Documento no encontrado', 404);
  let inFolder = isOneDriveItemInFolder(meta, segments);
  if (!inFolder && !meta.parentName && !meta.parentPath) {
    const listed = await listOneDriveFolderFiles(token, segments);
    inFolder = listed.some((f) => f.id === fileId);
  }
  if (!inFolder) throw httpError('Documento no encontrado', 404);
  return { name: meta.name };
}

async function uploadVersionCopy(params: {
  token: string;
  requestId: number;
  fileId: string;
  label: string;
  fileName: string;
  content: Buffer;
}): Promise<string> {
  const uploaded = await ensureFolderAndUploadFile(
    params.token,
    versionFolderSegments(params.requestId, params.fileId),
    draftVersionFileName(params.label, params.fileName),
    params.content as unknown as BodyInit,
    DOCX_MIME
  );
  return String(uploaded.id);
}

async function isElaborator(pool: SqlPool, requestId: number, actor: DraftActor): Promise<boolean> {
  try {
    await assertUserIsOrionDocumentPreparer(pool, {
      requestId,
      userId: actor.userId,
      userEmail: actor.email,
    });
    return true;
  } catch {
    return false;
  }
}

async function assertElaborator(pool: SqlPool, requestId: number, actor: DraftActor): Promise<void> {
  await assertUserIsOrionDocumentPreparer(pool, {
    requestId,
    userId: actor.userId,
    userEmail: actor.email,
  });
}

async function assertRequestOpen(pool: SqlPool, requestId: number): Promise<void> {
  if (await isOrionRequestWorkflowLocked(pool, requestId)) {
    throw httpError('La solicitud está cerrada; el documento ya no se puede modificar.', 403);
  }
}

async function loadDraft(
  pool: SqlPool,
  requestId: number,
  fileId: string
): Promise<{ formFieldId: number; bag: OrionSignatureBagBag; draft: OrionDraftState | null }> {
  const loaded = await loadOrionFormBagEnsured(pool, requestId);
  return {
    formFieldId: loaded.field.id_form_field,
    bag: loaded.bag,
    draft: loaded.bag.drafts?.[fileId] ?? null,
  };
}

async function saveDraft(
  pool: SqlPool,
  requestId: number,
  formFieldId: number,
  bag: OrionSignatureBagBag,
  draft: OrionDraftState
): Promise<void> {
  const next: OrionSignatureBagBag = {
    ...bag,
    drafts: { ...(bag.drafts ?? {}), [draft.fileId]: draft },
  };
  await upsertOrionFormBag(pool, requestId, formFieldId, next);
}

async function note(pool: SqlPool, requestId: number, text: string, actor: DraftActor): Promise<void> {
  try {
    await insertRequestNote(pool, requestId, text, actor.userId);
  } catch (err) {
    console.warn('[orion/draft] nota:', err);
  }
}

/** Todo el trabajo del Word se hace en el tablero del documento. */
function draftBoardPath(requestId: number, fileId: string): string {
  return `/process/request-general/draft-board?${new URLSearchParams({ requestId: String(requestId), fileId }).toString()}`;
}

/** Los avisos van a preparadoras y validadores, que son quienes pueden abrir el tablero. */
function notify(
  emails: Array<string | null | undefined>,
  payload: { title: string; body: string; requestId: number; fileId: string; tag: string }
): void {
  const list = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (list.length === 0) return;
  void createAndSendNotifications(list, {
    title: payload.title,
    body: payload.body,
    url: buildAppUrl(draftBoardPath(payload.requestId, payload.fileId)),
    tag: payload.tag,
  }).catch((err: unknown) => console.warn('[orion/draft] notificación:', err));
}

/**
 * Tarea "Validar documento" para cada validador pendiente (sale en Autorizaciones y lleva a la
 * solicitud). En el tablero revisan al mismo tiempo, así que todos tienen tarea abierta.
 */
async function openDraftReviewTask(pool: SqlPool, requestId: number, draft: OrionDraftState): Promise<void> {
  const review = draft.internalReview;
  if (!review) return;
  const ctx = await getRequestOrionContext(pool, requestId).catch(() => null);
  for (const pending of pendingDraftValidators(draft)) {
    try {
      // openReviewTask abre la del primer pendiente: se le pasa una vista donde solo este lo está.
      await openReviewTask(pool, {
        requestId,
        fileId: draft.fileId,
        fileName: draft.fileName,
        review: {
          ...review,
          approvals: review.approvals.map((a) =>
            a.order === pending.order ? a : { ...a, decision: 'APROBADO' as const }
          ),
        },
        subject: ctx?.subject_request ?? null,
      });
    } catch (err) {
      // Sin tarea el validador igual ve el tablero en la solicitud; se avisa por campana.
      console.warn('[orion/draft] tarea de validación:', err);
      notify([pending.email], {
        title: `Documento para validar: ${draft.fileName}`,
        body: `Solicitud #${requestId} · versión ${draft.versionLabel}. Ábralo en el tablero para revisarlo.`,
        requestId,
        fileId: draft.fileId,
        tag: `orion-draft-review-${requestId}-${draft.fileId}`,
      });
    }
  }
}

async function publishDraftEvent(
  pool: SqlPool,
  requestId: number,
  fileId: string,
  type: string,
  payload?: unknown
): Promise<void> {
  try {
    await insertDraftEvent(pool, { requestId, fileId, type, payload });
  } catch (err) {
    console.warn('[orion/draft] evento en tiempo real:', err);
  }
}

async function safeCloseReviewTasks(
  pool: SqlPool,
  params: Parameters<typeof closeReviewTasks>[1]
): Promise<void> {
  try {
    await closeReviewTasks(pool, params);
  } catch (err) {
    console.warn('[orion/draft] cerrar tareas de validación:', err);
  }
}

export type OrionDraftInfo = {
  draft: OrionDraftState | null;
  permissions: DraftPermissions | null;
  /** Puede iniciar la preparación Word (aún no iniciada). */
  canStart: boolean;
  isElaborator: boolean;
  /** Validadores habilitados en el flujo (para elegir orden). */
  validators: OrionReviewValidator[];
  /** Empresa de la solicitud (buscar socios SAP). */
  companyId: number | null;
  /** Correo del usuario de la sesión (para mostrar "le toca a usted" / "esperando a …"). */
  currentUserEmail: string;
};

export async function getOrionDraftInfo(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean }
): Promise<OrionDraftInfo> {
  const [draft, elaborator, workflowLocked, ctx] = await Promise.all([
    // Solo lectura: consultar no debe crear el campo de firma en el proceso.
    loadOrionFormBag(pool, params.requestId).then((l) => l?.bag.drafts?.[params.fileId] ?? null),
    isElaborator(pool, params.requestId, params.actor),
    isOrionRequestWorkflowLocked(pool, params.requestId),
    getRequestOrionContext(pool, params.requestId),
  ]);
  const validators = elaborator ? await listRequestValidators(pool, params.requestId) : [];
  return {
    companyId: ctx?.id_company != null ? Number(ctx.id_company) : null,
    currentUserEmail: normalizeEmail(params.actor.email),
    draft,
    permissions: draft
      ? resolveDraftPermissions({
          state: draft,
          actorEmail: params.actor.email,
          actorUserId: params.actor.userId,
          isElaborator: elaborator,
          isAdmin: params.isAdmin,
          workflowLocked,
        })
      : null,
    canStart: !draft && elaborator && !workflowLocked,
    isElaborator: elaborator,
    validators,
  };
}

/** Marca un .docx adjunto como documento en preparación y guarda la copia v0.1. */
export async function startOrionDraft(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor }
): Promise<OrionDraftState> {
  await assertElaborator(pool, params.requestId, params.actor);
  await assertRequestOpen(pool, params.requestId);
  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (loaded.draft) throw httpError('Este documento ya está en preparación.', 409);

  const token = await graphToken();
  const { name } = await assertAttachmentOfRequest(token, params.requestId, params.fileId);
  if (!isWordDraftFileName(name)) {
    throw httpError('Solo los documentos Word (.docx) se pueden preparar en Word.', 400);
  }
  const content = await downloadOneDriveItemContent(token, params.fileId);
  if (!content) throw httpError('No se pudo leer el documento en OneDrive.', 502);

  const now = new Date().toISOString();
  const label = nextDraftVersionLabel(null);
  const itemId = await uploadVersionCopy({
    token,
    requestId: params.requestId,
    fileId: params.fileId,
    label,
    fileName: name,
    content: content.buffer,
  });
  const draft = createDraftState({
    fileId: params.fileId,
    fileName: name,
    actor: params.actor,
    now,
    firstVersion: {
      id: randomUUID(),
      oneDriveItemId: itemId,
      fileName: name,
      uploadedByEmail: normalizeEmail(params.actor.email),
      uploadedByName: params.actor.name ?? null,
      createdAt: now,
      note: 'Versión inicial',
    },
  });
  await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, draft);
  await note(pool, params.requestId, `📝 Preparación en Word iniciada: ${name} (${label}) — por ${actorDisplay(params.actor)}`, params.actor);
  return draft;
}

/**
 * Sube una versión: reemplaza el Word de trabajo (mismo adjunto) y guarda la copia congelada.
 * Sin bloqueo: varias preparadoras pueden subir; si otra subió primero (baseVersion distinta),
 * se rechaza antes de reemplazar el Word de trabajo para no pisar su cambio.
 */
export async function uploadOrionDraftVersion(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: DraftActor;
    content: Buffer;
    note?: string | null;
    /** Subversión que tenía abierta quien sube. */
    baseVersion?: string | null;
    /** Validadores cuyo pedido de corrección queda resuelto con esta subversión (null: todos). */
    resolvedEmails?: string[] | null;
  }
): Promise<OrionDraftState> {
  await assertRequestOpen(pool, params.requestId);
  if (params.content.byteLength === 0) throw httpError('El archivo está vacío.', 400);
  if (params.content.byteLength > MAX_DRAFT_UPLOAD_BYTES) {
    throw httpError('El archivo supera el tamaño máximo (25 MB).', 413);
  }
  // .docx = zip: debe empezar por "PK".
  if (params.content[0] !== 0x50 || params.content[1] !== 0x4b) {
    throw httpError('El archivo no es un documento Word (.docx) válido.', 400);
  }

  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (!loaded.draft) throw httpError('Este documento no está en preparación.', 404);

  const now = new Date().toISOString();
  const pendingVersion: Omit<OrionDraftVersion, 'label' | 'kind'> = {
    id: randomUUID(),
    oneDriveItemId: '',
    fileName: loaded.draft.fileName,
    uploadedByEmail: normalizeEmail(params.actor.email),
    uploadedByName: params.actor.name ?? null,
    createdAt: now,
    note: String(params.note || '').trim().slice(0, 500) || null,
  };
  await assertElaborator(pool, params.requestId, params.actor);
  // Valida estado y subversión base sin efectos (lanza si no puede subir).
  const planned = applyDraftNewVersion(
    loaded.draft,
    {
      actor: params.actor,
      version: pendingVersion,
      baseVersion: params.baseVersion,
      resolvedEmails: params.resolvedEmails,
    },
    now
  );

  const token = await graphToken();
  await assertAttachmentOfRequest(token, params.requestId, params.fileId);
  const itemId = await uploadVersionCopy({
    token,
    requestId: params.requestId,
    fileId: params.fileId,
    label: planned.versionLabel,
    fileName: loaded.draft.fileName,
    content: params.content,
  });

  // La subida a OneDrive tarda: si en ese rato otra persona subió una subversión, no se pisa.
  const fresh = await loadDraft(pool, params.requestId, params.fileId);
  if (!fresh.draft) throw httpError('Este documento no está en preparación.', 404);
  assertDraftBaseVersion(fresh.draft, loaded.draft.versionLabel);
  await replaceOneDriveItemContent(token, params.fileId, params.content as unknown as BodyInit, DOCX_MIME);

  const recomputed = applyDraftNewVersion(
    fresh.draft,
    { actor: params.actor, version: pendingVersion, resolvedEmails: params.resolvedEmails },
    now
  );
  // Pedidos de corrección que quedaron resueltos con esta subversión.
  const corrected = (recomputed.internalReview?.approvals ?? []).filter(
    (a) => a.correctedIn === recomputed.versionLabel
  );
  const draft: OrionDraftState = {
    ...recomputed,
    versions: recomputed.versions.map((v) =>
      v.id === pendingVersion.id ? { ...v, oneDriveItemId: itemId } : v
    ),
  };
  await saveDraft(pool, params.requestId, fresh.formFieldId, fresh.bag, draft);

  // Tablero: párrafos de la subversión nueva, corrección automática y reubicación de marcas.
  let detected: number[] = [];
  try {
    const blocks = await docxToDraftBlocks(params.content);
    await saveCachedDraftBlocks(pool, { versionId: pendingVersion.id, itemId, blocks });
    detected = await reconcileDraftMarks(pool, {
      requestId: params.requestId,
      draft,
      newBlocks: blocks,
    });
  } catch (err) {
    console.warn('[orion/draft] tablero tras subir versión:', err);
  }

  await note(
    pool,
    params.requestId,
    `📄 Nueva versión ${draft.versionLabel} de ${draft.fileName} — por ${actorDisplay(params.actor)}${
      pendingVersion.note ? ` — ${pendingVersion.note}` : ''
    }${detected.length ? ` — corrigió las marcas ${detected.join(', ')}` : ''}${
      corrected.length ? ` — corregido lo pedido por ${corrected.map((a) => a.name || a.email).join(', ')}` : ''
    }`,
    params.actor
  );
  if (loaded.draft.status === 'EN_VALIDACION_INTERNA') {
    // La subversión nueva pide aprobar otra vez: se reabren las tareas de quienes ya habían
    // aprobado y de quienes pidieron una corrección que quedó resuelta.
    await openDraftReviewTask(pool, params.requestId, draft);
    for (const a of corrected) {
      notify([a.email], {
        title: `Corrección lista para revisar: ${draft.fileName}`,
        body: `Solicitud #${params.requestId} · ${actorDisplay(params.actor)} subió la ${draft.versionLabel} con lo que usted pidió.`,
        requestId: params.requestId,
        fileId: params.fileId,
        tag: `orion-draft-review-${params.requestId}-${params.fileId}`,
      });
    }
  }
  await publishDraftEvent(pool, params.requestId, params.fileId, 'version_added', {
    versionLabel: draft.versionLabel,
    detected,
  });
  return draft;
}

/**
 * Tras una subversión nueva: cada marca abierta se busca en el párrafo equivalente; si el texto
 * de "Dice" desapareció y apareció el de "Debe decir", queda "Por confirmar" (detectada sola).
 * Las demás se reubican en la subversión nueva. Devuelve los números detectados.
 */
async function reconcileDraftMarks(
  pool: SqlPool,
  params: { requestId: number; draft: OrionDraftState; newBlocks: DraftBlock[] }
): Promise<number[]> {
  const marks = await listDraftMarks(pool, params.requestId, params.draft.fileId);
  const open = marks.filter((m) => m.status !== 'confirmada');
  if (open.length === 0) return [];
  const label = params.draft.versionLabel;
  const detected: number[] = [];
  const blocksByVersion = new Map<string, DraftBlock[]>();

  for (const mark of open) {
    if (mark.anchorVersion === label) continue;
    let oldBlocks = blocksByVersion.get(mark.anchorVersion);
    if (!oldBlocks) {
      const version = params.draft.versions.find((v) => v.label === mark.anchorVersion);
      oldBlocks = version ? await getDraftVersionBlocks(pool, version) : [];
      blocksByVersion.set(mark.anchorVersion, oldBlocks);
    }
    const rows = alignBlocks(oldBlocks, params.newBlocks);
    const newIndex = mapBlockIndex(rows, mark.blockIndex);
    const target = newIndex != null ? params.newBlocks[newIndex] : null;

    if (
      mark.status === 'abierta' &&
      mark.type === 'correccion' &&
      mark.suggest &&
      target &&
      isCorrectionApplied(target.text, mark.quote, mark.suggest)
    ) {
      await updateDraftMark(pool, mark.id, {
        status: 'corregida',
        fixedIn: label,
        fixedQuote: mark.suggest,
        autoDetected: true,
        anchorVersion: label,
        blockIndex: newIndex!,
      });
      detected.push(mark.number);
      continue;
    }
    const anchor = findAnchor(params.newBlocks, mark.quote, newIndex ?? mark.blockIndex);
    if (anchor) await updateDraftMark(pool, mark.id, { anchorVersion: label, blockIndex: anchor.index });
  }
  return detected;
}

/** Párrafos de una subversión (caché en BD; las copias congeladas no cambian). */
export async function getDraftVersionBlocks(pool: SqlPool, version: OrionDraftVersion): Promise<DraftBlock[]> {
  const cached = await getCachedDraftBlocks(pool, version.id);
  if (cached) return cached;
  if (!version.oneDriveItemId) return [];
  const token = await graphToken();
  const content = await downloadOneDriveItemContent(token, version.oneDriveItemId);
  if (!content) throw httpError('No se pudo leer la versión en OneDrive.', 502);
  const blocks = await docxToDraftBlocks(content.buffer);
  await saveCachedDraftBlocks(pool, { versionId: version.id, itemId: version.oneDriveItemId, blocks });
  return blocks;
}

export async function submitOrionDraftInternal(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; validatorIds: unknown }
): Promise<OrionDraftState> {
  await assertElaborator(pool, params.requestId, params.actor);
  await assertRequestOpen(pool, params.requestId);
  const flowValidators = await listRequestValidators(pool, params.requestId);
  if (flowValidators.length === 0) {
    throw httpError('Este flujo no tiene validadores configurados (Administración de flujo → Validadores).', 422);
  }
  const { validators, unknownIds } = orderDocumentValidators(flowValidators, params.validatorIds);
  if (unknownIds.length > 0) {
    throw httpError('Uno de los validadores elegidos ya no está habilitado en el flujo. Recargue y vuelva a elegir.', 422);
  }

  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (!loaded.draft) throw httpError('Este documento no está en preparación.', 404);
  const draft = applyDraftSubmitInternal(loaded.draft, { actor: params.actor, validators });
  await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, draft);

  await note(
    pool,
    params.requestId,
    `📨 ${draft.fileName} (${draft.versionLabel}) enviado a validación interna — ${validators
      .map((v, i) => `${i + 1}. ${v.name || v.email}`)
      .join(' · ')}`,
    params.actor
  );
  await openDraftReviewTask(pool, params.requestId, draft);
  await publishDraftEvent(pool, params.requestId, params.fileId, 'status_changed', { status: draft.status });
  return draft;
}

/** La preparadora agrega o quita validadores durante la validación (quien sale pierde su tarea). */
export async function editOrionDraftValidators(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; validatorIds: unknown }
): Promise<OrionDraftState> {
  await assertElaborator(pool, params.requestId, params.actor);
  await assertRequestOpen(pool, params.requestId);
  const flowValidators = await listRequestValidators(pool, params.requestId);
  const { validators, unknownIds } = orderDocumentValidators(flowValidators, params.validatorIds);
  if (unknownIds.length > 0) {
    throw httpError('Uno de los validadores elegidos ya no está habilitado en el flujo. Recargue y vuelva a elegir.', 422);
  }
  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (!loaded.draft) throw httpError('Este documento no está en preparación.', 404);
  const { state: draft, added, removed } = applyDraftEditValidators(loaded.draft, { validators });
  await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, draft);

  for (const r of removed) {
    if (!r.userId) continue;
    await safeCloseReviewTasks(pool, {
      requestId: params.requestId,
      fileId: params.fileId,
      status: 3,
      note: `Quitado de la validación por ${actorDisplay(params.actor)}`,
      executorId: params.actor.userId,
      onlyUserId: r.userId,
    });
  }
  if (added.length > 0) await openDraftReviewTask(pool, params.requestId, draft);

  const parts = [
    added.length ? `agregó a ${added.map((a) => a.name || a.email).join(', ')}` : null,
    removed.length ? `quitó a ${removed.map((a) => a.name || a.email).join(', ')}` : null,
  ].filter(Boolean);
  if (parts.length) {
    await note(pool, params.requestId, `👥 Validadores de ${draft.fileName}: ${actorDisplay(params.actor)} ${parts.join(' y ')}`, params.actor);
  }
  if (draft.status === 'VALIDADO_INTERNO') {
    notify([draft.internalReview?.submittedBy, draft.createdByEmail], {
      title: `Validado internamente: ${draft.fileName}`,
      body: `Solicitud #${params.requestId} · versión ${draft.versionLabel}. Listo para enviarlo al cliente.`,
      requestId: params.requestId,
      fileId: params.fileId,
      tag: `orion-draft-review-${params.requestId}-${params.fileId}`,
    });
  }
  await publishDraftEvent(pool, params.requestId, params.fileId, 'approval_changed', { edited: true });
  return draft;
}

export async function decideOrionDraftInternal(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: DraftActor;
    decision: 'approve' | 'return';
    comment?: string | null;
    /** Subversión que el validador tenía en pantalla al decidir. */
    baseVersion?: string | null;
  }
): Promise<OrionDraftState> {
  await assertRequestOpen(pool, params.requestId);
  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (!loaded.draft) throw httpError('Este documento no está en preparación.', 404);
  if (params.decision === 'approve') {
    // Solo aprueba quien ya confirmó (o reabrió y le corrigieron) todas sus marcas.
    const me = normalizeEmail(params.actor.email);
    const pending = (await listDraftMarks(pool, params.requestId, params.fileId)).filter(
      (m) => normalizeEmail(m.authorEmail) === me && m.status !== 'confirmada'
    );
    if (pending.length > 0) {
      throw httpError(
        `Tiene ${pending.length} marca(s) sin confirmar (${pending.map((m) => m.number).join(', ')}). Confírmelas en el tablero antes de aprobar.`,
        409
      );
    }
  }
  const draft = applyDraftInternalDecision(loaded.draft, {
    actor: params.actor,
    decision: params.decision,
    comment: params.comment,
    baseVersion: params.baseVersion,
  });
  await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, draft);
  await publishDraftEvent(pool, params.requestId, params.fileId, 'approval_changed', {
    email: normalizeEmail(params.actor.email),
    decision: params.decision,
  });

  const comment = String(params.comment || '').trim();
  const tag = `orion-draft-review-${params.requestId}-${params.fileId}`;
  await safeCloseReviewTasks(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    status: params.decision === 'return' ? 3 : 2,
    note: params.decision === 'return' ? `Pidió corrección: ${comment}` : `Aprobado${comment ? `: ${comment}` : ''}`,
    executorId: params.actor.userId,
    // Solo se cierra la del validador: los demás siguen revisando. Se le reabre al subir la corrección.
    onlyUserId: params.actor.userId,
  });
  if (params.decision === 'return') {
    await note(
      pool,
      params.requestId,
      `↩️ ${actorDisplay(params.actor)} pidió corrección de ${draft.fileName} (${draft.versionLabel}): ${comment}`,
      params.actor
    );
    notify([draft.internalReview?.submittedBy, draft.createdByEmail], {
      title: `Corrección pedida: ${draft.fileName}`,
      body: `Solicitud #${params.requestId} · ${actorDisplay(params.actor)}: ${comment}`,
      requestId: params.requestId,
      fileId: draft.fileId,
      tag,
    });
    return draft;
  }

  await note(
    pool,
    params.requestId,
    `✅ ${draft.fileName} (${draft.versionLabel}) aprobado por ${actorDisplay(params.actor)}${comment ? `: ${comment}` : ''}`,
    params.actor
  );
  if (draft.status === 'VALIDADO_INTERNO') {
    notify([draft.internalReview?.submittedBy, draft.createdByEmail], {
      title: `Validado internamente: ${draft.fileName}`,
      body: `Solicitud #${params.requestId} · versión ${draft.versionLabel}. Listo para enviarlo al cliente.`,
      requestId: params.requestId,
      fileId: draft.fileId,
      tag,
    });
  }
  return draft;
}

/**
 * Descarga el Word de trabajo o una versión congelada. Solo ids registrados en el
 * documento en preparación (o el adjunto mismo): nunca un id arbitrario de OneDrive.
 */
export async function downloadOrionDraftFile(
  pool: SqlPool,
  params: { requestId: number; fileId: string; versionId?: string | null }
): Promise<{ buffer: Buffer; fileName: string }> {
  const { draft } = await loadDraft(pool, params.requestId, params.fileId);
  if (!draft) throw httpError('Este documento no está en preparación.', 404);
  const token = await graphToken();

  const versionId = String(params.versionId || '').trim();
  if (versionId) {
    const version = draft.versions.find((v) => v.id === versionId);
    if (!version?.oneDriveItemId) throw httpError('Versión no encontrada', 404);
    const content = await downloadOneDriveItemContent(token, version.oneDriveItemId);
    if (!content) throw httpError('No se pudo leer la versión en OneDrive.', 502);
    return { buffer: content.buffer, fileName: draftVersionFileName(version.label, draft.fileName) };
  }

  await assertAttachmentOfRequest(token, params.requestId, params.fileId);
  const content = await downloadOneDriveItemContent(token, params.fileId);
  if (!content) throw httpError('No se pudo leer el documento en OneDrive.', 502);
  return { buffer: content.buffer, fileName: draftVersionFileName(draft.versionLabel, draft.fileName) };
}

// ── Revisión del cliente (contrato v3 con Orion) ─────────────────────────────

const DRAFT_REVIEW_HOURS = 24;

function draftExternalRef(requestId: number, fileId: string, versionLabel: string): string {
  return `synerlink://request/${requestId}/file/${fileId}/draft/${versionLabel}`;
}

/** Orion aún sin contrato v3: mensaje claro en vez de un error genérico. */
function orionDraftUnsupported(): Error {
  return httpError(
    'GSS Firma (Orion) todavía no tiene la revisión de borradores por el cliente (contrato v3: docs/orion-contrato-v3-borrador.md). Pídale al equipo de Orion que la habilite.',
    501
  );
}

async function requestReviewerUrl(params: {
  orionDocumentId: string;
  reviewer: OrionDraftClientReviewer;
  forceRefresh?: boolean;
}): Promise<{ reviewUrl: string; expiresAt: string | null }> {
  const res = await fetchOrionDraftReviewUrl({
    orionDocumentId: params.orionDocumentId,
    email: params.reviewer.email,
    name: params.reviewer.name,
    cardCode: params.reviewer.cardCode,
    reviewOrder: params.reviewer.order,
    expiresInHours: DRAFT_REVIEW_HOURS,
    forceRefresh: params.forceRefresh,
  });
  if (!res.ok || !res.reviewUrl) {
    if (res.status === 404 || res.status === 405) throw orionDraftUnsupported();
    throw httpError(res.error || 'Orion no devolvió la URL de revisión', res.status >= 500 ? 502 : 422);
  }
  return { reviewUrl: res.reviewUrl, expiresAt: res.expiresAt };
}

async function sendReviewerEmail(params: {
  draft: OrionDraftState;
  reviewer: OrionDraftClientReviewer;
  reviewUrl: string;
  expiresAt?: string | null;
  subject?: string | null;
  invitedBy: { name?: string | null; email?: string | null };
}): Promise<void> {
  await sendExternalSignerInviteEmail({
    kind: 'draft-review',
    to: params.reviewer.email,
    signerName: params.reviewer.name,
    documentTitle: `${params.draft.fileName} (borrador ${params.draft.clientReview?.versionLabel ?? params.draft.versionLabel})`,
    requestSubject: params.subject ?? null,
    inviteUrl: params.reviewUrl,
    expiresAt: params.expiresAt ?? null,
    invitedByName: params.invitedBy.name ?? null,
    invitedByEmail: params.invitedBy.email ?? null,
  });
}

/**
 * Envía la versión validada al cliente: PDF de vista previa con marca "BORRADOR", documento
 * Orion no firmable, URL de revisión y correo para cada aprobador activo (en orden: solo el
 * primero; los demás al aceptar el anterior). Reenviar/renovar: orionDraftClientInvite.
 */
export async function sendOrionDraftToClient(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: DraftActor;
    reviewers: DraftClientReviewerInput[];
    mode: 'sequential' | 'parallel';
  }
): Promise<OrionDraftState> {
  await assertElaborator(pool, params.requestId, params.actor);
  await assertRequestOpen(pool, params.requestId);
  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (!loaded.draft) throw httpError('Este documento no está en preparación.', 404);
  // Valida estado y aprobadores antes de tocar OneDrive / Orion.
  applyDraftSendClient(loaded.draft, { ...params, orionDocumentId: null });

  const ctx = await getRequestOrionContext(pool, params.requestId);
  if (!ctx) throw httpError('Solicitud no encontrada', 404);
  const tenantId = resolveOrionTenantId(ctx.id_company);
  if (!tenantId) {
    throw httpError(
      `La empresa "${ctx.company_name || ctx.id_company}" no está en ORION_TENANT_MAP: no se puede crear el borrador en Orion.`,
      422
    );
  }

  const token = await graphToken();
  await assertAttachmentOfRequest(token, params.requestId, params.fileId);
  const pdf = await convertOneDriveItemToPdf(token, params.fileId);
  const stamped = await stampDraftWatermark(pdf, { versionLabel: loaded.draft.versionLabel });

  const draftLabel = loaded.draft.versionLabel;
  const previousOrionDocumentId = loaded.draft.clientReview?.orionDocumentId ?? undefined;
  const provenance = {
    companyName: ctx.company_name ?? undefined,
    categoryName: ctx.category ?? undefined,
    processName: ctx.process ?? undefined,
    departmentName: ctx.department_name ?? undefined,
    fileId: params.fileId,
    fileName: loaded.draft.fileName,
    versionLabel: draftLabel,
    previousOrionDocumentId,
  };
  const created = await createOrionDocument({
    purpose: 'DRAFT_REVIEW',
    externalRef: draftExternalRef(params.requestId, params.fileId, draftLabel),
    synerlinkRequestId: params.requestId,
    synerlinkCompanyId: ctx.id_company,
    ...(ctx.id_category_request ? { synerlinkCategoryId: ctx.id_category_request } : {}),
    ...(ctx.id_process_category ? { synerlinkProcessId: ctx.id_process_category } : {}),
    tenantId,
    title: `BORRADOR ${draftLabel} · ${loaded.draft.fileName}`,
    createdByEmail: params.actor.email,
    pdfBase64: Buffer.from(stamped).toString('base64'),
    ...provenance,
    metadata: {
      source: 'synerlink',
      synerlinkRequestId: params.requestId,
      synerlinkCompanyId: ctx.id_company,
      createdByEmail: params.actor.email,
      ...provenance,
    },
  });
  const orionDocumentId = created.ok ? String(created.data?.orionDocumentId || '') : '';
  if (!orionDocumentId) {
    throw httpError(`Orion no pudo crear el borrador: ${created.error || `HTTP ${created.status}`}`, 502);
  }

  let draft = applyDraftSendClient(loaded.draft, { ...params, orionDocumentId });
  try {
    for (const reviewer of activeClientReviewers(draft.clientReview)) {
      const invite = await requestReviewerUrl({ orionDocumentId, reviewer });
      draft = applyDraftReviewerInvite(draft, reviewer.email, invite);
    }
  } catch (err) {
    // Sin URLs el borrador no sirve: se anula en Orion para que no quede huérfano.
    await rejectOrionDocument(orionDocumentId, {
      email: params.actor.email,
      reason: 'Borrador anulado: no se pudo generar la URL de revisión',
    }).catch(() => undefined);
    throw err;
  }

  // Un solo paso: cada aprobador activo recibe ya su correo. Si uno falla, queda para
  // "Enviar al correo" en el tablero sin deshacer el envío de los demás.
  const unsent: string[] = [];
  for (const reviewer of activeClientReviewers(draft.clientReview)) {
    if (!reviewer.reviewUrl) continue;
    try {
      await sendReviewerEmail({
        draft,
        reviewer,
        reviewUrl: reviewer.reviewUrl,
        expiresAt: reviewer.expiresAt,
        subject: ctx.subject_request ?? null,
        invitedBy: { name: params.actor.name, email: params.actor.email },
      });
      draft = applyDraftReviewerInvite(draft, reviewer.email, {
        reviewUrl: reviewer.reviewUrl,
        expiresAt: reviewer.expiresAt ?? null,
        sent: true,
      });
    } catch (err) {
      console.warn('[orion/draft] correo al aprobador del cliente:', reviewer.email, err);
      unsent.push(reviewer.name || reviewer.email);
    }
  }

  await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, draft);
  const review = draft.clientReview!;
  await note(
    pool,
    params.requestId,
    `📤 ${draft.fileName} (borrador ${review.versionLabel}) enviado al cliente — ${
      review.mode === 'parallel' ? 'en paralelo' : 'en orden'
    }: ${review.reviewers.map((r) => `${r.order}. ${r.name || r.email}`).join(' · ')}${
      unsent.length ? ` · ⚠️ sin correo (enviar desde el tablero): ${unsent.join(', ')}` : ''
    }`,
    params.actor
  );
  await publishDraftEvent(pool, params.requestId, params.fileId, 'status_changed', { status: draft.status });
  return draft;
}

/** URL de revisión de un aprobador: obtener/renovar y, con `send`, enviarla por correo. */
export async function orionDraftClientInvite(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    actor: DraftActor;
    email: string;
    action: 'url' | 'send' | 'regenerate';
  }
): Promise<{ draft: OrionDraftState; reviewUrl: string }> {
  await assertElaborator(pool, params.requestId, params.actor);
  await assertRequestOpen(pool, params.requestId);
  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  const current = loaded.draft;
  const review = current?.clientReview;
  if (!current || current.status !== 'EN_REVISION_CLIENTE' || !review?.orionDocumentId) {
    throw httpError('El documento no está en revisión del cliente.', 409);
  }
  const email = normalizeEmail(params.email);
  const reviewer = activeClientReviewers(review).find((r) => r.email === email);
  if (!reviewer) {
    throw httpError('Este aprobador ya respondió o todavía no es su turno.', 409);
  }

  const expired = reviewer.expiresAt ? Date.parse(reviewer.expiresAt) <= Date.now() : false;
  let reviewUrl = reviewer.reviewUrl || '';
  let expiresAt = reviewer.expiresAt ?? null;
  if (params.action === 'regenerate' || !reviewUrl || expired) {
    const invite = await requestReviewerUrl({
      orionDocumentId: review.orionDocumentId,
      reviewer,
      forceRefresh: params.action === 'regenerate' || expired,
    });
    reviewUrl = invite.reviewUrl;
    expiresAt = invite.expiresAt;
  }

  if (params.action === 'send') {
    const ctx = await getRequestOrionContext(pool, params.requestId);
    await sendReviewerEmail({
      draft: current,
      reviewer,
      reviewUrl,
      expiresAt,
      subject: ctx?.subject_request ?? null,
      invitedBy: { name: params.actor.name, email: params.actor.email },
    });
  }
  const draft = applyDraftReviewerInvite(current, email, {
    reviewUrl,
    expiresAt,
    sent: params.action === 'send',
  });
  await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, draft);
  if (params.action === 'send') {
    await note(
      pool,
      params.requestId,
      `✉️ Enlace de revisión del borrador ${review.versionLabel} enviado a ${reviewer.name || reviewer.email}`,
      params.actor
    );
  }
  await publishDraftEvent(pool, params.requestId, params.fileId, 'client_changed', { email });
  return { draft, reviewUrl };
}

/**
 * Webhook de Orion con la decisión de un aprobador del cliente.
 * Devuelve `handled: false` si el documento no es un borrador de esta solicitud.
 */
export async function applyOrionDraftReviewWebhook(
  pool: SqlPool,
  params: { requestId: number; payload: OrionDraftReviewWebhookPayload }
): Promise<{ handled: boolean; status?: string; fileId?: string }> {
  const loaded = await loadOrionFormBag(pool, params.requestId);
  if (!loaded) return { handled: false };
  const orionDocumentId = String(params.payload.orionDocumentId || '').trim();
  const current = Object.values(loaded.bag.drafts ?? {}).find(
    (d) => d.clientReview?.orionDocumentId === orionDocumentId
  );
  if (!current) {
    // Borrador de una ronda anterior (ya reemplazada): se acepta sin cambios.
    const old = Object.values(loaded.bag.drafts ?? {}).some((d) =>
      (d.clientReviewHistory ?? []).some((r) => r.orionDocumentId === orionDocumentId)
    );
    return { handled: old };
  }

  const ctx = await getRequestOrionContext(pool, params.requestId);
  const author: DraftActor = {
    userId: String(ctx?.id_requester || ''),
    email: current.clientReview?.submittedBy || current.createdByEmail,
  };
  const reviewerIn = params.payload.reviewer;
  const decision = String(reviewerIn?.decision || '').toUpperCase();

  if (params.payload.event === 'DRAFT_REVIEW_LINK_EXPIRED' || !reviewerIn?.email) {
    if (reviewerIn?.email) {
      await note(
        pool,
        params.requestId,
        `⏰ Venció el enlace de revisión de ${reviewerIn.name || reviewerIn.email} (${current.fileName}). Renuévelo desde el tablero del documento.`,
        author
      );
    }
    return { handled: true, status: current.status, fileId: current.fileId };
  }
  if (decision !== 'ACEPTADO' && decision !== 'RECHAZADO') {
    throw httpError('reviewer.decision debe ser ACEPTADO o RECHAZADO', 400);
  }

  const result = applyDraftClientDecision(current, {
    email: reviewerIn.email,
    decision,
    comment: reviewerIn.comment,
    decidedAt: reviewerIn.decidedAt,
  });
  if (!result.changed) return { handled: true, status: current.status, fileId: current.fileId };

  let draft = result.state;
  const who = reviewerIn.name || reviewerIn.email;
  const elaborators = [draft.clientReview?.submittedBy, draft.createdByEmail];
  const tag = `orion-draft-client-${params.requestId}-${draft.fileId}`;

  if (decision === 'RECHAZADO') {
    if (result.revokedEmails.length > 0) {
      await revokeOrionDraftReviewUrls({
        orionDocumentId,
        emails: result.revokedEmails,
        reason: `Otro aprobador (${who}) solicitó cambios`,
      }).catch((err: unknown) => console.warn('[orion/draft] revocar enlaces:', err));
    }
    await note(
      pool,
      params.requestId,
      `❌ El cliente rechazó ${draft.fileName} (borrador ${draft.clientReview?.versionLabel}) — ${who}: ${
        reviewerIn.comment || 'sin descripción'
      }`,
      author
    );
    notify(elaborators, {
      title: `El cliente rechazó el borrador: ${draft.fileName}`,
      body: `Solicitud #${params.requestId} · ${who}: ${reviewerIn.comment || 'sin descripción'}`,
      requestId: params.requestId,
      fileId: draft.fileId,
      tag,
    });
  } else if (draft.status === 'APROBADO_CLIENTE') {
    await note(
      pool,
      params.requestId,
      `✅ El cliente aprobó ${draft.fileName} (borrador ${draft.clientReview?.versionLabel}). Listo para convertir a PDF.`,
      author
    );
    notify(elaborators, {
      title: `Aprobado por el cliente: ${draft.fileName}`,
      body: `Solicitud #${params.requestId} · ya puede convertirlo a PDF y preparar la firma.`,
      requestId: params.requestId,
      fileId: draft.fileId,
      tag,
    });
  } else {
    await note(pool, params.requestId, `👍 ${who} aceptó el borrador de ${draft.fileName}`, author);
    if (result.nextReviewer) {
      // Secuencial: el siguiente recibe su enlace automáticamente.
      try {
        const invite = await requestReviewerUrl({ orionDocumentId, reviewer: result.nextReviewer });
        await sendReviewerEmail({
          draft,
          reviewer: result.nextReviewer,
          reviewUrl: invite.reviewUrl,
          expiresAt: invite.expiresAt,
          subject: ctx?.subject_request ?? null,
          invitedBy: { email: draft.clientReview?.submittedBy },
        });
        draft = applyDraftReviewerInvite(draft, result.nextReviewer.email, { ...invite, sent: true });
      } catch (err) {
        console.warn('[orion/draft] enlace del siguiente aprobador:', err);
        notify(elaborators, {
          title: `Enviar enlace al siguiente aprobador: ${draft.fileName}`,
          body: `Solicitud #${params.requestId} · no se pudo enviar automáticamente a ${
            result.nextReviewer.name || result.nextReviewer.email
          }. Envíelo desde el tablero del documento.`,
          requestId: params.requestId,
          fileId: draft.fileId,
          tag,
        });
      }
    }
  }

  await saveDraft(pool, params.requestId, loaded.field.id_form_field, loaded.bag, draft);
  await publishDraftEvent(pool, params.requestId, draft.fileId, 'status_changed', { status: draft.status });
  return { handled: true, status: draft.status, fileId: draft.fileId };
}

/**
 * Aprobado por el cliente → PDF v1.0 como adjunto nuevo, listo para "Preparar documento".
 * La validación del PDF queda aprobada: ya la hicieron los validadores internos y el cliente.
 */
export async function convertOrionDraftToPdf(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor }
): Promise<{ draft: OrionDraftState; pdfFileId: string; pdfFileName: string }> {
  await assertElaborator(pool, params.requestId, params.actor);
  await assertRequestOpen(pool, params.requestId);
  const loaded = await loadDraft(pool, params.requestId, params.fileId);
  if (!loaded.draft) throw httpError('Este documento no está en preparación.', 404);
  if (loaded.draft.status !== 'APROBADO_CLIENTE') {
    throw httpError('Solo un documento aprobado por el cliente se puede convertir a PDF.', 409);
  }

  const token = await graphToken();
  await assertAttachmentOfRequest(token, params.requestId, params.fileId);
  const docx = await downloadOneDriveItemContent(token, params.fileId);
  if (!docx) throw httpError('No se pudo leer el documento en OneDrive.', 502);
  const markup = await inspectDocxMarkup(docx.buffer);
  if (!markup.clean) {
    const parts = [
      markup.comments > 0 ? `${markup.comments} comentario(s)` : null,
      markup.trackedChanges > 0 ? `${markup.trackedChanges} cambio(s) sin aceptar` : null,
    ].filter(Boolean);
    throw httpError(
      `El Word todavía tiene ${parts.join(' y ')}. En Word acepte o rechace los cambios y elimine los comentarios, y suba esa versión limpia con "Subir versión".`,
      422
    );
  }

  const pdf = await convertOneDriveItemToPdf(token, params.fileId);
  const folder = requestFolderSegments(params.requestId);
  const stem = loaded.draft.fileName.replace(/\.docx$/i, '');
  const pdfFileName = uniqueOneDriveFileName(`${stem}.pdf`, await listOneDriveFolderFileNames(token, folder));
  const uploaded = await ensureFolderAndUploadFile(
    token,
    folder,
    pdfFileName,
    pdf as unknown as BodyInit,
    'application/pdf'
  );
  const pdfFileId = String(uploaded.id);
  const now = new Date().toISOString();

  const draft = applyDraftConverted(loaded.draft, {
    pdfFileId,
    version: {
      id: randomUUID(),
      oneDriveItemId: pdfFileId,
      fileName: pdfFileName,
      uploadedByEmail: normalizeEmail(params.actor.email),
      uploadedByName: params.actor.name ?? null,
      createdAt: now,
      note: 'PDF para firma',
    },
  });
  const internal = loaded.draft.internalReview;
  const pdfState: OrionSignatureState = {
    fileId: pdfFileId,
    fileName: pdfFileName,
    status: 'BORRADOR',
    signatureIntent: 'sign',
    versionLabel: ORION_INITIAL_VERSION_LABEL,
    sourceDraftFileId: params.fileId,
    review: internal
      ? {
          ...internal,
          status: 'APROBADO',
          versionLabel: ORION_INITIAL_VERSION_LABEL,
          approvedAt: internal.approvedAt ?? now,
        }
      : null,
  };
  const bag = setOrionDocumentInBag(
    { ...loaded.bag, drafts: { ...(loaded.bag.drafts ?? {}), [draft.fileId]: draft } },
    pdfFileId,
    pdfState
  );
  await upsertOrionFormBag(pool, params.requestId, loaded.formFieldId, bag);
  await note(
    pool,
    params.requestId,
    `📑 ${loaded.draft.fileName} convertido a PDF (${pdfFileName}, ${ORION_INITIAL_VERSION_LABEL}) — por ${actorDisplay(
      params.actor
    )}. Ya se puede preparar la firma.`,
    params.actor
  );
  await publishDraftEvent(pool, params.requestId, params.fileId, 'status_changed', { status: draft.status });
  return { draft, pdfFileId, pdfFileName };
}

// ── Tablero del documento ────────────────────────────────────────────────────

export type OrionDraftBoard = OrionDraftInfo & {
  draft: OrionDraftState;
  marks: DraftMark[];
  presence: DraftPresence[];
};

async function assertBoardAccess(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean }
): Promise<OrionDraftInfo & { draft: OrionDraftState; permissions: DraftPermissions }> {
  const info = await getOrionDraftInfo(pool, params);
  if (!info.draft || !info.permissions) throw httpError('Este documento no está en preparación.', 404);
  if (!info.permissions.canViewBoard) {
    throw httpError('Solo la preparadora y los validadores del documento pueden abrir el tablero.', 403);
  }
  return info as OrionDraftInfo & { draft: OrionDraftState; permissions: DraftPermissions };
}

/**
 * Lecturas del tablero (párrafos, hoja PDF, presencia) llegan en ráfaga al abrirlo: comparten
 * la verificación de acceso unos segundos en vez de repetir 5-6 consultas cada una. Las
 * acciones que cambian algo (marcar, aprobar, subir) siempre verifican de nuevo.
 */
const BOARD_ACCESS_TTL_MS = 15_000;
type BoardAccess = OrionDraftInfo & { draft: OrionDraftState; permissions: DraftPermissions };
type BoardAccessCache = Map<string, { at: number; info: BoardAccess }>;
const boardAccessGlobal = globalThis as { __kronosDraftBoardAccess?: BoardAccessCache };
const boardAccessCache: BoardAccessCache = (boardAccessGlobal.__kronosDraftBoardAccess ??= new Map());

async function cachedBoardAccess(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean },
  opts: { versionId?: string } = {}
): Promise<BoardAccess> {
  const key = `${params.requestId}|${params.fileId}|${normalizeEmail(params.actor.email)}|${params.isAdmin ? 1 : 0}`;
  const hit = boardAccessCache.get(key);
  const fresh = hit && Date.now() - hit.at < BOARD_ACCESS_TTL_MS;
  // Una subversión recién subida aún no está en la copia guardada: se vuelve a leer.
  if (fresh && (!opts.versionId || hit.info.draft.versions.some((v) => v.id === opts.versionId))) return hit.info;
  const info = await assertBoardAccess(pool, params);
  if (boardAccessCache.size > 500) boardAccessCache.clear();
  boardAccessCache.set(key, { at: Date.now(), info });
  return info;
}

/** Hojas PDF de subversiones (copias congeladas): se guardan en memoria para no bajarlas de OneDrive cada vez. */
const SHEET_CACHE_MAX = 30;
const sheetPdfCache = ((globalThis as { __kronosDraftSheetPdf?: Map<string, Buffer> }).__kronosDraftSheetPdf ??=
  new Map());

function rememberSheetPdf(versionId: string, buffer: Buffer): void {
  sheetPdfCache.delete(versionId);
  sheetPdfCache.set(versionId, buffer);
  while (sheetPdfCache.size > SHEET_CACHE_MAX) {
    const oldest = sheetPdfCache.keys().next().value;
    if (oldest === undefined) break;
    sheetPdfCache.delete(oldest);
  }
}

export async function getOrionDraftBoard(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean }
): Promise<OrionDraftBoard> {
  const info = await assertBoardAccess(pool, params);
  // Lo que sigue (párrafos, hoja, presencia) reutiliza esta verificación recién hecha.
  boardAccessCache.set(
    `${params.requestId}|${params.fileId}|${normalizeEmail(params.actor.email)}|${params.isAdmin ? 1 : 0}`,
    { at: Date.now(), info }
  );
  const [marks, presence] = await Promise.all([
    listDraftMarks(pool, params.requestId, params.fileId),
    listDraftPresence(pool, params.requestId, params.fileId),
  ]);
  return { ...info, marks, presence };
}

/** Párrafos de una subversión para el tablero (solo quien puede abrirlo). */
export async function getOrionDraftBoardBlocks(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean; versionId: string }
): Promise<DraftBlock[]> {
  const info = await cachedBoardAccess(pool, params, { versionId: params.versionId });
  const version = info.draft.versions.find((v) => v.id === params.versionId && v.kind !== 'pdf');
  if (!version) throw httpError('Subversión no encontrada', 404);
  return getDraftVersionBlocks(pool, version);
}

export type DraftMarkActionInput =
  | {
      action: 'create';
      type: DraftMarkType;
      quote: string;
      suggest?: string | null;
      why: string;
      blockIndex: number;
    }
  | { action: 'reply'; markId: number; text: string }
  | { action: 'confirm' | 'reopen' | 'mark-fixed'; markId: number };

/**
 * Acciones sobre marcas. Crear: preparadora o validadores durante la validación, sobre la
 * subversión vigente. Confirmar / reabrir: solo quien la hizo. "Ya la corregí": la preparadora,
 * cuando la detección automática no la reconoció.
 */
export async function orionDraftMarkAction(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean; input: DraftMarkActionInput }
): Promise<void> {
  await assertRequestOpen(pool, params.requestId);
  const info = await assertBoardAccess(pool, params);
  const { draft, permissions } = info;
  const me = normalizeEmail(params.actor.email);
  const input = params.input;

  if (input.action === 'create') {
    if (!permissions.canMark) {
      throw httpError('Solo se puede marcar mientras el documento está en validación interna.', 409);
    }
    const type: DraftMarkType = ['correccion', 'sugerencia', 'pregunta'].includes(input.type) ? input.type : 'correccion';
    const quote = String(input.quote || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    const why = String(input.why || '').trim().slice(0, 2000);
    const suggest = type === 'pregunta' ? null : String(input.suggest || '').trim().slice(0, 2000) || null;
    if (quote.length < 2) throw httpError('Seleccione el texto que quiere marcar.', 400);
    if (!why) throw httpError(type === 'pregunta' ? 'Escriba la pregunta.' : 'Explique por qué se necesita el cambio.', 400);
    if (type === 'correccion' && !suggest) throw httpError('Escriba cómo debe quedar el texto.', 400);

    const current = draft.versions.filter((v) => v.kind !== 'pdf').at(-1);
    if (!current) throw httpError('No hay subversión vigente.', 409);
    const blocks = await getDraftVersionBlocks(pool, current);
    const anchor = findAnchor(blocks, quote, Number(input.blockIndex));
    if (!anchor) throw httpError('El texto seleccionado no está en la subversión vigente. Recargue el tablero.', 409);

    await insertDraftMark(pool, {
      requestId: params.requestId,
      fileId: params.fileId,
      type,
      quote,
      suggest,
      why,
      version: draft.versionLabel,
      blockIndex: anchor.index,
      author: params.actor,
    });
    // Quien marca algo nuevo deja de tener la aprobación vigente.
    if (draft.internalReview?.approvals.some((a) => normalizeEmail(a.email) === me && a.decision === 'APROBADO')) {
      const loaded = await loadDraft(pool, params.requestId, params.fileId);
      if (loaded.draft?.internalReview) {
        const next: OrionDraftState = {
          ...loaded.draft,
          internalReview: {
            ...loaded.draft.internalReview,
            approvals: loaded.draft.internalReview.approvals.map((a) =>
              normalizeEmail(a.email) === me ? { ...a, decision: 'PENDIENTE' as const } : a
            ),
          },
        };
        await saveDraft(pool, params.requestId, loaded.formFieldId, loaded.bag, next);
      }
    }
    await publishDraftEvent(pool, params.requestId, params.fileId, 'mark_created', { by: me });
    return;
  }

  const mark = await getDraftMark(pool, input.markId);
  if (!mark || mark.requestId !== params.requestId || mark.fileId !== params.fileId) {
    throw httpError('Marca no encontrada', 404);
  }

  if (input.action === 'reply') {
    const text = String(input.text || '').trim().slice(0, 2000);
    if (!text) throw httpError('Escriba la respuesta.', 400);
    if (draft.status === 'CONVERTIDO_PDF') throw httpError('El documento ya se convirtió a PDF.', 409);
    await insertDraftMarkReply(pool, { markId: mark.id, text, author: params.actor });
    // La respuesta de la preparadora a una pregunta o sugerencia la deja lista para confirmar.
    if (info.isElaborator && mark.status === 'abierta' && mark.type !== 'correccion') {
      await updateDraftMark(pool, mark.id, { status: 'respondida' });
    }
    await publishDraftEvent(pool, params.requestId, params.fileId, 'mark_updated', { markId: mark.id });
    return;
  }

  if (input.action === 'mark-fixed') {
    if (!info.isElaborator) throw httpError('Solo la preparadora marca una corrección como hecha.', 403);
    if (mark.status !== 'abierta') throw httpError('La marca ya no está abierta.', 409);
    await updateDraftMark(pool, mark.id, {
      status: mark.type === 'correccion' ? 'corregida' : 'respondida',
      fixedIn: draft.versionLabel,
      fixedQuote: null,
      autoDetected: false,
    });
    await publishDraftEvent(pool, params.requestId, params.fileId, 'mark_updated', { markId: mark.id });
    return;
  }

  if (normalizeEmail(mark.authorEmail) !== me) {
    throw httpError('Solo quien hizo la marca puede confirmarla o reabrirla.', 403);
  }
  if (input.action === 'confirm') {
    if (mark.status !== 'corregida' && mark.status !== 'respondida') {
      throw httpError('Esta marca todavía no tiene corrección para confirmar.', 409);
    }
    await updateDraftMark(pool, mark.id, { status: 'confirmada' });
  } else {
    await updateDraftMark(pool, mark.id, { status: 'abierta', fixedIn: null, fixedQuote: null, autoDetected: false });
  }
  await publishDraftEvent(pool, params.requestId, params.fileId, 'mark_updated', { markId: mark.id });
}

/** PDF fiel de una subversión (márgenes, encabezados, saltos de página) para el botón "Ver como PDF". */
export async function previewOrionDraftPdf(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean; versionId: string }
): Promise<{ buffer: Buffer; fileName: string }> {
  const info = await cachedBoardAccess(pool, params, { versionId: params.versionId });
  const version = info.draft.versions.find((v) => v.id === params.versionId && v.kind !== 'pdf');
  if (!version?.oneDriveItemId) throw httpError('Subversión no encontrada', 404);
  const fileName = `${version.label} - ${info.draft.fileName.replace(/\.docx$/i, '')}.pdf`;
  const inMemory = sheetPdfCache.get(version.id);
  if (inMemory) return { buffer: inMemory, fileName };
  const token = await graphToken();

  // La subversión es una copia congelada: su hoja se convierte una vez y se guarda al lado.
  const cachedId = await getCachedDraftPdfItem(pool, version.id);
  if (cachedId) {
    const cached = await downloadOneDriveItemContent(token, cachedId);
    if (cached) {
      rememberSheetPdf(version.id, cached.buffer);
      return { buffer: cached.buffer, fileName };
    }
  }
  const buffer = await convertOneDriveItemToPdf(token, version.oneDriveItemId);
  rememberSheetPdf(version.id, buffer);
  try {
    const uploaded = await ensureFolderAndUploadFile(
      token,
      versionFolderSegments(params.requestId, params.fileId),
      `${version.label} - hoja.pdf`,
      buffer as unknown as BodyInit,
      'application/pdf'
    );
    await saveCachedDraftPdfItem(pool, version.id, String(uploaded.id));
  } catch (err) {
    console.warn('[orion/draft] guardar hoja PDF de la subversión:', err);
  }
  return { buffer, fileName };
}

/** Presencia en el tablero (se renueva cada pocos segundos desde el navegador). */
export async function touchOrionDraftPresence(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean; typingBlock?: number | null }
): Promise<DraftPresence[]> {
  await cachedBoardAccess(pool, params);
  await touchDraftPresence(pool, {
    requestId: params.requestId,
    fileId: params.fileId,
    email: normalizeEmail(params.actor.email),
    name: params.actor.name ?? null,
    typingBlock: params.typingBlock ?? null,
  });
  return listDraftPresence(pool, params.requestId, params.fileId);
}

const TYPE_TITLE: Record<DraftMarkType, string> = {
  correccion: 'Corrección',
  sugerencia: 'Sugerencia',
  pregunta: 'Pregunta',
};

/**
 * Word vigente con las marcas sin confirmar como comentarios de Word (para corregirlo en
 * Word). Solo la preparadora del documento.
 */
export async function downloadOrionDraftWithComments(
  pool: SqlPool,
  params: { requestId: number; fileId: string; actor: DraftActor; isAdmin: boolean }
): Promise<{ buffer: Buffer; fileName: string }> {
  const info = await assertBoardAccess(pool, params);
  if (!info.isElaborator) throw httpError('Solo la preparadora descarga el Word con comentarios.', 403);
  const file = await downloadOrionDraftFile(pool, { requestId: params.requestId, fileId: params.fileId });
  const marks = (await listDraftMarks(pool, params.requestId, params.fileId)).filter((m) => m.status !== 'confirmada');
  const buffer = await addCommentsToDocx(
    file.buffer,
    marks.map((m) => ({
      author: m.authorName || m.authorEmail,
      date: m.createdAt,
      quote: m.quote,
      lines: [
        `[${TYPE_TITLE[m.type]} ${m.number}] Dice: "${m.quote}"`,
        ...(m.suggest ? [`Debe decir: "${m.suggest}"`] : []),
        `${m.type === 'pregunta' ? 'Pregunta' : 'Por qué'}: ${m.why}`,
        ...m.replies.map((r) => `— ${r.authorName || r.authorEmail}: ${r.text}`),
      ],
    }))
  );
  return { buffer, fileName: file.fileName.replace(/\.docx$/i, ' (con comentarios).docx') };
}
