/**
 * Dashboard TI - photo of an asset (table asset_photo, one per asset).
 * The browser shrinks the picture before sending it, so the stored image is
 * small; the server still checks type and size.
 */

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIME_TYPES)[number];

/** Max stored size (bytes) after the browser resize. */
export const PHOTO_MAX_BYTES = 1_500_000;
/** Longest side of the picture after the browser resize (px). */
export const PHOTO_MAX_SIDE = 900;

export type PhotoParse =
  | { ok: true; mime: PhotoMime; bytes: Buffer }
  | { ok: false; error: string };

/** Magic numbers, so a renamed file cannot pass as an image. */
function sniff(bytes: Buffer): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';
  return null;
}

/** Parses «data:image/jpeg;base64,...» from PUT /api/it-dashboard/assets/[id]/photo. */
export function parsePhotoDataUrl(value: unknown): PhotoParse {
  if (typeof value !== 'string') return { ok: false, error: 'No se recibió la imagen.' };
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(value.trim());
  if (!match) return { ok: false, error: 'Formato no válido. Use JPG, PNG o WEBP.' };
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length === 0) return { ok: false, error: 'La imagen está vacía.' };
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, error: 'La imagen es muy pesada (máximo 1,5 MB).' };
  const real = sniff(bytes);
  if (!real) return { ok: false, error: 'El archivo no es una imagen JPG, PNG o WEBP.' };
  return { ok: true, mime: real, bytes };
}
