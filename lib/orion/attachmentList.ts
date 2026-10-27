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

/**
 * La tabla de adjuntos lista OneDrive; si la carpeta/archivo ya no existe (404)
 * pero el bag Orion aún tiene el documento, hay que mostrarlo igual.
 *
 * Tras firma completa SynerLink libera el original OneDrive: el bag reaparece
 * como ghost.
 */
export function mergeOneDriveWithOrionDocuments(
  folderContents: AttachmentListItem[],
  documents: Record<string, OrionSignatureState | undefined> | null | undefined
): AttachmentListItem[] {
  const docs = documents || {};

  // Todo archivo que esté en OneDrive se lista, aunque se llame como una copia de versión
  // (`X-parcial (3).pdf`): si está en la carpeta es porque alguien lo subió a propósito.
  const byId = new Map<string, AttachmentListItem>();
  for (const file of folderContents) {
    const id = String(file?.id || '').trim();
    if (!id) continue;
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
