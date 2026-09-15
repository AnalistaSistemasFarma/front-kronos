import {
  buildOrionSignedFileProxyUrl,
  orionDocumentHasSignedCopy,
} from '../orion/signedFileAccess';
import type { OrionSignatureState } from '../orion/types';

/** Proxy de adjunto en OneDrive SynerLink (SAPSEND/TEC/...). No es Orion. */
export function isSynerLinkAttachmentFileUrl(url: string | null | undefined): boolean {
  return /\/api\/requests-general\/attachment-file/i.test(String(url || '').trim());
}

export function buildSynerLinkAttachmentFileUrl(params: {
  requestId: number;
  fileId: string;
  download?: boolean;
  storagePath?: string;
  entityType?: string;
}): string {
  const qs = new URLSearchParams({
    requestId: String(params.requestId),
    fileId: params.fileId,
  });
  if (params.download) qs.set('download', '1');
  const storagePath = String(params.storagePath || '').trim();
  if (storagePath && storagePath !== 'SG') qs.set('storagePath', storagePath);
  const entityType = String(params.entityType || '').trim();
  if (entityType && entityType !== 'Request') qs.set('entityType', entityType);
  return `/api/requests-general/attachment-file?${qs.toString()}`;
}

/**
 * PDF de la solicitud:
 * - con firmas acumuladas → OneDrive Orion (`/api/integrations/orion/signed-file`)
 * - sin firmas → OneDrive SynerLink (`/api/requests-general/attachment-file`)
 */
export function resolveRequestPdfAccessUrl(params: {
  requestId: number;
  fileId: string;
  state?: OrionSignatureState | null;
  download?: boolean;
}): string {
  if (params.state?.orionDocumentId && orionDocumentHasSignedCopy(params.state)) {
    return buildOrionSignedFileProxyUrl({
      requestId: params.requestId,
      fileId: params.fileId,
      download: params.download,
    });
  }
  return buildSynerLinkAttachmentFileUrl({
    requestId: params.requestId,
    fileId: params.fileId,
    download: params.download,
  });
}
