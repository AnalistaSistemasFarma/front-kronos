/**
 * Tipo REAL de una imagen por sus primeros bytes (firma de archivo), sin
 * confiar en la extensión ni en el MIME que declare el navegador. Puro y sin
 * dependencias de Node: lo usan el navegador (al elegir el archivo) y el
 * servidor (lib/firma-gss/png.ts).
 */
export const PNG_FIRMA_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Tamaño máximo del ARCHIVO original que se acepta en el navegador (foto de la firma). */
export const FIRMA_ARCHIVO_MAX_BYTES = 5 * 1024 * 1024;

export function tipoPorBytes(bytes: ArrayLike<number>): 'png' | 'jpeg' | null {
  if (bytes.length >= 8 && PNG_FIRMA_BYTES.every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}
