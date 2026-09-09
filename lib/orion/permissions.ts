import {
  allSlotsCompletedForEmail,
  getCurrentPendingSigner,
  isSignerCompleted,
} from './signerStatus';
import type { OrionSignatureState } from './types';

/** Perfiles de UI en el flujo de firma (derivados del permiso, no roles de admin). */
export type OrionUserRole = 'coordinator' | 'signer' | 'waiting' | 'viewer';

export type OrionUiPermissions = {
  userRole: OrionUserRole;
  /** Con permiso de firma: carga documento, ubica firmas y asigna firmantes */
  canUploadDocument: boolean;
  canUseAttachment: boolean;
  canAssignSigners: boolean;
  canPlaceSignatures: boolean;
  canManageWorkflow: boolean;
  /** Editar lista/orden de firmantes (solicitud abierta) */
  canEditAssignments: boolean;
  /** Firmante: dibuja su firma y acepta cuando es su turno */
  canDrawSignature: boolean;
  canViewDocument: boolean;
  canAcceptSign: boolean;
  /** Creador/líder: renovar plazo 24h aunque ya haya firmas */
  canRenewDeadline: boolean;
  isSigner: boolean;
  isMyTurn: boolean;
  isRequestCreator: boolean;
  hasCompletedSignature: boolean;
  isReadOnly: boolean;
  roleLabel: string;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isTerminalStatus(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return value === 'FIRMADO' || value === 'RECHAZADO';
}

function isReturnedStatus(status?: string | null): boolean {
  return String(status || '').toUpperCase() === 'DEVUELTO';
}

function isSigningPhase(status?: string | null, state?: OrionSignatureState | null): boolean {
  const value = String(status || '').toUpperCase();
  if (value === 'EN_PROCESO' || value === 'PENDIENTE_FIRMA') return true;
  if (value === 'BORRADOR' || isReturnedStatus(value) || isTerminalStatus(value)) return false;
  if (!value && state?.orionDocumentId && (state.signers?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

export function hasAnyCompletedOrionSignature(
  state?: OrionSignatureState | null
): boolean {
  return (state?.signers ?? []).some((s) => isSignerCompleted(s.status));
}

export function isOrionRequestCreator(params: {
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  createdByEmail?: string | null;
  requesterId?: string | null;
}): boolean {
  const me = normalizeEmail(params.currentUserEmail);
  const creatorEmail = normalizeEmail(params.createdByEmail);
  if (me && creatorEmail && me === creatorEmail) return true;

  const uid = String(params.currentUserId || '').trim();
  const rid = String(params.requesterId || '').trim();
  return Boolean(uid && rid && uid === rid);
}

/**
 * Edición de documento/firmantes/posiciones:
 * creador/admin (canManage) + solicitud abierta + nadie ha firmado.
 */
export function canEditOrionPreparation(params: {
  canManage: boolean;
  workflowLocked?: boolean;
  state?: OrionSignatureState | null;
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  createdByEmail?: string | null;
  requesterId?: string | null;
}): boolean {
  if (!params.canManage || params.workflowLocked) return false;
  if (isTerminalStatus(params.state?.status)) return false;
  if (hasAnyCompletedOrionSignature(params.state)) return false;
  // canManage ya implica creador o admin en el servidor.
  return true;
}

export function resolveOrionPermissions(params: {
  canManage: boolean;
  isAdmin?: boolean;
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  createdByEmail?: string | null;
  requesterId?: string | null;
  state?: OrionSignatureState | null;
  hasAttachment?: boolean;
  participantEmails?: string[];
  hasPersonalSignature?: boolean;
  /** Tarea o solicitud cerrada → no editar asignación de firmantes */
  workflowLocked?: boolean;
}): OrionUiPermissions {
  const {
    canManage,
    currentUserEmail,
    currentUserId,
    createdByEmail,
    requesterId,
    state,
    hasAttachment = false,
    participantEmails = [],
    hasPersonalSignature = false,
    workflowLocked = false,
  } = params;
  void params.isAdmin;

  const me = normalizeEmail(currentUserEmail);
  const statusUpper = String(state?.status || '').toUpperCase();
  const isTerminal = isTerminalStatus(statusUpper);
  const signingPhase = isSigningPhase(statusUpper, state);
  const hasDocument = Boolean(state?.orionDocumentId && state?.embedUrl);
  const hasCompletedSignature = hasAnyCompletedOrionSignature(state);
  const isCreator = isOrionRequestCreator({
    currentUserEmail,
    currentUserId,
    createdByEmail,
    requesterId,
  });

  const signerEmails = new Set(
    (state?.signers ?? [])
      .map((s) => normalizeEmail(s.email))
      .filter(Boolean)
  );
  for (const email of participantEmails.map(normalizeEmail).filter(Boolean)) {
    signerEmails.add(email);
  }

  const isSigner = me ? signerEmails.has(me) : false;
  const pendingSigner = getCurrentPendingSigner(state?.signers);
  const isMyTurn = Boolean(
    me && pendingSigner && normalizeEmail(pendingSigner.email) === me
  );
  // Completó TODAS sus apariciones; si aún tiene un slot pendiente, puede volver a firmar.
  const iCompleted = me ? allSlotsCompletedForEmail(state?.signers, me) : false;

  let userRole: OrionUserRole = 'viewer';

  if (isTerminal) {
    userRole = 'viewer';
  } else if (signingPhase) {
    if (iCompleted) userRole = 'viewer';
    else if (isMyTurn) userRole = 'signer';
    else if (isSigner) userRole = 'waiting';
    else if (canManage && !workflowLocked) userRole = 'coordinator';
    else userRole = 'viewer';
  } else if (canManage) {
    userRole = 'coordinator';
  } else if (isSigner && !iCompleted) {
    userRole = 'waiting';
  }

  const isCoordinator = userRole === 'coordinator';
  const isSignerUser = userRole === 'signer';
  const isWaitingSigner = userRole === 'waiting';

  let roleLabel = 'Consulta';
  if (isCoordinator && isReturnedStatus(statusUpper))
    roleLabel = 'Gestión de firma — documento devuelto';
  else if (isCoordinator) roleLabel = 'Gestión de firma';
  else if (isSignerUser) roleLabel = 'Firmante — su turno';
  else if (isWaitingSigner) roleLabel = 'Firmante — en espera';
  else if (isTerminal) roleLabel = 'Proceso finalizado';

  const canEditPrep = canEditOrionPreparation({
    canManage,
    workflowLocked,
    state,
    currentUserEmail,
    currentUserId,
    createdByEmail,
    requesterId,
  });

  const canManageWorkflow = canEditPrep;
  const canEditAssignments = canEditPrep && hasDocument;
  const canUploadDocument = canEditPrep && !hasDocument;
  const canUseAttachment = canEditPrep && hasAttachment && !hasDocument;
  const canAssignSigners = canEditAssignments;
  const canPlaceSignatures = canEditAssignments;
  const canDrawSignature = isSignerUser && !isTerminal;
  const canViewDocument =
    (isSignerUser || isWaitingSigner || isCoordinator || isCreator) &&
    (hasDocument || hasAttachment || Boolean(state?.signedFileUrl));
  const turnExpired =
    isMyTurn &&
    Boolean(
      pendingSigner &&
        pendingSigner.expiresAt &&
        new Date(pendingSigner.expiresAt).getTime() < Date.now()
    );
  const canAcceptSign =
    isSignerUser && hasDocument && hasPersonalSignature && !turnExpired;
  const canRenewDeadline = isCreator && !workflowLocked && !isTerminal && signingPhase;

  const isReadOnly = !canEditPrep && !isSignerUser;

  return {
    userRole,
    canUploadDocument,
    canUseAttachment,
    canAssignSigners,
    canPlaceSignatures,
    canManageWorkflow,
    canEditAssignments,
    canDrawSignature,
    canViewDocument,
    canAcceptSign,
    canRenewDeadline,
    isSigner,
    isMyTurn,
    isRequestCreator: isCreator,
    hasCompletedSignature,
    isReadOnly,
    roleLabel,
  };
}
