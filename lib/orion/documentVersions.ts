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

/**
 * Historial de versiones / descargas:
 * - Siempre: quien creó la solicitud (dueño del flujo).
 * - Admin: solo si NO es firmante de ese documento (evita fuga a firmantes con rol admin).
 * Firmantes y “Preparar firma” no ven el historial.
 */
export function canViewOrionDocumentVersions(params: {
  isAdmin?: boolean;
  currentUserId?: string | number | null;
  requesterId?: string | number | null;
  currentUserEmail?: string | null;
  requesterEmail?: string | null;
  /** Firmante del documento (aunque sea admin): no ve versiones salvo que sea el creador. */
  isSigner?: boolean;
  /** @deprecated Ignorado: Preparar firma no otorga ver versiones. */
  canManage?: boolean;
}): boolean {
  const isRequester =
    (params.currentUserId != null &&
      params.requesterId != null &&
      String(params.currentUserId) === String(params.requesterId)) ||
    (() => {
      const me = normalizeEmail(params.currentUserEmail);
      const owner = normalizeEmail(params.requesterEmail);
      return Boolean(me && owner && me === owner);
    })();

  if (isRequester) return true;
  if (params.isAdmin && !params.isSigner) return true;
  return false;
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
 * Gestor (fullHistory): todas las versiones ordenadas.
 * Sin historial: vacío (firmantes y resto no listan descargas de versiones).
 */
export function listOrionDocumentVersionsForViewer(
  state: OrionSignatureState | undefined | null,
  options: { fullHistory: boolean }
): OrionDocumentVersion[] {
  if (!options.fullHistory) return [];
  return listOrionDocumentVersions(state);
}

function earliestCompletedSignerTime(state: OrionSignatureState): number | null {
  const times = (state.signers ?? [])
    .map((s) => Date.parse(String(s.signedAt || '')))
    .filter((n) => Number.isFinite(n));
  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * Fecha del original: nunca posterior a la 1.ª firma.
 * Evita que un rebuild/sync ponga el original “después” de las parciales.
 */
export function resolveOriginalVersionCreatedAt(
  state: OrionSignatureState,
  existingCreatedAt?: string | null
): string {
  const earliestSign = earliestCompletedSignerTime(state);
  const existing = Date.parse(String(existingCreatedAt || ''));

  if (earliestSign != null) {
    if (Number.isFinite(existing) && existing < earliestSign) {
      return new Date(existing).toISOString();
    }
    return new Date(earliestSign - 1000).toISOString();
  }

  if (Number.isFinite(existing)) return new Date(existing).toISOString();
  const updated = Date.parse(String(state.updatedAt || ''));
  if (Number.isFinite(updated)) return new Date(updated).toISOString();
  return new Date().toISOString();
}

export function ensureOriginalOrionVersion(
  state: OrionSignatureState,
  originalUrl?: string | null
): OrionSignatureState {
  const url = String(originalUrl || state.originalFileUrl || '').trim();
  if (!url) return state;

  const versions = [...(state.versions ?? [])];
  const originalIdx = versions.findIndex((v) => v.kind === 'original');

  if (originalIdx < 0) {
    versions.unshift({
      id: 'original',
      kind: 'original',
      label: 'Original (v1)',
      url,
      createdAt: resolveOriginalVersionCreatedAt(state),
    });
  } else {
    const prev = versions[originalIdx]!;
    const fixedAt = resolveOriginalVersionCreatedAt(state, prev.createdAt);
    if (fixedAt !== prev.createdAt || (url && !prev.url)) {
      versions[originalIdx] = {
        ...prev,
        url: prev.url || url,
        createdAt: fixedAt,
        label: prev.label || 'Original (v1)',
      };
    }
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
  const prevOriginal = (state.versions ?? []).find((v) => v.kind === 'original');
  const base = ensureOriginalOrionVersion(
    {
      ...state,
      signedFileUrl: workingUrl ?? state.signedFileUrl ?? null,
      // Conservar el original previo (fecha) al reconstruir el historial.
      versions: prevOriginal ? [prevOriginal] : undefined,
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
