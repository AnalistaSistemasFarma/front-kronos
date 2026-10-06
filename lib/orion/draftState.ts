import type {
  OrionDraftClientReview,
  OrionDraftClientReviewer,
  OrionDraftState,
  OrionDraftStatus,
  OrionDraftVersion,
  OrionReviewApproval,
  OrionReviewState,
} from './types';
import {
  buildPendingApprovals,
  currentPendingApproval,
  type OrionReviewValidator,
} from './reviewState';

/**
 * Preparación en Word antes de la firma (docs/orion-borrador-word-diseno.md).
 * Funciones puras: reciben el estado y devuelven uno nuevo, o lanzan un error con `status`.
 */

export const DRAFT_INITIAL_VERSION_LABEL = 'v0.1';

export const ORION_DRAFT_STATUS_LABEL: Record<OrionDraftStatus, string> = {
  EN_ELABORACION: 'En elaboración',
  EN_VALIDACION_INTERNA: 'En validación interna',
  DEVUELTO_INTERNO: 'Devuelto por validador',
  VALIDADO_INTERNO: 'Validado internamente',
  EN_REVISION_CLIENTE: 'En revisión del cliente',
  RECHAZADO_CLIENTE: 'Rechazado por el cliente',
  APROBADO_CLIENTE: 'Aprobado por el cliente',
  CONVERTIDO_PDF: 'Convertido a PDF',
};

export const ORION_DRAFT_STATUS_COLOR: Record<OrionDraftStatus, string> = {
  EN_ELABORACION: 'gray',
  EN_VALIDACION_INTERNA: 'blue',
  DEVUELTO_INTERNO: 'orange',
  VALIDADO_INTERNO: 'teal',
  EN_REVISION_CLIENTE: 'blue',
  RECHAZADO_CLIENTE: 'red',
  APROBADO_CLIENTE: 'teal',
  CONVERTIDO_PDF: 'green',
};

/** Estados en los que el elaborador trabaja el Word. */
const ELABORATION_STATUSES: OrionDraftStatus[] = [
  'EN_ELABORACION',
  'DEVUELTO_INTERNO',
  'RECHAZADO_CLIENTE',
];

export type DraftActor = { userId: string; email: string; name?: string | null };

function draftError(message: string, status = 422): Error {
  return Object.assign(new Error(message), { status });
}

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

export function isWordDraftFileName(name?: string | null): boolean {
  return /\.docx$/i.test(String(name || '').trim());
}

export function isDraftElaborationStatus(status: OrionDraftStatus): boolean {
  return ELABORATION_STATUSES.includes(status);
}

/** v0.1 → v0.2 → … (la etapa Word nunca llega a v1.x; v1.0 es el PDF). */
export function nextDraftVersionLabel(label?: string | null): string {
  const match = /^v?0\.(\d+)$/i.exec(String(label || '').trim());
  const minor = match ? Number(match[1]) : 0;
  return `v0.${(Number.isInteger(minor) && minor >= 0 ? minor : 0) + 1}`;
}

/** Nombre de la copia congelada: `v0.2 - Contrato.docx`. */
export function draftVersionFileName(label: string, fileName: string): string {
  return `${label} - ${String(fileName || 'documento.docx').trim()}`;
}

/** Primer validador pendiente (para mostrar "le toca a …" y abrir tareas). */
export function currentDraftValidator(state?: OrionDraftState | null): OrionReviewApproval | null {
  if (!state || state.status !== 'EN_VALIDACION_INTERNA') return null;
  return currentPendingApproval(state.internalReview);
}

/** Los validadores revisan al mismo tiempo en el tablero: todos los que no han aprobado. */
export function pendingDraftValidators(state?: OrionDraftState | null): OrionReviewApproval[] {
  if (!state || state.status !== 'EN_VALIDACION_INTERNA' || !state.internalReview) return [];
  return [...state.internalReview.approvals]
    .sort((a, b) => a.order - b.order)
    .filter((a) => a.decision === 'PENDIENTE');
}

