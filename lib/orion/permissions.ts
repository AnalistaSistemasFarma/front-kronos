import { getCurrentPendingSigner } from './signerStatus';
import type { OrionSignatureState } from './types';

/** Dos perfiles de usuario en el flujo de firma */
export type OrionUserRole = 'coordinator' | 'signer' | 'waiting' | 'viewer';

export type OrionUiPermissions = {
  userRole: OrionUserRole;
  /** Coordinador: carga documento, ubica firmas y asigna firmantes */
  canUploadDocument: boolean;
  canUseAttachment: boolean;
  canAssignSigners: boolean;
  canPlaceSignatures: boolean;
  canManageWorkflow: boolean;
  /** Editar lista/orden de firmantes (tarea y solicitud abiertas) */
  canEditAssignments: boolean;
  /** Firmante: dibuja su firma y acepta cuando es su turno */
  canDrawSignature: boolean;
  canViewDocument: boolean;
  canAcceptSign: boolean;
  isSigner: boolean;
  isMyTurn: boolean;
  isReadOnly: boolean;
  roleLabel: string;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function isTerminalStatus(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return value === 'FIRMADO' || value === 'RECHAZADO';
}

function isSigningPhase(status?: string | null, state?: OrionSignatureState | null): boolean {
  const value = String(status || '').toUpperCase();
  if (value === 'EN_PROCESO' || value === 'PENDIENTE_FIRMA') return true;
  // Bag con firmantes y documento Orion = flujo de firma activo aunque falte status
  if (state?.orionDocumentId && (state.signers?.length ?? 0) > 0 && !isTerminalStatus(value)) {
    return true;
  }
  return false;
}

export function resolveOrionPermissions(params: {
  canManage: boolean;
  isAdmin?: boolean;
  currentUserEmail?: string | null;
  state?: OrionSignatureState | null;
  hasAttachment?: boolean;
  participantEmails?: string[];
  hasPersonalSignature?: boolean;
  /** Tarea o solicitud cerrada → no editar asignación de firmantes */
  workflowLocked?: boolean;
}): OrionUiPermissions {
  const {
    canManage,
    isAdmin = false,
    currentUserEmail,
    state,
    hasAttachment = false,
    participantEmails = [],
    hasPersonalSignature = false,
    workflowLocked = false,
  } = params;

  const me = normalizeEmail(currentUserEmail);
  const statusUpper = String(state?.status || '').toUpperCase();
  const isTerminal = isTerminalStatus(statusUpper);
  const signingPhase = isSigningPhase(statusUpper, state);
  const hasDocument = Boolean(state?.orionDocumentId && state?.embedUrl);

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
  const mySigner = (state?.signers ?? []).find((s) => normalizeEmail(s.email) === me);
  const iCompleted =
    mySigner &&
    ['FIRMADO', 'SIGNED', 'COMPLETED'].includes(String(mySigner.status || '').toUpperCase());

  let userRole: OrionUserRole = 'viewer';

  if (isTerminal) {
    userRole = 'viewer';
  } else if (signingPhase) {
    if (iCompleted) userRole = 'viewer';
    else if (isMyTurn) userRole = 'signer';
    else if (isSigner) userRole = 'waiting';
    // En fase de firma, un firmante nunca es coordinador aunque tenga otras tareas
    else if ((canManage || isAdmin) && !workflowLocked) userRole = 'coordinator';
    else userRole = 'viewer';
  } else if (canManage || isAdmin) {
    userRole = 'coordinator';
  } else if (isSigner && !iCompleted) {
    userRole = 'waiting';
  }

  const isCoordinator = userRole === 'coordinator';
  const isSignerUser = userRole === 'signer';
  const isWaitingSigner = userRole === 'waiting';

  let roleLabel = 'Consulta';
  if (isAdmin && isCoordinator) roleLabel = 'Coordinador (admin)';
  else if (isCoordinator) roleLabel = 'Coordinador de firma';
  else if (isSignerUser) roleLabel = 'Firmante — su turno';
  else if (isWaitingSigner) roleLabel = 'Firmante — en espera';
  else if (isTerminal) roleLabel = 'Proceso finalizado';

  const canManageRequest =
    (canManage || isAdmin) && !workflowLocked && !isTerminal;

  const canEditAssignments =
    canManageRequest && hasDocument && userRole === 'coordinator';
  const canManageWorkflow =
    canManageRequest && (userRole === 'coordinator' || !signingPhase);
  const canUploadDocument = canManageRequest && !hasDocument && userRole === 'coordinator';
  const canUseAttachment =
    canManageRequest && hasAttachment && !hasDocument && userRole === 'coordinator';
  const canAssignSigners = canEditAssignments;
  const canPlaceSignatures = canEditAssignments;
  const canDrawSignature = isSignerUser && !isTerminal;
  const canViewDocument =
    (isSignerUser || isWaitingSigner || isCoordinator) &&
    (hasDocument || hasAttachment || Boolean(state?.signedFileUrl));
  const canAcceptSign = isSignerUser && hasDocument && hasPersonalSignature;

  const isReadOnly = userRole === 'viewer' && !isTerminal;

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
    isSigner,
    isMyTurn,
    isReadOnly,
    roleLabel,
  };
}
