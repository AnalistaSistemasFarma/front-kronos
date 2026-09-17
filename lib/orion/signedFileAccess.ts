import { getOrionConfig } from './config';
import { resolveOrionPdfUrl } from './documentVersions';
import { isSignerCompleted } from './signerStatus';
import type { OrionSignatureState } from './types';

/** URL del proxy SynerLink de PDF Orion (no es el adjunto OneDrive). */
export function isOrionSignedFileProxyUrl(url: string | null | undefined): boolean {
  return /\/api\/integrations\/orion\/signed-file/i.test(String(url || '').trim());
}

/** host === domain o subdominio (evita evilmicrosoft.com). */
export function isHostOrSubdomain(host: string, domain: string): boolean {
  const h = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  const d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function sameOrigin(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

/** URLs de PDF firmado en Orion exigen Bearer; no abrir en el navegador sin proxy. */
export function isOrionProtectedFileUrl(url: string | null | undefined): boolean {
  const value = String(url || '').trim();
  if (!value) return false;

  const synerlinkSignedFile =
    /\/api\/integrations\/synerlink\/documents\/[^/]+\/signed-file/i.test(value);

  if (/^https?:\/\//i.test(value)) {
    const { apiBaseUrl } = getOrionConfig();
    if (apiBaseUrl) {
      return Boolean(sameOrigin(value, apiBaseUrl) && synerlinkSignedFile);
    }
    return synerlinkSignedFile;
  }

  return synerlinkSignedFile;
}

const PRIVATE_OR_METADATA_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
]);

const PDF_FETCH_ALLOWLIST_DOMAINS = [
  'sharepoint.com',
  'sharepointonline.com',
  '1drv.ms',
  'onedrive.live.com',
  'microsoft.com',
  'microsoftonline.com',
  'graph.microsoft.com',
  'blob.core.windows.net',
] as const;

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
  if (PRIVATE_OR_METADATA_HOSTS.has(host)) return false;
  if (
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return false;
  }

  return PDF_FETCH_ALLOWLIST_DOMAINS.some((domain) => isHostOrSubdomain(host, domain));
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
 *
 * Vista "vigente": sin versionId, para que Orion regenere el PDF con todas las firmas.
 * (Si se fija la 1.ª versión parcial por URL duplicada, se puede ver solo la 1.ª firma.)
 */
export function resolveOrionPdfAccessUrl(
  state: OrionSignatureState | undefined | null,
  originalUrl: string | null | undefined,
  ctx: { requestId: number; fileId: string } | null
): string | null {
  // Con firmas acumuladas: siempre proxy Orion (PDF vigente con todas las firmas).
  // Sin firmas: null → el caller usa OneDrive SynerLink (no /orion/signed-file).
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