/**
 * Validadores que pidieron corrección y esperan a la preparadora. Cada uno tiene su propio
 * estado: el documento sigue en validación y los demás siguen revisando.
 */
export function draftCorrectionRequests(state?: OrionDraftState | null): OrionReviewApproval[] {
  if (!state || state.status !== 'EN_VALIDACION_INTERNA' || !state.internalReview) return [];
  return [...state.internalReview.approvals]
    .sort((a, b) => a.order - b.order)
    .filter((a) => a.decision === 'DEVUELTO');
}

/**
 * Fase de la validación interna, por rondas:
 * - `revision`: algún validador todavía está revisando la versión enviada.
 * - `correccion`: todos respondieron y al menos uno pidió corrección. Le toca a la preparadora:
 *   sube la versión corregida (sin avisar a nadie), marca lo corregido y la envía de nuevo.
 */
export type DraftReviewPhase = 'revision' | 'correccion';

export function draftReviewPhase(state?: OrionDraftState | null): DraftReviewPhase | null {
  if (!state || state.status !== 'EN_VALIDACION_INTERNA' || !state.internalReview) return null;
  if (pendingDraftValidators(state).length > 0) return 'revision';
  return draftCorrectionRequests(state).length > 0 ? 'correccion' : null;
}

/**
 * En corrección, la preparadora ya subió una versión posterior a la que revisaron los
 * validadores: recién entonces puede marcar "Ya la corregí" y enviar la corrección.
 */
export function draftCorrectionUploaded(state?: OrionDraftState | null): boolean {
  if (draftReviewPhase(state) !== 'correccion') return false;
  const reviewed = state?.internalReview?.versionLabel;
  return Boolean(reviewed) && state!.versionLabel !== reviewed;
}

/**
 * El validador se reconoce por su usuario de Kronos o por su correo (si el correo del usuario
 * cambió o difiere en algo del de la sesión, igual puede abrir el tablero y marcar).
 */
function isSameValidator(a: OrionReviewApproval, email: string, userId?: string | null): boolean {
  const id = String(userId || '').trim();
  if (id && String(a.userId || '').trim() === id) return true;
  const me = normalizeEmail(email);
  return Boolean(me) && normalizeEmail(a.email) === me;
}

export function isDraftValidator(
  state: OrionDraftState | null | undefined,
  email: string,
  userId?: string | null
): boolean {
  return (state?.internalReview?.approvals ?? []).some((a) => isSameValidator(a, email, userId));
}

/**
 * Borrador al que pertenece un archivo de OneDrive: el Word de trabajo o cualquiera de sus
 * copias de versión (`_versiones-word`). `itemIds`: el id pedido y el que resolvió Graph.
 */
export function findDraftForOneDriveItem(
  drafts: Record<string, OrionDraftState> | null | undefined,
  itemIds: Array<string | null | undefined>
): { fileId: string; draft: OrionDraftState } | null {
  const ids = new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean));
  if (!drafts || ids.size === 0) return null;
  for (const [fileId, draft] of Object.entries(drafts)) {
    if (!draft) continue;
    if (ids.has(fileId) || ids.has(String(draft.fileId || '').trim())) return { fileId, draft };
    if ((draft.versions ?? []).some((v) => ids.has(String(v.oneDriveItemId || '').trim()))) {
      return { fileId, draft };
    }
  }
  return null;
}

/**
 * Lo que ve de un borrador quien no es su preparadora ni su validador: el estado y el avance,
 * sin versiones (ids de OneDrive), comentarios internos ni datos de contacto del cliente.
 */
