import { SgcError } from '../errors';

/**
 * FIRMA PROPIA (Sprint 13, requisito R13, decisión D10) — funciones PURAS.
 *
 * Registro con DOBLE CONTROL:
 *   1. Cada persona registra SU firma (dibujada o subida como imagen PNG o
 *      JPG, recortada a la tinta en el navegador y guardada como PNG). El
 *      servidor toma el correo de la SESIÓN: nadie registra la firma de otro.
 *   2. Queda «pendiente de validación» y NO firma documentos.
 *   3. Aseguramiento de Calidad la VALIDA (una vez; nunca la suya) o la
 *      revoca con motivo. Calidad ya no carga firmas de otros.
 *   4. Solo las firmas validadas se estampan. La firma electrónica sigue
 *      siendo la reautenticación + significado + motivo + sello de tiempo +
 *      huella; la imagen es su representación visible.
 * Va detrás de company_config.self_signature_enabled (APAGADA por defecto):
 * encenderla requiere el aval de la Dra. Adriana Cárdenas.
 */

export const SGC_MASTER_ORIGINS = ['calidad', 'propia'] as const;
export type SgcMasterOrigin = (typeof SGC_MASTER_ORIGINS)[number];
export const SGC_CAPTURE_METHODS = ['dibujada', 'imagen'] as const;
export type SgcCaptureMethod = (typeof SGC_CAPTURE_METHODS)[number];

export type SgcMasterStatus = 'validada' | 'pendiente' | 'rechazada' | 'revocada';
export const SGC_MASTER_STATUS_LABELS: Record<SgcMasterStatus, string> = {
  validada: 'Validada',
  pendiente: 'Pendiente de validación',
  rechazada: 'Rechazada',
  revocada: 'Revocada',
};

/** Estado visible: una pendiente que se revocó quedó «rechazada». */
export function masterStatus(r: { validation_status: string; revoked_at: Date | null }): SgcMasterStatus {
  if (r.revoked_at) return r.validation_status === 'pendiente' ? 'rechazada' : 'revocada';
  return r.validation_status === 'pendiente' ? 'pendiente' : 'validada';
}

export const SGC_SELF_SIGNATURE_DISABLED = 'La firma propia no está habilitada en esta empresa: encenderla requiere el aval de la Dra. Adriana Cárdenas. Mientras tanto, Aseguramiento de Calidad registra la firma en la inducción.';

export interface SgcOwnSignatureInput {
  imagePng: string;
  method: SgcCaptureMethod;
}

/**
 * Valida lo que llega para registrar la firma propia. Si el cuerpo trae un
 * correo distinto del de la sesión, se RECHAZA (403): nadie registra la firma
 * de otra persona (y el correo nunca se toma del cuerpo).
 */
export function normalizeOwnSignature(raw: unknown, sessionEmail: string): SgcOwnSignatureInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.email !== undefined && r.email !== null && String(r.email).trim().toLowerCase() !== sessionEmail.trim().toLowerCase()) {
    throw new SgcError('Solo puede registrar SU propia firma: el correo es el de su sesión.', 403);
  }
  if (!(SGC_CAPTURE_METHODS as readonly string[]).includes(String(r.method))) throw new SgcError('Indique si la firma es dibujada o una imagen subida.');
  if (typeof r.imagePng !== 'string' || !r.imagePng.trim()) throw new SgcError('Dibuje o suba la imagen de su firma.');
  return { imagePng: r.imagePng.trim(), method: r.method as SgcCaptureMethod };
}

/** Por qué una persona de Calidad NO puede validar esa firma (null si puede). */
export function validationDenial(row: { user_email: string; validation_status: string; revoked_at: Date | null; origin: string }, validator: string): string | null {
  if (row.revoked_at) return 'La firma está revocada o rechazada.';
  if (row.validation_status !== 'pendiente') return 'La firma ya está validada.';
  if (row.user_email.trim().toLowerCase() === validator.trim().toLowerCase()) return 'Nadie valida su propia firma: la valida otra persona de Aseguramiento de Calidad.';
  return null;
}

/**
 * Recorte a la TINTA de una imagen subida (se usa en el navegador sobre los
 * píxeles RGBA de un canvas): límites de los píxeles oscuros y visibles, con
 * un margen. null si la imagen no tiene trazo.
 */
export function inkBoundsRgba(data: ArrayLike<number>, width: number, height: number, opts: { luminance?: number; alpha?: number; pad?: number } = {}): { x: number; y: number; width: number; height: number } | null {
  const lum = opts.luminance ?? 170;
  const alpha = opts.alpha ?? 40;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < alpha) continue;
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] > lum) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const pad = opts.pad ?? 6;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  return { x: x0, y: y0, width: Math.min(width, maxX + pad + 1) - x0, height: Math.min(height, maxY + pad + 1) - y0 };
}

/** Fondo claro → transparente (la firma se estampa sobre el documento sin un recuadro blanco). Modifica `data`. */
export function clearLightBackground(data: { [i: number]: number; length: number }, luminance = 215): void {
  for (let i = 0; i < data.length; i += 4) {
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] > luminance) data[i + 3] = 0;
  }
}

/** Escala para que la firma quepa en máx. `max` píxeles de ancho (no agranda). */
export function fitScale(width: number, height: number, max = 600): number {
  return Math.min(1, max / Math.max(1, width), (max / 2) / Math.max(1, height));
}
