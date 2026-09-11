import { ORION_LEGACY_FILE_ID } from './config';
import type {
  OrionSignatureBagBag,
  OrionSignatureIntent,
  OrionSignatureState,
} from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripBagMeta(state: OrionSignatureState): OrionSignatureState {
  const { updatedAt: _u, ...rest } = state;
  return rest;
}

/** Detecta JSON plano legacy (sin mapa documents). */
function isLegacyFlatState(parsed: Record<string, unknown>): boolean {
  if (isPlainObject(parsed.documents)) return false;
  return Boolean(
    parsed.orionDocumentId ||
      parsed.externalRef ||
      parsed.status ||
      parsed.embedUrl ||
      parsed.signedFileUrl ||
      parsed.signers
  );
}

export function emptyOrionFormBag(): OrionSignatureBagBag {
  return { documents: {} };
}

/**
 * Resuelve si el PDF es para firmar o solo ver.
 * Si ya hay flujo Orion (doc, firmantes o estado activo), siempre es "sign"
 * aunque quede un signatureIntent:"view" residual (evita bloquear al firmante).
 */
export function resolveOrionSignatureIntent(
  state?: OrionSignatureState | null
): OrionSignatureIntent {
  const raw = String(state?.signatureIntent || '')
    .trim()
    .toLowerCase();
  const statusUpper = String(state?.status || '')
    .trim()
    .toUpperCase();
  const hasActiveSignFlow =
    Boolean(state?.orionDocumentId) ||
    (state?.signers?.length ?? 0) > 0 ||
    Boolean(statusUpper && statusUpper !== 'BORRADOR');

  if (hasActiveSignFlow) return 'sign';
  if (raw === 'sign' || raw === 'view') return raw;
  return 'view';
}

export function isOrionSignDocument(state?: OrionSignatureState | null): boolean {
  return resolveOrionSignatureIntent(state) === 'sign';
}

/**
 * Normaliza cualquier value_text a { documents }.
 * Compat: JSON plano legacy → documents[_legacy].
 */
export function parseOrionSignatureBagBag(raw: string | null | undefined): OrionSignatureBagBag {
  if (!raw?.trim()) return emptyOrionFormBag();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return emptyOrionFormBag();

    if (isPlainObject(parsed.documents)) {
      const documents: Record<string, OrionSignatureState> = {};
      for (const [key, value] of Object.entries(parsed.documents)) {
        if (!isPlainObject(value)) continue;
        documents[key] = {
          ...(value as OrionSignatureState),
          fileId: String((value as OrionSignatureState).fileId || key),
        };
      }
      return {
        documents,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
    }

    if (isLegacyFlatState(parsed)) {
      const { documents: _d, updatedAt, ...rest } = parsed;
      return {
        documents: {
          [ORION_LEGACY_FILE_ID]: {
            ...(rest as OrionSignatureState),
            fileId: ORION_LEGACY_FILE_ID,
          },
        },
        updatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
      };
    }

    return emptyOrionFormBag();
  } catch {
    return emptyOrionFormBag();
  }
}

/**
 * @deprecated Preferir parseOrionSignatureBagBag.
 * Devuelve el primer documento del bag (legacy o único) para callers antiguos.
 */
export function parseOrionSignatureState(raw: string | null | undefined): OrionSignatureState {
  const bag = parseOrionSignatureBagBag(raw);
  const entries = Object.entries(bag.documents);
  if (entries.length === 0) return {};
  const legacy = bag.documents[ORION_LEGACY_FILE_ID];
  if (legacy) return legacy;
  return entries[0]![1];
}

export function serializeOrionSignatureBagBag(bag: OrionSignatureBagBag): string {
  return JSON.stringify({
    documents: bag.documents,
    updatedAt: new Date().toISOString(),
  });
}

