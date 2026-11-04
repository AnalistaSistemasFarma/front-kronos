import type {
  OrionReviewApproval,
  OrionReviewState,
  OrionSignatureState,
} from './types';

export type OrionReviewValidator = {
  userId: string;
  email: string;
  name?: string | null;
  jobTitle?: string | null;
  order: number;
};

export function orionReviewStatus(state?: OrionSignatureState | null): OrionReviewState['status'] {
  return state?.review?.status ?? 'SIN_VALIDACION';
}

/**
 * Lo que se sabe solo con el documento: una validación iniciada decide por sí sola.
 * `null` = depende de si el flujo tiene validadores (hay que consultarlo).
 */
export function knownReadyForSigning(state?: OrionSignatureState | null): boolean | null {
  if (state?.skipValidation) return true;
  const status = state?.review?.status;
  if (!status || status === 'SIN_VALIDACION') return null;
  return status === 'APROBADO';
}

/**
 * Sin validadores en el flujo, o documento marcado "Sin validación" → se puede firmar como siempre.
 * Con validadores → solo tras la aprobación del último validador elegido para el documento.
 */
export function isOrionReadyForSigning(
  state: OrionSignatureState | null | undefined,
  flowHasValidators: boolean
): boolean {
  if (!flowHasValidators || state?.skipValidation) return true;
  return orionReviewStatus(state) === 'APROBADO';
}

export function buildPendingApprovals(validators: OrionReviewValidator[]): OrionReviewApproval[] {
  return [...validators]
    .sort((a, b) => a.order - b.order)
    .map((v, index) => ({
      userId: v.userId,
      email: v.email.trim().toLowerCase(),
      name: v.name ?? null,
      jobTitle: v.jobTitle ?? null,
      order: index + 1,
      decision: 'PENDIENTE' as const,
      decidedAt: null,
      comment: null,
    }));
}

/**
 * Validadores de UN documento: el preparador elige quiénes (del grupo del flujo) y en qué
 * orden. Devuelve también los ids que no pertenecen al grupo para rechazarlos.
 */
export function orderDocumentValidators(
  flowValidators: OrionReviewValidator[],
  selectedUserIds: unknown
): { validators: OrionReviewValidator[]; unknownIds: string[] } {
  const byId = new Map(flowValidators.map((v) => [v.userId, v]));
  const validators: OrionReviewValidator[] = [];
  const unknownIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(selectedUserIds) ? selectedUserIds : []) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const validator = byId.get(id);
    if (!validator) {
      unknownIds.push(id);
      continue;
    }
    validators.push({ ...validator, order: validators.length + 1 });
  }
  return { validators, unknownIds };
}

/** Orden usado en la ronda anterior del documento (para reenviar una versión corregida). */
export function previousReviewValidatorIds(review?: OrionReviewState | null): string[] {
  return [...(review?.approvals ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((a) => String(a.userId ?? '').trim())
    .filter(Boolean);
}

export function currentPendingApproval(
  review?: OrionReviewState | null
): OrionReviewApproval | null {
  if (!review || review.status !== 'EN_VALIDACION') return null;
  return (
    [...review.approvals]
      .sort((a, b) => a.order - b.order)
      .find((a) => a.decision === 'PENDIENTE') ?? null
  );
}

export const SELF_REVIEW_COMMENT = 'Validó al preparar el documento';

function isSameUser(
  approval: OrionReviewApproval,
  user: { userId?: string | null; email?: string | null }
): boolean {
  const id = String(user.userId ?? '').trim();
  if (id && String(approval.userId ?? '').trim() === id) return true;
  const email = String(user.email ?? '').trim().toLowerCase();
  return Boolean(email) && approval.email.trim().toLowerCase() === email;
}

/** ¿Quien envía a validación es también uno de los validadores elegidos? */
export function submitterIsValidator(
  approvals: OrionReviewApproval[],
  submitter: { userId?: string | null; email?: string | null }
): boolean {
  return approvals.some((a) => isSameUser(a, submitter));
}

/**
 * La preparadora que también valida no se crea una tarea a sí misma: su paso queda aprobado
 * al enviar (ella preparó y validó). Si era la única que faltaba, el documento queda aprobado
 * para firma y en la firma ubica su visto bueno como cualquier validador.
 */
export function autoApproveSubmitter(
  review: OrionReviewState,
  submitter: { userId?: string | null; email?: string | null; name?: string | null },
  at: string
): OrionReviewState {
  if (review.status !== 'EN_VALIDACION') return review;
  let changed = false;
  const approvals = review.approvals.map((a) => {
    if (a.decision !== 'PENDIENTE' || !isSameUser(a, submitter)) return a;
    changed = true;
    return {
      ...a,
      decision: 'APROBADO' as const,
      decidedAt: at,
      comment: SELF_REVIEW_COMMENT,
      name: a.name || submitter.name || null,
    };
  });
  if (!changed) return review;
  const stillPending = approvals.some((a) => a.decision === 'PENDIENTE');
  return stillPending
    ? { ...review, approvals }
    : { ...review, approvals, status: 'APROBADO', approvedAt: at };
}

export function completedApprovals(review?: OrionReviewState | null): OrionReviewApproval[] {
  return (review?.approvals ?? [])
    .filter((a) => a.decision === 'APROBADO')
    .sort((a, b) => a.order - b.order);
}

export function markReviewReturned(
  review: OrionReviewState,
  opts: { reason: string | null; returnedBy: string | null }
): OrionReviewState {
  return {
    ...review,
    status: 'DEVUELTO_CORRECCION',
    returnReason: opts.reason,
    returnedBy: opts.returnedBy,
    returnedAt: new Date().toISOString(),
  };
}

/**
 * PDF que viene de un Word validado: una subversión corregida del PDF conserva la aprobación del
 * Word (una sola validación) y queda lista para firmar otra vez.
 */
export function keepWordApprovalForNewVersion(review: OrionReviewState, versionLabel: string): OrionReviewState {
  return {
    ...review,
    status: 'APROBADO',
    versionLabel,
    returnReason: null,
    returnedBy: null,
    returnedAt: null,
  };
}

/** Tras reemplazar el PDF (nueva subversión) las aprobaciones anteriores dejan de valer. */
export function resetReviewForNewVersion(
  review: OrionReviewState | null | undefined,
  versionLabel: string
): OrionReviewState | null {
  if (!review) return null;
  // Validado en el Word: el PDF no se vuelve a validar.
  if (review.source === 'word') return keepWordApprovalForNewVersion(review, versionLabel);
  return {
    ...review,
    status: review.status === 'DEVUELTO_CORRECCION' ? 'DEVUELTO_CORRECCION' : 'SIN_VALIDACION',
    versionLabel,
    approvedAt: null,
    approvals: review.approvals.map((a) => ({
      ...a,
      decision: 'PENDIENTE',
      decidedAt: null,
      comment: null,
    })),
  };
}

export const ORION_REVIEW_STATUS_LABEL: Record<OrionReviewState['status'], string> = {
  SIN_VALIDACION: 'Sin enviar a validación',
  EN_VALIDACION: 'En validación',
  DEVUELTO_CORRECCION: 'Devuelto para corrección',
  APROBADO: 'Aprobado para firma',
};
