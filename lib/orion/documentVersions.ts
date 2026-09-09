import {
  allSignersCompleted,
  isSignerCompleted,
  newlyCompletedSigners,
  orderedSigners,
} from './signerStatus';
import type { OrionDocumentVersion, OrionSignatureState, OrionSignerState } from './types';

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function versionIdForSigner(signer: OrionSignerState): string {
  const email = normalizeEmail(signer.email) || 'unknown';
  const order = Number(signer.order);
  const orderPart = Number.isFinite(order) && order > 0 ? String(order) : 'x';
  const at = signer.signedAt || 'pending';
  return `sign-${email}-${orderPart}-${at}`;
}

/** Admin o quien creó la solicitud puede ver el historial completo de versiones. */
export function canViewOrionDocumentVersions(params: {
  isAdmin?: boolean;
  currentUserId?: string | number | null;
  requesterId?: string | number | null;
}): boolean {
  if (params.isAdmin) return true;
  if (params.currentUserId == null || params.requesterId == null) return false;
  return String(params.currentUserId) === String(params.requesterId);
}

/** ¿El usuario actual es firmante del documento (no necesariamente creador)? */
export function isOrionDocumentSigner(
  state: OrionSignatureState | undefined | null,
  currentUserEmail?: string | null
): boolean {
  const me = normalizeEmail(currentUserEmail);
  if (!me) return false;
  return (state?.signers ?? []).some((s) => normalizeEmail(s.email) === me);
}

/** URL del PDF vigente: última versión firmada o el original. */
export function resolveOrionPdfUrl(
  state: OrionSignatureState | undefined | null,
  originalUrl?: string | null
): string | null {
  if (!state) return originalUrl ?? null;

  const ordered = listOrionDocumentVersions(state);
  const signedVersions = ordered.filter((v) => v.kind !== 'original');
  if (signedVersions.length > 0) {
    return signedVersions[signedVersions.length - 1]!.url;
  }

  // signedFileUrl de Orion existe desde BORRADOR, pero el endpoint responde 409
  // hasta que haya al menos una firma acumulada. No usarlo antes de tiempo.
  const hasCompletedSigner = (state.signers ?? []).some((s) => isSignerCompleted(s.status));
  const status = String(state.status || '').toUpperCase();
  const signedReady =
    hasCompletedSigner || status === 'FIRMADO' || status === 'SIGNED' || status === 'COMPLETED';

  if (signedReady && state.signedFileUrl) return state.signedFileUrl;
  if (state.originalFileUrl) return state.originalFileUrl;
  return originalUrl ?? null;
}

/**
 * Orden: 1) original, 2) parciales por orden de firmante, 3) final.
 * Desempate por fecha de creación.
 */