/** Serializa un estado de documento único como bag de un solo entry (tests / compat). */
export function serializeOrionSignatureState(state: OrionSignatureState): string {
  const fileId = String(state.fileId || ORION_LEGACY_FILE_ID);
  return serializeOrionSignatureBagBag({
    documents: {
      [fileId]: {
        ...stripBagMeta(state),
        fileId,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

export function getOrionDocumentFromBag(
  bag: OrionSignatureBagBag,
  fileId: string
): OrionSignatureState {
  const key = String(fileId || '').trim();
  if (!key) return {};
  return bag.documents[key] ?? {};
}

/**
 * Resuelve el estado Orion de un adjunto.
 * Cada PDF es independiente: no reutilizar el estado de otro fileId
 * (aunque solo haya un documento Orion en el bag).
 */
export function resolveOrionDocumentForAttachment(params: {
  fileId: string;
  fileName?: string | null;
  documents?: Record<string, OrionSignatureState> | null;
  fallback?: OrionSignatureState | null;
}): OrionSignatureState {
  const fileId = String(params.fileId || '').trim();
  const docs = params.documents ?? {};
  const byId = fileId ? docs[fileId] : undefined;
  if (
    byId &&
    (byId.orionDocumentId ||
      (byId.signers?.length ?? 0) > 0 ||
      byId.status ||
      byId.signatureIntent)
  ) {
    return { ...byId, fileId: byId.fileId || fileId };
  }

  const fallback = params.fallback;
  const fallbackFileId = String(fallback?.fileId || '').trim();
  if (
    fallback &&
    (fallback.orionDocumentId || (fallback.signers?.length ?? 0) > 0 || fallback.status) &&
    (!fallbackFileId ||
      fallbackFileId === fileId ||
      fallbackFileId === ORION_LEGACY_FILE_ID)
  ) {
    return { ...fallback, fileId: fallback.fileId || fileId };
  }

  const entries = Object.entries(docs);
  if (entries.length === 0) return byId ? { ...byId, fileId } : {};

  // Solo legacy sin clave real: adoptar por nombre o por ser el único legacy
  const legacy = docs[ORION_LEGACY_FILE_ID];
  if (legacy && (legacy.orionDocumentId || (legacy.signers?.length ?? 0) > 0 || legacy.status)) {
    const name = String(params.fileName || '')
      .trim()
      .toLowerCase();
    const legacyName = String(legacy.fileName || '')
      .trim()
      .toLowerCase();
    if (!name || !legacyName || name === legacyName || entries.length === 1) {
      return { ...legacy, fileId: fileId || ORION_LEGACY_FILE_ID };
    }
  }

  return byId ? { ...byId, fileId } : {};
}

export function setOrionDocumentInBag(
  bag: OrionSignatureBagBag,
  fileId: string,
  state: OrionSignatureState
): OrionSignatureBagBag {
  const key = String(fileId || '').trim();
  if (!key) return bag;
  return {
    documents: {
      ...bag.documents,
      [key]: {
        ...stripBagMeta(state),
        fileId: key,
        updatedAt: new Date().toISOString(),
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

function isCompletedSignerStatus(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return ['FIRMADO', 'SIGNED', 'COMPLETED', 'RECHAZADO', 'REJECTED'].includes(value);
}

/** No degradar un firmante FIRMADO a PENDIENTE si Orion/webhook llega atrasado.
 * Merge por orden (slot): el mismo email puede firmar varias veces en el documento.
 */
export function mergeOrionSigners(
  current?: OrionSignatureState['signers'],
  patch?: OrionSignatureState['signers']
): OrionSignatureState['signers'] {
  if (patch == null) return current;
  const currentList = Array.isArray(current) ? current : [];
  const byOrder = new Map<number, (typeof currentList)[number]>();
  currentList.forEach((signer, index) => {
    const order = Number(signer.order);
    const key = Number.isFinite(order) && order > 0 ? order : index + 1;
    byOrder.set(key, signer);
  });

  const merged = patch.map((signer, index) => {
    const order = Number(signer.order);
    const key = Number.isFinite(order) && order > 0 ? order : index + 1;
    const prev = byOrder.get(key);
    if (prev && isCompletedSignerStatus(prev.status) && !isCompletedSignerStatus(signer.status)) {
      return {
        ...signer,
        order: key,
        status: prev.status,
        signedAt: prev.signedAt ?? signer.signedAt,
      };
    }
    return { ...signer, order: Number.isFinite(order) && order > 0 ? order : key };
  });

  const patchOrders = new Set(
    merged.map((s, i) => {
      const order = Number(s.order);
      return Number.isFinite(order) && order > 0 ? order : i + 1;
    })
  );
  for (const [order, signer] of byOrder) {
    if (!patchOrders.has(order)) {
      merged.push({ ...signer, order });
    }
  }

  return merged.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function mergeOrionVersions(
  current?: OrionSignatureState['versions'],
  patch?: OrionSignatureState['versions']
): OrionSignatureState['versions'] {
  if (patch == null) return current;
  if (current == null || current.length === 0) return patch;
  const byId = new Map<string, NonNullable<OrionSignatureState['versions']>[number]>();
  for (const v of current) byId.set(v.id, v);
  for (const v of patch) byId.set(v.id, v);
  return [...byId.values()];
}

export function mergeOrionSignatureState(
  current: OrionSignatureState,
  patch: Partial<OrionSignatureState>
): OrionSignatureState {
  return {
    ...current,
    ...patch,
    signers: mergeOrionSigners(current.signers, patch.signers),
    signatureFields: patch.signatureFields ?? current.signatureFields,
    versions: mergeOrionVersions(current.versions, patch.versions),
    // No degradar URL firmada si el patch no trae una nueva
    signedFileUrl:
      patch.signedFileUrl !== undefined && patch.signedFileUrl !== null && patch.signedFileUrl !== ''
        ? patch.signedFileUrl
        : (current.signedFileUrl ?? patch.signedFileUrl ?? null),
    originalFileUrl: patch.originalFileUrl ?? current.originalFileUrl,
    updatedAt: new Date().toISOString(),
  };
}

/** Mueve documents[_legacy] a un fileId real la primera vez que se gestiona ese PDF. */
export function adoptLegacyOrionDocument(
  bag: OrionSignatureBagBag,
  fileId: string,
  fileName?: string | null
): OrionSignatureBagBag {
  const key = String(fileId || '').trim();
  if (!key || key === ORION_LEGACY_FILE_ID) return bag;
  if (bag.documents[key]) return bag;

  const legacy = bag.documents[ORION_LEGACY_FILE_ID];
  if (!legacy) return bag;

  const { [ORION_LEGACY_FILE_ID]: _removed, ...rest } = bag.documents;
  return {
    documents: {
      ...rest,
      [key]: {
        ...legacy,
        fileId: key,
        fileName: fileName ?? legacy.fileName ?? null,
        updatedAt: new Date().toISOString(),
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function findOrionDocumentByOrionId(
  bag: OrionSignatureBagBag,
  orionDocumentId: string | null | undefined
): { fileId: string; state: OrionSignatureState } | null {
  const id = String(orionDocumentId || '').trim();
  if (!id) return null;
  for (const [fileId, state] of Object.entries(bag.documents)) {
    if (String(state.orionDocumentId || '') === id) {
      return { fileId, state };
    }
  }
  return null;
}

export function findOrionDocumentByExternalRef(
  bag: OrionSignatureBagBag,
  externalRef: string | null | undefined
): { fileId: string; state: OrionSignatureState } | null {
  const ref = String(externalRef || '').trim();
  if (!ref) return null;
  for (const [fileId, state] of Object.entries(bag.documents)) {
    if (String(state.externalRef || '') === ref) {
      return { fileId, state };
    }
  }
  return null;
}

export function allOrionDocumentsTerminal(
  bag: OrionSignatureBagBag,
  status: 'FIRMADO' | 'RECHAZADO'
): boolean {
  const entries = Object.values(bag.documents);
  if (entries.length === 0) return false;
  return entries.every((doc) => String(doc.status || '').toUpperCase() === status);
}

export function anyOrionDocumentRejected(bag: OrionSignatureBagBag): boolean {
  return Object.values(bag.documents).some(
    (doc) => String(doc.status || '').toUpperCase() === 'RECHAZADO'
  );
}

export function allOrionDocumentsFullySigned(bag: OrionSignatureBagBag): boolean {
  const entries = Object.values(bag.documents);
  if (entries.length === 0) return false;
  return entries.every((doc) => String(doc.status || '').toUpperCase() === 'FIRMADO');
}

/** Lista signedFileUrl de todos los docs firmados (para chips de chat). */
export function listSignedOrionDocuments(
  bag: OrionSignatureBagBag
): Array<{ fileId: string; fileName: string; url: string }> {
  const out: Array<{ fileId: string; fileName: string; url: string }> = [];
  for (const [fileId, state] of Object.entries(bag.documents)) {
    if (state.signedFileUrl) {
      out.push({
        fileId,
        fileName: state.fileName || 'Documento firmado.pdf',
        url: state.signedFileUrl,
      });
    }
  }
  return out;
}
