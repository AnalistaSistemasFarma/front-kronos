import { newlyCompletedSigners } from './signerStatus';
import type { OrionDocumentVersion, OrionSignatureState, OrionSignerState } from './types';

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function versionIdForSigner(signer: OrionSignerState): string {
  const email = normalizeEmail(signer.email) || 'unknown';
  const at = signer.signedAt || 'pending';
  return `sign-${email}-${at}`;
}

/** Admin o quien creó la solicitud puede ver el historial de versiones. */
export function canViewOrionDocumentVersions(params: {
  isAdmin?: boolean;
  currentUserId?: string | number | null;
  requesterId?: string | number | null;
}): boolean {
  if (params.isAdmin) return true;
  if (params.currentUserId == null || params.requesterId == null) return false;
  return String(params.currentUserId) === String(params.requesterId);
}

/** URL del PDF vigente: última versión firmada o el original. */
export function resolveOrionPdfUrl(
  state: OrionSignatureState | undefined | null,
  originalUrl?: string | null
): string | null {
  if (!state) return originalUrl ?? null;

  const versions = state.versions ?? [];
  const signedVersions = versions.filter((v) => v.kind !== 'original');
  if (signedVersions.length > 0) {
    return signedVersions[signedVersions.length - 1]!.url;
  }

  if (state.signedFileUrl) return state.signedFileUrl;
  if (state.originalFileUrl) return state.originalFileUrl;
  return originalUrl ?? null;
}

export function listOrionDocumentVersions(
  state: OrionSignatureState | undefined | null
): OrionDocumentVersion[] {
  return [...(state?.versions ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
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
      label: 'Original',
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

  for (const signer of newlyDone) {
    if (!workingUrl) continue;
    const id = versionIdForSigner(signer);
    if (versions.some((v) => v.id === id)) continue;
    const isFinal = String(merged.status || '').toUpperCase() === 'FIRMADO';
    versions.push({
      id,
      kind: isFinal ? 'final' : 'partial',
      label: `Firmado por ${signer.name || signer.email || 'firmante'}`,
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
