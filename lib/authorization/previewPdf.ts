/**
 * PDF de la vista previa en «Ver detalle» de Autorizaciones (2026-11-13).
 * Una sola función arma la URL para que el detalle y la precarga al pasar el mouse pidan
 * exactamente lo mismo: así el servidor ya tiene el PDF armado en memoria (signed-file guarda
 * el PDF por estado de firma) cuando se abre el detalle.
 */
import {
  isOrionReviewResolution,
  parseOrionFileIdFromAuthResolution,
  parseOrionReviewFileId,
} from '../orion/signerAuthMarkers';

/**
 * - Validación de documento: el PDF tal cual está en la solicitud.
 * - Firma: la última versión con las firmas hechas (o el original si aún no hay firmas).
 *   watermark/annotations=0: vista previa rápida (sin sellos pdf-lib).
 */
export function authorizationPreviewPdfUrl(params: {
  requestId: number | null | undefined;
  resolution: string | null | undefined;
  isFirma: boolean;
}): string | null {
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) return null;
  if (isOrionReviewResolution(params.resolution)) {
    const fileId = parseOrionReviewFileId(params.resolution);
    return fileId
      ? `/api/requests-general/attachment-file?requestId=${requestId}&fileId=${encodeURIComponent(fileId)}`
      : null;
  }
  if (!params.isFirma) return null;
  const fileId = parseOrionFileIdFromAuthResolution(params.resolution);
  return fileId
    ? `/api/integrations/orion/signed-file?requestId=${requestId}&fileId=${encodeURIComponent(fileId)}&watermark=0&annotations=0`
    : null;
}

const WARM_TTL_MS = 60_000;
const warmedAt = new Map<string, number>();

/**
 * Pide el PDF y corta la descarga apenas llegan los encabezados: el servidor ya lo armó y lo
 * dejó en memoria, sin bajar el archivo dos veces. Como mucho una vez por minuto por URL.
 */
export function warmAuthorizationPreviewPdf(url: string | null): void {
  if (!url || typeof window === 'undefined') return;
  const last = warmedAt.get(url) ?? 0;
  if (Date.now() - last < WARM_TTL_MS) return;
  warmedAt.set(url, Date.now());
  const controller = new AbortController();
  fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal })
    .then(() => controller.abort())
    .catch(() => {
      /* solo es una precarga */
    });
}
