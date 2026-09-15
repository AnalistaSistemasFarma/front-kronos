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
 */
export function mergeOneDriveWithOrionDocuments(
  folderContents: AttachmentListItem[],
  documents: Record<string, OrionSignatureState | undefined> | null | undefined
): AttachmentListItem[] {
  const byId = new Map<string, AttachmentListItem>();
  for (const file of folderContents) {
    const id = String(file?.id || '').trim();
    if (!id) continue;
    byId.set(id, file);
  }

  for (const [key, doc] of Object.entries(documents || {})) {
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

  return Array.from(byId.values());
}
