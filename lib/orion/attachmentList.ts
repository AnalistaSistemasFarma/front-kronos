import type { OrionSignatureState } from './types';
import {
  isOrionProtectedFileUrl,
  isOrionSignedFileProxyUrl,
  orionDocumentHasSignedCopy,
} from './signedFileAccess';

export type AttachmentListItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  '@microsoft.graph.downloadUrl'?: string;
  /** true si no está en OneDrive y se reconstruyó desde el bag Orion */
  fromOrionBag?: boolean;
};

function hasSignedProgress(doc: OrionSignatureState): boolean {
  return orionDocumentHasSignedCopy(doc);
}

/**
 * Stem lógico del adjunto: quita .pdf y sufijos de versión (-firmado / -original / -parcial).
 * Sirve para colapsar la copia descargada con el documento Orion canónico.
 */
/** Sufijo de copia de versión al final del nombre (sin .pdf). */
const VERSION_COPY_SUFFIX = /-(?:firmado|original|parcial)$/i;
/** Contador de copia de Windows/OneDrive: " (2)". */
const COPY_COUNTER = /\s*\(\d+\)$/;

/**
 * Quita "-firmado" / "-original" / "-parcial" (con o sin " (n)" de copia). Sin ese sufijo el
 * nombre queda igual, incluido un " (n)" propio. En dos pasos para no anidar repeticiones.
 */
function stripVersionCopySuffix(stem: string): string {
  const withoutCounter = stem.replace(COPY_COUNTER, '');
  return VERSION_COPY_SUFFIX.test(withoutCounter) ? withoutCounter.replace(VERSION_COPY_SUFFIX, '') : stem;
}

export function normalizeAttachmentStem(name?: string | null): string {
  const stem = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '');
  return stripVersionCopySuffix(stem).replace(/\s+/g, ' ').trim();
}

/** Copia de versión de un PDF: `X-firmado.pdf`, `X-original (2).pdf`… */
export function isVersionCopyFileName(name?: string | null): boolean {
  const value = String(name || '').trim();
  if (!/\.pdf$/i.test(value)) return false;
  return VERSION_COPY_SUFFIX.test(value.replace(/\.pdf$/i, '').replace(COPY_COUNTER, ''));
}

function pickGhostAttachmentUrl(doc: OrionSignatureState): string | undefined {
  const original = String(doc.originalFileUrl || '').trim();
  const originalVersion = String(
    doc.versions?.find((v) => v.kind === 'original')?.url || ''
  ).trim();
  const signed = String(doc.signedFileUrl || '').trim();

  // Borrador / sin firmas: NUNCA signedFileUrl (Orion responde 409).
  if (!hasSignedProgress(doc)) {
    for (const candidate of [original, originalVersion]) {
      if (!candidate) continue;
      if (isOrionProtectedFileUrl(candidate)) continue;
      if (isOrionSignedFileProxyUrl(candidate)) continue;
      return candidate;
    }
    return undefined;
  }

  for (const candidate of [signed, original, originalVersion]) {
    if (candidate) return candidate;
  }
  return undefined;
}

function orionDocOwnsAttachmentRow(doc: OrionSignatureState): boolean {
  return Boolean(doc.orionDocumentId) || hasSignedProgress(doc);
}

/**
 * La tabla de adjuntos lista OneDrive; si la carpeta/archivo ya no existe (404)
 * pero el bag Orion aún tiene el documento, hay que mostrarlo igual.
 *
 * Tras firma completa SynerLink libera el original OneDrive: el bag reaparece
 * como ghost. Si además quedó un `*-firmado.pdf` (otra descarga/subida) con
 * otro fileId, se oculta para no duplicar el mismo documento lógico.
 */
export function mergeOneDriveWithOrionDocuments(
  folderContents: AttachmentListItem[],
  documents: Record<string, OrionSignatureState | undefined> | null | undefined
): AttachmentListItem[] {
  const docs = documents || {};

  /** stem → fileId canónico Orion que debe mandar en la tabla */
  const orionByStem = new Map<string, { fileId: string; doc: OrionSignatureState }>();
  for (const [key, doc] of Object.entries(docs)) {
    if (!doc || !orionDocOwnsAttachmentRow(doc)) continue;
    const fileId = String(doc.fileId || key || '').trim();
    if (!fileId) continue;
    const stem = normalizeAttachmentStem(doc.fileName || '');
    if (!stem) continue;
    const prev = orionByStem.get(stem);
    if (!prev || (doc.orionDocumentId && !prev.doc.orionDocumentId)) {
      orionByStem.set(stem, { fileId, doc });
    }
  }

  const byId = new Map<string, AttachmentListItem>();
  for (const file of folderContents) {
    const id = String(file?.id || '').trim();
    if (!id) continue;

    const stem = normalizeAttachmentStem(file.name);
    const owned = stem ? orionByStem.get(stem) : undefined;
    // Copia de versión en OneDrive distinta del fileId Orion → no listar (duplicado)
    if (
      owned &&
      owned.fileId !== id &&
      isVersionCopyFileName(file.name)
    ) {
      continue;
    }

    byId.set(id, file);
  }

  for (const [key, doc] of Object.entries(docs)) {
    if (!doc) continue;
    const id = String(doc.fileId || key || '').trim();
    if (!id || byId.has(id)) continue;

    const name = String(doc.fileName || '').trim() || `documento-${id}.pdf`;
    const url = pickGhostAttachmentUrl(doc);

    byId.set(id, {
      id,
      name,
      webUrl: url,
      ...(url ? { '@microsoft.graph.downloadUrl': url } : {}),
      fromOrionBag: true,
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'es', {
      sensitivity: 'base',
      numeric: true,
    })
  );
}
