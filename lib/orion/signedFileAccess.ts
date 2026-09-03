import { getOrionConfig } from './config';
import type { OrionSignatureState } from './types';
import { resolveOrionPdfUrl } from './documentVersions';

/** URLs de PDF firmado en Orion exigen Bearer; no abrir en el navegador sin proxy. */
export function isOrionProtectedFileUrl(url: string | null | undefined): boolean {
  const value = String(url || '').trim();
  if (!value) return false;

  const { apiBaseUrl } = getOrionConfig();
  if (apiBaseUrl && value.startsWith(apiBaseUrl)) return true;

  return /\/api\/integrations\/synerlink\/documents\/[^/]+\/signed-file/i.test(value);
}

export function buildOrionSignedFileProxyUrl(params: {
  requestId: number;
  fileId: string;
  versionId?: string | null;
  download?: boolean;
}): string {
  const qs = new URLSearchParams({
    requestId: String(params.requestId),
    fileId: params.fileId,
  });
  if (params.versionId) qs.set('versionId', params.versionId);
  if (params.download) qs.set('download', '1');
  return `/api/integrations/orion/signed-file?${qs.toString()}`;
}

/**
 * URL para ver/descargar en el cliente:
 * - OneDrive original → directo
 * - PDF firmado Orion → proxy SynerLink (Bearer server-side)
 */
export function resolveOrionPdfAccessUrl(
  state: OrionSignatureState | undefined | null,
  originalUrl: string | null | undefined,
  ctx: { requestId: number; fileId: string } | null
): string | null {
  const raw = resolveOrionPdfUrl(state, originalUrl);
  if (!raw) return null;
  if (!ctx) return raw;

  const original = String(originalUrl || state?.originalFileUrl || '').trim();
  const matchedVersion = (state?.versions ?? []).find((v) => v.url === raw);

  const usesSignedCopy =
    isOrionProtectedFileUrl(raw) ||
    Boolean(matchedVersion && matchedVersion.kind !== 'original') ||
    Boolean(state?.signedFileUrl && raw === state.signedFileUrl) ||
    Boolean(original && raw !== original);

  if (!usesSignedCopy) return raw;

  return buildOrionSignedFileProxyUrl({
    requestId: ctx.requestId,
    fileId: ctx.fileId,
    versionId: matchedVersion?.id,
  });
}

export function resolveOrionVersionAccessUrl(params: {
  requestId: number;
  fileId: string;
  versionId: string;
  url: string;
  kind: string;
}): string {
  // Original público (p. ej. OneDrive) → enlace directo.
  if (params.kind === 'original' && !isOrionProtectedFileUrl(params.url)) {
    return params.url;
  }
  // Parcial/final (y original en Orion) → proxy SynerLink con Bearer server-side.
  return buildOrionSignedFileProxyUrl({
    requestId: params.requestId,
    fileId: params.fileId,
    versionId: params.versionId,
    download: true,
  });
}