export function redactDraftForOutsider(state: OrionDraftState): OrionDraftState {
  const review = state.internalReview;
  const client = state.clientReview;
  return {
    fileId: state.fileId,
    fileName: state.fileName,
    status: state.status,
    versionLabel: state.versionLabel,
    versions: [],
    lock: null,
    internalReview: review
      ? {
          status: review.status,
          versionLabel: review.versionLabel ?? null,
          round: review.round,
          submittedAt: review.submittedAt ?? null,
          approvedAt: review.approvedAt ?? null,
          returnedAt: review.returnedAt ?? null,
          approvals: review.approvals.map((a) => ({
            email: '',
            name: a.name || 'Validador',
            jobTitle: a.jobTitle ?? null,
            order: a.order,
            decision: a.decision,
            decidedAt: a.decidedAt ?? null,
          })),
        }
      : null,
    clientReview: client
      ? {
          mode: client.mode,
          round: client.round,
          versionLabel: client.versionLabel,
          submittedAt: client.submittedAt,
          submittedBy: '',
          closedAt: client.closedAt ?? null,
          reviewers: client.reviewers.map((r) => ({
            email: '',
            name: r.name || 'Cliente',
            order: r.order,
            decision: r.decision,
            decidedAt: r.decidedAt ?? null,
          })),
        }
      : null,
    clientReviewHistory: [],
    pdfFileId: state.pdfFileId ?? null,
    createdByEmail: '',
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function createDraftState(params: {
  fileId: string;
  fileName: string;
  actor: DraftActor;
  firstVersion: Omit<OrionDraftVersion, 'label' | 'kind'>;
  now?: string;
}): OrionDraftState {
  const now = params.now ?? new Date().toISOString();
  return {
    fileId: params.fileId,
    fileName: params.fileName,
    status: 'EN_ELABORACION',
    versionLabel: DRAFT_INITIAL_VERSION_LABEL,
    lock: null,
    versions: [
      { ...params.firstVersion, label: DRAFT_INITIAL_VERSION_LABEL, kind: 'elaboracion' },
    ],
    internalReview: null,
    pdfFileId: null,
    createdByEmail: normalizeEmail(params.actor.email),
    createdAt: now,
    updatedAt: now,
  };
}

export type DraftPermissions = {
  /** Puede subir una subversión nueva (las preparadoras trabajan a la vez: no hay bloqueo). */
  canUpload: boolean;
  canSubmitInternal: boolean;
  /** Validador que aún no aprueba la subversión vigente (las marcas se revisan en el servidor). */
  canDecideInternal: boolean;
  /** Tablero del documento: preparadores, validadores del documento y administradores. */
  canViewBoard: boolean;
  /** Crear marcas en el tablero (durante la validación interna). */
  canMark: boolean;
  /** Validado internamente: el elaborador puede enviarlo al cliente. */
  canSendClient: boolean;
  /** En revisión del cliente: el elaborador ve/copia/envía las URLs de revisión. */
  canManageClientInvites: boolean;
  /** Aprobado por el cliente: el elaborador lo convierte a PDF. */
  canConvertPdf: boolean;
  /** En corrección y con la versión corregida ya subida: marcar "Ya la corregí" en las marcas. */
  canMarkFixed: boolean;
  /** En corrección y con la versión corregida ya subida: enviarla a los validadores. */
  canResendInternal: boolean;
};

export function resolveDraftPermissions(params: {
  state: OrionDraftState;
  actorEmail: string;
  /** Usuario de Kronos de la sesión (reconoce al validador aunque su correo no coincida). */
  actorUserId?: string | null;
  isElaborator: boolean;
  isAdmin?: boolean;
  workflowLocked?: boolean;
}): DraftPermissions {
  const { state } = params;
  const me = normalizeEmail(params.actorEmail);
  const none: DraftPermissions = {
    canUpload: false,
    canSubmitInternal: false,
    canDecideInternal: false,
    canViewBoard: false,
    canMark: false,
    canSendClient: false,
    canManageClientInvites: false,
    canConvertPdf: false,
    canMarkFixed: false,
    canResendInternal: false,
  };
  const isValidator = isDraftValidator(state, me, params.actorUserId);
  // Solo las personas del documento: quien lo prepara y sus validadores (ni siquiera admin).
  const canViewBoard = params.isElaborator || isValidator;
  if (params.workflowLocked) return { ...none, canViewBoard };

  // Un validador nunca sube ni corrige, aunque además tenga permiso de preparar.
  const prepares = params.isElaborator && !isValidator;
  const elaborating = isDraftElaborationStatus(state.status);
  const reviewing = state.status === 'EN_VALIDACION_INTERNA';
  const pendingValidator = pendingDraftValidators(state).some((a) => isSameValidator(a, me, params.actorUserId));
  const correcting = draftReviewPhase(state) === 'correccion';
  const correctionReady = prepares && draftCorrectionUploaded(state);
  const clientApproved = state.status === 'APROBADO_CLIENTE';

  return {
    // En validación, la versión corregida se sube solo en la fase de corrección (todos respondieron
    // y alguno pidió cambios); tras el cliente, la versión limpia.
    canUpload: prepares && (elaborating || correcting || clientApproved),
    canSubmitInternal: elaborating && prepares,
    canDecideInternal: pendingValidator,
    canViewBoard,
    // Comentan los validadores; la preparadora responde sus marcas pero no marca su propio documento.
    // Solo mientras se revisa: en la fase de corrección el turno es de la preparadora.
    canMark: reviewing && draftReviewPhase(state) === 'revision' && isValidator,
    canSendClient: state.status === 'VALIDADO_INTERNO' && prepares,
    canManageClientInvites: state.status === 'EN_REVISION_CLIENTE' && prepares,
    // Sin revisión del cliente se puede pasar directo a PDF al quedar validado.
    canConvertPdf: (clientApproved || state.status === 'VALIDADO_INTERNO') && prepares,
    canMarkFixed: correctionReady,
    canResendInternal: correctionReady,
  };
}

/**
 * Varias personas trabajan a la vez: quien sube o aprueba indica sobre qué subversión lo hizo.
 * Si mientras tanto llegó otra, se rechaza para que la revise primero (nada se pisa).
 */
export function assertDraftBaseVersion(state: OrionDraftState, baseVersion?: string | null): void {
  const base = String(baseVersion || '').trim();
  if (base && base !== state.versionLabel) {
    throw draftError(
      `Mientras tanto se subió la ${state.versionLabel} (usted estaba viendo la ${base}). Revísela en el tablero y vuelva a intentarlo.`,
      409
    );
  }
}

/**
 * Registra una versión subida por el elaborador. Tras una devolución, subir la corrección
 * vuelve el documento a "En elaboración". En validación solo se sube en la fase de corrección
 * y la versión queda guardada SIN avisar a los validadores: la preparadora puede subir varias
 * hasta que quede bien y luego la envía con `applyDraftResendInternal`.
 */
export function applyDraftNewVersion(
  state: OrionDraftState,
  params: {
    actor: DraftActor;
    version: Omit<OrionDraftVersion, 'label' | 'kind'>;
    /** Subversión sobre la que trabajó quien sube (si llegó otra antes, se rechaza). */
    baseVersion?: string | null;
  },
  now = new Date().toISOString()
): OrionDraftState {
  assertDraftBaseVersion(state, params.baseVersion);
  const label = nextDraftVersionLabel(state.versionLabel);

  if (isDraftElaborationStatus(state.status)) {
    return {
      ...state,
      status: 'EN_ELABORACION',
      versionLabel: label,
      versions: [...state.versions, { ...params.version, label, kind: 'elaboracion' }],
      updatedAt: now,
    };
  }

  if (state.status === 'EN_VALIDACION_INTERNA') {
    // Validación por rondas: la versión corregida se sube cuando todos respondieron.
    const waiting = pendingDraftValidators(state);
    if (waiting.length > 0) {
      throw draftError(
        `Espere a que todos los validadores respondan antes de subir la versión corregida. Falta: ${waiting
          .map((a) => a.name || a.email)
          .join(', ')}.`,
        409
      );
    }
    if (draftReviewPhase(state) !== 'correccion') {
      throw draftError('Nadie pidió corrección: no hace falta subir otra versión.', 409);
    }
    // Solo se guarda la versión: los validadores siguen con lo que revisaron hasta que se envíe.
    return {
      ...state,
      versionLabel: label,
      versions: [...state.versions, { ...params.version, label, kind: 'elaboracion' }],
      updatedAt: now,
    };
  }

  if (state.status === 'APROBADO_CLIENTE') {
    // Solo para quitar comentarios / aceptar cambios antes del PDF; queda registrada.
    return {
      ...state,
      versionLabel: label,
      versions: [
        ...state.versions,
        {
          ...params.version,
          label,
          kind: 'elaboracion',
          note: params.version.note || 'Versión limpia para convertir a PDF',
        },
      ],
      updatedAt: now,
    };
  }

  throw draftError(
    `El documento está "${ORION_DRAFT_STATUS_LABEL[state.status]}": no se pueden subir versiones.`
  );
}

/**
 * "Enviar corrección a los validadores": cierra la fase de corrección. Todos los validadores
 * vuelven a revisar la versión nueva (quien pidió corrección la ve marcada como "Corregido en").
 */
export function applyDraftResendInternal(
  state: OrionDraftState,
  params: { actor: DraftActor; baseVersion?: string | null },
  now = new Date().toISOString()
): OrionDraftState {
  if (draftReviewPhase(state) !== 'correccion' || !state.internalReview) {
    throw draftError('El documento no está esperando una corrección.', 409);
  }
  if (!draftCorrectionUploaded(state)) {
    throw draftError('Primero suba la versión corregida del Word; después la envía a los validadores.', 409);
  }
  assertDraftBaseVersion(state, params.baseVersion);
  const label = state.versionLabel;
  const review = state.internalReview;
  return {
    ...state,
    internalReview: {
      ...review,
      status: 'EN_VALIDACION',
      versionLabel: label,
      round: (review.round ?? 1) + 1,
      approvals: review.approvals.map((a) =>
        a.decision === 'DEVUELTO'
          ? { ...a, decision: 'PENDIENTE' as const, correctedIn: label }
          : { ...a, decision: 'PENDIENTE' as const }
      ),
    },
    updatedAt: now,
  };
}

export function applyDraftSubmitInternal(
  state: OrionDraftState,
  params: { actor: DraftActor; validators: OrionReviewValidator[] },
  now = new Date().toISOString()
): OrionDraftState {
  if (!isDraftElaborationStatus(state.status)) {
    throw draftError('El documento no está en elaboración: no se puede enviar a validación.');
  }
  if (params.validators.length === 0) {
    throw draftError('Elija al menos un validador. Todos revisan el documento al mismo tiempo.', 400);
  }
  return {
    ...state,
    status: 'EN_VALIDACION_INTERNA',
    lock: null,
    internalReview: {
      status: 'EN_VALIDACION',
      approvals: buildPendingApprovals(params.validators),
      versionLabel: state.versionLabel,
      submittedAt: now,
      submittedBy: normalizeEmail(params.actor.email),
      approvedAt: null,
      returnReason: null,
      returnedBy: null,
      returnedAt: null,
      round: (state.internalReview?.round ?? 0) + 1,
    },
    updatedAt: now,
  };
}

/**
 * Cambia los validadores durante la validación: quien sigue conserva su decisión, quien entra
 * queda pendiente. Si con el cambio ya aprobaron todos, el documento queda validado.
 */
export function applyDraftEditValidators(
  state: OrionDraftState,
  params: { validators: OrionReviewValidator[] },
  now = new Date().toISOString()
): { state: OrionDraftState; added: OrionReviewApproval[]; removed: OrionReviewApproval[] } {
  const review = state.internalReview;
  if (state.status !== 'EN_VALIDACION_INTERNA' || !review) {
    throw draftError('Solo se pueden cambiar los validadores mientras el documento está en validación interna.');
  }
  if (params.validators.length === 0) {
    throw draftError('Deje al menos un validador.', 400);
  }
  const key = (a: { userId?: string | null; email: string }) => String(a.userId || '').trim() || normalizeEmail(a.email);
  const previous = new Map(review.approvals.map((a) => [key(a), a]));
  const added: OrionReviewApproval[] = [];
  const approvals: OrionReviewApproval[] = params.validators.map((v, index) => {
    const kept = previous.get(key(v));
    if (kept) return { ...kept, order: index + 1 };
    const fresh = buildPendingApprovals([{ ...v, order: index + 1 }])[0];
    const approval = { ...fresh, order: index + 1 };
    added.push(approval);
    return approval;
  });
  const keptKeys = new Set(approvals.map(key));
  const removed = review.approvals.filter((a) => !keptKeys.has(key(a)));
  const allApproved = approvals.every((a) => a.decision === 'APROBADO');
  return {
    state: {
      ...state,
      status: allApproved ? 'VALIDADO_INTERNO' : 'EN_VALIDACION_INTERNA',
      internalReview: {
        ...review,
        approvals,
        ...(allApproved ? { status: 'APROBADO' as const, approvedAt: now } : {}),
      },
      updatedAt: now,
    },
    added,
    removed,
  };
}

export function applyDraftInternalDecision(
  state: OrionDraftState,
  params: {
    actor: DraftActor;
    decision: 'approve' | 'return';
    comment?: string | null;
    /** Subversión que el validador estaba viendo al decidir. */
    baseVersion?: string | null;
  },
  now = new Date().toISOString()
): OrionDraftState {
  const validator = pendingDraftValidators(state).find((a) =>
    isSameValidator(a, params.actor.email, params.actor.userId)
  );
  if (!validator || !state.internalReview) {
    const mine = state.internalReview?.approvals.find((a) =>
      isSameValidator(a, params.actor.email, params.actor.userId)
    );
    throw draftError(
      !mine
        ? 'Usted no es validador de este documento.'
        : mine.decision === 'DEVUELTO'
          ? 'Ya pidió corrección: le tocará revisar cuando la preparadora envíe la versión corregida.'
          : 'Ya aprobó esta subversión.',
      403
    );
  }
  // Decidir sobre una subversión que ya fue reemplazada sería decidir sobre algo que no vio.
  assertDraftBaseVersion(state, params.baseVersion);
  const comment = String(params.comment || '').trim() || null;
  if (params.decision === 'return' && !comment) {
    throw draftError('Escriba qué debe corregirse.', 400);
  }

  // Pedir corrección solo cambia el estado de ese validador: el documento sigue en validación.
  const approvals = state.internalReview.approvals.map((a) =>
    a.order === validator.order
      ? params.decision === 'approve'
        ? { ...a, decision: 'APROBADO' as const, decidedAt: now, comment, approvedVersion: state.versionLabel }
        : {
            ...a,
            decision: 'DEVUELTO' as const,
            decidedAt: now,
            comment,
            correctionVersion: state.versionLabel,
            correctedIn: null,
          }
      : a
  );
  const review = { ...state.internalReview, approvals };

  if (params.decision === 'return') {
    return { ...state, internalReview: review, updatedAt: now };
  }

  const allApproved = approvals.every((a) => a.decision === 'APROBADO');
  return {
    ...state,
    status: allApproved ? 'VALIDADO_INTERNO' : 'EN_VALIDACION_INTERNA',
    internalReview: allApproved
      ? { ...review, status: 'APROBADO', approvedAt: now }
      : review,
    updatedAt: now,
  };
}

/**
 * Una sola validación: el PDF convertido desde el Word hereda la aprobación del Word (no se
 * vuelve a validar). Solo cuentan los validadores que aprobaron; ellos ubican su visto bueno
 * en el PDF igual que antes. Sin validación del Word aprobada, el PDF queda sin validación.
 */
export function pdfReviewFromDraft(state: OrionDraftState, now = new Date().toISOString()): OrionReviewState | null {
  const review = state.internalReview;
  if (!review) return null;
  const approvals = review.approvals.filter((a) => a.decision === 'APROBADO');
  if (approvals.length === 0 || approvals.length !== review.approvals.length) return null;
  return {
    status: 'APROBADO',
    approvals: approvals.map((a) => ({ ...a })),
    versionLabel: review.versionLabel ?? state.versionLabel,
    submittedAt: review.submittedAt ?? null,
    submittedBy: review.submittedBy ?? null,
    approvedAt: review.approvedAt ?? now,
    returnReason: null,
    returnedBy: null,
    returnedAt: null,
    round: review.round,
    source: 'word',
    sourceVersionLabel: review.versionLabel ?? state.versionLabel,
  };
}

// ── Revisión del cliente ─────────────────────────────────────────────────────

export type DraftClientReviewerInput = { email: string; name?: string | null; cardCode?: string | null };

/**
 * Aprobadores que deben tener enlace ahora: en paralelo todos los pendientes;
 * en secuencial solo el primero pendiente.
 */
export function activeClientReviewers(review?: OrionDraftClientReview | null): OrionDraftClientReviewer[] {
  if (!review || review.closedAt) return [];
  const pending = [...review.reviewers]
    .sort((a, b) => a.order - b.order)
    .filter((r) => r.decision === 'PENDIENTE');
  return review.mode === 'parallel' ? pending : pending.slice(0, 1);
}

export function applyDraftSendClient(
  state: OrionDraftState,
  params: {
    actor: DraftActor;
    reviewers: DraftClientReviewerInput[];
    mode: 'sequential' | 'parallel';
    orionDocumentId: string | null;
  },
  now = new Date().toISOString()
): OrionDraftState {
  if (state.status !== 'VALIDADO_INTERNO') {
    throw draftError('Solo un documento validado internamente se puede enviar al cliente.');
  }
  const seen = new Set<string>();
  const reviewers: OrionDraftClientReviewer[] = [];
  for (const r of params.reviewers) {
    const email = normalizeEmail(r.email);
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    reviewers.push({
      email,
      name: r.name ?? null,
      cardCode: r.cardCode ?? null,
      order: reviewers.length + 1,
      decision: 'PENDIENTE',
      decidedAt: null,
      comment: null,
      reviewUrl: null,
      sentAt: null,
      expiresAt: null,
    });
  }
  if (reviewers.length === 0) {
    throw draftError('Agregue al menos un aprobador del cliente con correo válido.', 400);
  }
  const history = [...(state.clientReviewHistory ?? [])];
  if (state.clientReview) history.push(state.clientReview);
  return {
    ...state,
    status: 'EN_REVISION_CLIENTE',
    lock: null,
    clientReview: {
      mode: params.mode === 'parallel' ? 'parallel' : 'sequential',
      round: (state.clientReview?.round ?? 0) + 1,
      versionLabel: state.versionLabel,
      orionDocumentId: params.orionDocumentId,
      reviewers,
      submittedAt: now,
      submittedBy: normalizeEmail(params.actor.email),
      closedAt: null,
    },
    clientReviewHistory: history,
    updatedAt: now,
  };
}

/** Guarda la URL de revisión que entregó Orion para un aprobador. */
export function applyDraftReviewerInvite(
  state: OrionDraftState,
  email: string,
  invite: { reviewUrl: string; expiresAt?: string | null; sent?: boolean },
  now = new Date().toISOString()
): OrionDraftState {
  if (!state.clientReview) return state;
  const target = normalizeEmail(email);
  return {
    ...state,
    clientReview: {
      ...state.clientReview,
      reviewers: state.clientReview.reviewers.map((r) =>
        r.email === target
          ? {
              ...r,
              reviewUrl: invite.reviewUrl,
              expiresAt: invite.expiresAt ?? r.expiresAt ?? null,
              sentAt: invite.sent ? now : r.sentAt ?? null,
            }
          : r
      ),
    },
    updatedAt: now,
  };
}

export type DraftClientDecisionResult = {
  state: OrionDraftState;
  /** false = webhook repetido o de otra ronda: no hay nada que hacer. */
  changed: boolean;
  /** Enlaces pendientes que se anulan (otro aprobador rechazó). */
  revokedEmails: string[];
  /** Secuencial: siguiente aprobador que debe recibir su enlace. */
  nextReviewer: OrionDraftClientReviewer | null;
};

/**
 * Decisión de un aprobador (webhook de Orion). Un rechazo cierra la ronda y anula a los
 * pendientes; con todos aceptados el documento queda aprobado por el cliente.
 */
export function applyDraftClientDecision(
  state: OrionDraftState,
  params: {
    email: string;
    decision: 'ACEPTADO' | 'RECHAZADO';
    comment?: string | null;
    decidedAt?: string | null;
  },
  now = new Date().toISOString()
): DraftClientDecisionResult {
  const unchanged: DraftClientDecisionResult = {
    state,
    changed: false,
    revokedEmails: [],
    nextReviewer: null,
  };
  const review = state.clientReview;
  if (state.status !== 'EN_REVISION_CLIENTE' || !review || review.closedAt) return unchanged;
  const email = normalizeEmail(params.email);
  const reviewer = review.reviewers.find((r) => r.email === email);
  if (!reviewer || reviewer.decision !== 'PENDIENTE') return unchanged;

  const decidedAt = params.decidedAt || now;
  const comment = String(params.comment || '').trim() || null;

  if (params.decision === 'RECHAZADO') {
    const revokedEmails: string[] = [];
    const reviewers = review.reviewers.map((r) => {
      if (r.email === email) return { ...r, decision: 'RECHAZADO' as const, decidedAt, comment };
      if (r.decision === 'PENDIENTE') {
        if (r.reviewUrl) revokedEmails.push(r.email);
        return { ...r, decision: 'ANULADO' as const, decidedAt: now };
      }
      return r;
    });
    return {
      state: {
        ...state,
        status: 'RECHAZADO_CLIENTE',
        clientReview: { ...review, reviewers, closedAt: now },
        updatedAt: now,
      },
      changed: true,
      revokedEmails,
      nextReviewer: null,
    };
  }

  const reviewers = review.reviewers.map((r) =>
    r.email === email ? { ...r, decision: 'ACEPTADO' as const, decidedAt, comment } : r
  );
  const allAccepted = reviewers.every((r) => r.decision === 'ACEPTADO');
  const nextReview: OrionDraftClientReview = {
    ...review,
    reviewers,
    closedAt: allAccepted ? now : null,
  };
  const next =
    !allAccepted && review.mode === 'sequential' ? activeClientReviewers(nextReview)[0] ?? null : null;
  return {
    state: {
      ...state,
      status: allAccepted ? 'APROBADO_CLIENTE' : 'EN_REVISION_CLIENTE',
      clientReview: nextReview,
      updatedAt: now,
    },
    changed: true,
    revokedEmails: [],
    nextReviewer: next,
  };
}

export function applyDraftConverted(
  state: OrionDraftState,
  params: { pdfFileId: string; version: Omit<OrionDraftVersion, 'label' | 'kind'> },
  now = new Date().toISOString()
): OrionDraftState {
  if (state.status !== 'APROBADO_CLIENTE' && state.status !== 'VALIDADO_INTERNO') {
    throw draftError('Solo un documento validado (o aprobado por el cliente) se puede convertir a PDF.');
  }
  return {
    ...state,
    status: 'CONVERTIDO_PDF',
    lock: null,
    pdfFileId: params.pdfFileId,
    versions: [...state.versions, { ...params.version, label: 'v1.0', kind: 'pdf' }],
    updatedAt: now,
  };
}
