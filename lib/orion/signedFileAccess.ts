/**
 * Allowlist de URLs que el servidor puede fetchar (PDF Orion / OneDrive).
 * Endurecido frente a SSRF (CWE-918): sin suffix suelto, sin “trusted bag” ciego.
 */

import { getOrionConfig } from './config';
import { resolveOrionPdfUrl } from './documentVersions';
import { isSignerCompleted } from './signerStatus';
import type { OrionSignatureState } from './types';

/** Hosts/subdominios permitidos para adjuntos Graph / OneDrive / SharePoint. */
const ALLOWED_STORAGE_SUFFIXES = [
  'sharepoint.com',
  'sharepointonline.com',
  '1drv.ms',
  'onedrive.live.com',
  'graph.microsoft.com',
  'blob.core.windows.net',
] as const;

const PRIVATE_OR_METADATA_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
]);

/** True si `host` es exactamente `suffix` o un subdominio de este (no evilmicrosoft.com). */
export function isHostOrSubdomain(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  const s = suffix.toLowerCase();
  return h === s || h.endsWith(`.${s}`);
}

function isPrivateOrMetadataHost(host: string): boolean {
  const h = host.toLowerCase();
  if (PRIVATE_OR_METADATA_HOSTS.has(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h.startsWith('::ffff:127.') || h.startsWith('::ffff:169.254.')) return true;
  return false;
}

function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** URL del proxy SynerLink de PDF Orion (no es el adjunto OneDrive). */
export function isOrionSignedFileProxyUrl(url: string | null | undefined): boolean {
  return /\/api\/integrations\/orion\/signed-file/i.test(String(url || '').trim());
}

/** URLs de PDF firmado en Orion exigen Bearer; no abrir en el navegador sin proxy. */
export function isOrionProtectedFileUrl(url: string | null | undefined): boolean {
  const value = String(url || '').trim();
  if (!value) return false;

  const { apiBaseUrl } = getOrionConfig();
  if (
    apiBaseUrl &&
    sameOrigin(value, apiBaseUrl) &&
    /\/api\/integrations\/synerlink\/documents\/[^/]+\/signed-file/i.test(value)
  ) {
    return true;
  }

  return /\/api\/integrations\/synerlink\/documents\/[^/]+\/signed-file/i.test(value);
}

/**
 * ¿Se puede pedir al servidor que descargue esta URL?
 * Evita SSRF: origen de Orion configurado, o Graph/OneDrive/SharePoint.
 * No usa suffix suelto (evilmicrosoft.com no entra) ni URLs relativas.
 */
export function isAllowedServerPdfFetchUrl(url: string | null | undefined): boolean {
  const value = String(url || '').trim();
  if (!value) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const { apiBaseUrl } = getOrionConfig();
  if (
    apiBaseUrl &&
    sameOrigin(value, apiBaseUrl) &&
    /\/api\/integrations\/synerlink\/documents\/[^/]+\/signed-file/i.test(value)
  ) {
    return true;
  }

  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrMetadataHost(host)) return false;

  if (
    isHostOrSubdomain(host, 'login.microsoftonline.com') ||
    isHostOrSubdomain(host, 'graph.microsoft.com')
  ) {
    return true;
  }

  return ALLOWED_STORAGE_SUFFIXES.some((suffix) => isHostOrSubdomain(host, suffix));
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

/** True si ya hay PDF acumulado en Orion (no el original SynerLink). */
export function orionDocumentHasSignedCopy(
  state: OrionSignatureState | undefined | null
): boolean {
  if (!state) return false;
  const hasCompletedSigner = (state.signers ?? []).some((s) =>
    isSignerCompleted(s.status)
  );
  const hasSignedVersion = (state.versions ?? []).some(
    (v) => v.kind === 'partial' || v.kind === 'final'
  );
  const status = String(state.status || '').toUpperCase();
  return (
    hasCompletedSigner ||
    hasSignedVersion ||
    status === 'FIRMADO' ||
    status === 'SIGNED' ||
    status === 'COMPLETED'
  );
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
  if (ctx && state?.orionDocumentId) {
    if (orionDocumentHasSignedCopy(state)) {
      return buildOrionSignedFileProxyUrl({
        requestId: ctx.requestId,
        fileId: ctx.fileId,
      });
    }
    return null;
  }

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
  });
}

export function resolveOrionVersionAccessUrl(params: {
  requestId: number;
  fileId: string;
  versionId: string;
  url: string;
  kind: string;
}): string {
  if (params.kind === 'original' && !isOrionProtectedFileUrl(params.url)) {
    return params.url;
  }
  return buildOrionSignedFileProxyUrl({
    requestId: params.requestId,
    fileId: params.fileId,
    versionId: params.versionId,
    download: true,
  });
}