export function listOrionDocumentVersions(
  state: OrionSignatureState | undefined | null
): OrionDocumentVersion[] {
  const versions = [...(state?.versions ?? [])];
  const orderBySlot = new Map<string, number>();
  for (const signer of state?.signers ?? []) {
    const email = normalizeEmail(signer.email);
    const order = Number(signer.order);
    const slotOrder = Number.isFinite(order) && order > 0 ? order : 999;
    // Preferir orden del slot; si hay varios del mismo email, cada versión se
    // desempatará por createdAt.
    if (email) orderBySlot.set(email, Math.min(orderBySlot.get(email) ?? 999, slotOrder));
    if (Number.isFinite(order) && order > 0) {
      orderBySlot.set(`order:${order}`, order);
    }
  }

  const rank = (v: OrionDocumentVersion): number => {
    if (v.kind === 'original') return 0;
    if (v.kind === 'final') return 10_000;
    const email = normalizeEmail(v.signerEmail);
    // Si la versión guarda order implícito vía id sign-email-order-..., usarlo.
    const fromId = String(v.id || '').match(/^sign-[^-]+-(\d+)-/);
    if (fromId?.[1]) return 100 + Number(fromId[1]);
    const signerOrder = email ? orderBySlot.get(email) : undefined;
    return 100 + (signerOrder ?? 999);
  };

  return versions.sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/**
 * Creador/admin: todas las versiones (ordenadas).
 * Firmante: únicamente la última versión firmada (no el original ni parciales intermedias).
 */
export function listOrionDocumentVersionsForViewer(
  state: OrionSignatureState | undefined | null,
  options: { fullHistory: boolean }
): OrionDocumentVersion[] {
  const ordered = listOrionDocumentVersions(state);
  if (options.fullHistory) return ordered;

  const signed = ordered.filter((v) => v.kind !== 'original');
  if (signed.length === 0) return [];
  return [signed[signed.length - 1]!];
}

export function ensureOriginalOrionVersion(
  state: OrionSignatureState,
  originalUrl?: string | null
): OrionSignatureState {
  const url = String(originalUrl || state.originalFileUrl || '').trim();
  if (!url) return state;

  const versions = [...(state.versions ?? [])];
  if (!versions.some((v) => v.kind === 'original')) {
    versions.unshift({
      id: 'original',
      kind: 'original',
      label: 'Original (v1)',
      url,
      createdAt: state.updatedAt ?? new Date().toISOString(),
    });
  }

  return {
    ...state,
    originalFileUrl: state.originalFileUrl ?? url,
    versions,
  };
}

export function applyOrionVersionHistory(params: {
  previous: OrionSignatureState;
  next: OrionSignatureState;
  previousSigners?: OrionSignerState[] | null;
  originalUrl?: string | null;
}): OrionSignatureState {
  let merged = ensureOriginalOrionVersion(
    {
      ...params.next,
      originalFileUrl:
        params.next.originalFileUrl ??
        params.previous.originalFileUrl ??
        params.originalUrl ??
        null,
    },
    params.originalUrl ?? params.previous.originalFileUrl ?? null
  );

  const versions = [...(merged.versions ?? [])];
  const newlyDone = newlyCompletedSigners(params.previousSigners, merged.signers);
  const workingUrl = merged.signedFileUrl ?? null;
  const signedCount = (merged.signers ?? []).filter((s) =>
    Boolean(s.signedAt) || String(s.status || '').toUpperCase() === 'FIRMADO'
  ).length;

  for (const signer of newlyDone) {
    if (!workingUrl) continue;
    const id = versionIdForSigner(signer);
    if (versions.some((v) => v.id === id)) continue;
    const isFinal = String(merged.status || '').toUpperCase() === 'FIRMADO';
    const order = Number(signer.order);
    const firmaN = Number.isFinite(order) && order > 0 ? order : signedCount;
    versions.push({
      id,
      kind: isFinal ? 'final' : 'partial',
      label: isFinal
        ? `Firma ${firmaN} (final) — ${signer.name || signer.email || 'firmante'}`
        : `Firma ${firmaN} — ${signer.name || signer.email || 'firmante'}`,
      url: workingUrl,
      createdAt: signer.signedAt ?? new Date().toISOString(),
      signerEmail: signer.email ?? null,
      signerName: signer.name ?? null,
    });
  }

  if (
    workingUrl &&
    String(merged.status || '').toUpperCase() === 'FIRMADO' &&
    !versions.some((v) => v.kind === 'final')
  ) {
    versions.push({
      id: `final-${merged.signedAt ?? Date.now()}`,
      kind: 'final',
      label: 'Documento firmado (completo)',
      url: workingUrl,
      createdAt: merged.signedAt ?? new Date().toISOString(),
    });
  }

  merged = { ...merged, versions };
  return merged;
}

/**
 * Reconstruye el historial completo desde los firmantes ya completados.
 * Corrige documentos antiguos con versiones faltantes o desordenadas.
 */
export function rebuildOrionVersionHistory(
  state: OrionSignatureState,
  originalUrl?: string | null,
  signedFileUrlFallback?: string | null
): OrionSignatureState {
  const workingUrl =
    String(state.signedFileUrl || signedFileUrlFallback || '').trim() || null;
  const base = ensureOriginalOrionVersion(
    {
      ...state,
      signedFileUrl: workingUrl ?? state.signedFileUrl ?? null,
      versions: undefined,
    },
    originalUrl ?? state.originalFileUrl ?? null
  );

  const versions: OrionDocumentVersion[] = [...(base.versions ?? [])].filter(
    (v) => v.kind === 'original'
  );

  if (!workingUrl) {
    return { ...base, versions };
  }

  const completed = orderedSigners(base.signers).filter((s) => isSignerCompleted(s.status));
  const fullySigned =
    String(base.status || '').toUpperCase() === 'FIRMADO' || allSignersCompleted(base.signers);

  completed.forEach((signer, index) => {
    const isLast = index === completed.length - 1 && fullySigned;
    const order = Number(signer.order);
    const firmaN = Number.isFinite(order) && order > 0 ? order : index + 1;
    versions.push({
      id: versionIdForSigner(signer),
      kind: isLast ? 'final' : 'partial',
      label: isLast
        ? `Firma ${firmaN} (final) — ${signer.name || signer.email || 'firmante'}`
        : `Firma ${firmaN} — ${signer.name || signer.email || 'firmante'}`,
      url: workingUrl,
      createdAt: signer.signedAt ?? base.updatedAt ?? new Date().toISOString(),
      signerEmail: signer.email ?? null,
      signerName: signer.name ?? null,
    });
  });

  if (fullySigned && workingUrl && !versions.some((v) => v.kind === 'final') && completed.length > 0) {
    versions.push({
      id: `final-${base.signedAt ?? Date.now()}`,
      kind: 'final',
      label: 'Documento firmado (completo)',
      url: workingUrl,
      createdAt: base.signedAt ?? new Date().toISOString(),
    });
  }

  return { ...base, signedFileUrl: workingUrl, versions };
}
