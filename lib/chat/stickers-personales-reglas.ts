/**
 * «MIS STICKERS» — reglas PURAS (2026-10-21). Sin prisma: las usan las rutas,
 * las pruebas y el navegador (para avisar antes de subir).
 *
 * Pedido de Nicolás (2026-10-20): cada persona carga sus propios stickers, en
 * WebP ESTÁTICO o ANIMADO, y puede proponerlos a su empresa. Solo WebP: es el
 * formato de los stickers de WhatsApp, pesa poco, admite transparencia y
 * animación, y una imagen WebP no puede ejecutar nada (a diferencia de un SVG).
 */

/** Tope de la base (CHECK chat_sticker_size_ck): 512 KB. */
export const MAX_BYTES_STICKER = 512 * 1024;
/** Lado mínimo y máximo, en píxeles (WhatsApp y Telegram usan 512 × 512). */
export const MIN_LADO_STICKER = 64;
export const MAX_LADO_STICKER = 1024;
/** Cuántos stickers propios puede tener una persona a la vez. */
export const MAX_MIS_STICKERS = 60;
/** Largo del nombre (columna label NVARCHAR(80)). */
export const MAX_NOMBRE_STICKER = 60;

export type EstadoPropuesta = 'propuesto' | 'aprobado' | 'rechazado';

export interface InfoWebp {
  ancho: number;
  alto: number;
  animado: boolean;
}

/**
 * Lee la cabecera de un WebP y devuelve su tamaño y si es animado, o null si
 * NO es un WebP válido. No se confía en la extensión ni en el tipo que mande
 * el navegador: se miran los bytes.
 *
 * Formato (https://developers.google.com/speed/webp/docs/riff_container):
 *   'RIFF' <tamaño LE32> 'WEBP' y luego el primer fragmento:
 *   - 'VP8X' (extendido): banderas en el byte 20 (0x02 = animación) y el
 *     lienzo en 24..29 (24 bits cada lado, menos uno);
 *   - 'VP8 ' (con pérdida, estático): firma 9D 01 2A en 23..25 y lados de 14
 *     bits en 26..29;
 *   - 'VP8L' (sin pérdida, estático): firma 0x2F en 20 y lados de 14 bits.
 */
export function leerWebp(buf: Uint8Array): InfoWebp | null {
  if (buf.length < 30) return null;
  const txt = (i: number, n: number) => String.fromCharCode(...buf.subarray(i, i + n));
  if (txt(0, 4) !== 'RIFF' || txt(8, 4) !== 'WEBP') return null;
  const tamRiff = buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24);
  // El tamaño declarado debe cuadrar con el archivo (se admite un byte de relleno).
  if (tamRiff + 8 !== buf.length && tamRiff + 9 !== buf.length) return null;
  const fragmento = txt(12, 4);
  if (fragmento === 'VP8X') {
    const banderas = buf[20];
    const ancho = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const alto = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { ancho, alto, animado: (banderas & 0x02) !== 0 };
  }
  if (fragmento === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const ancho = (buf[26] | (buf[27] << 8)) & 0x3fff;
    const alto = (buf[28] | (buf[29] << 8)) & 0x3fff;
    return { ancho, alto, animado: false };
  }
  if (fragmento === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    const ancho = 1 + (b & 0x3fff);
    const alto = 1 + ((b >>> 14) & 0x3fff);
    return { ancho, alto, animado: false };
  }
  return null;
}

/** Error legible del archivo, o null si sirve como sticker. */
export function errorArchivoSticker(buf: Uint8Array): string | null {
  if (buf.length === 0) return 'El archivo está vacío.';
  if (buf.length > MAX_BYTES_STICKER) return 'El sticker pesa más de 512 KB.';
  const info = leerWebp(buf);
  if (!info) return 'El sticker debe ser una imagen WebP (estática o animada).';
  if (info.ancho < MIN_LADO_STICKER || info.alto < MIN_LADO_STICKER) {
    return `El sticker es muy pequeño: mínimo ${MIN_LADO_STICKER} × ${MIN_LADO_STICKER} píxeles.`;
  }
  if (info.ancho > MAX_LADO_STICKER || info.alto > MAX_LADO_STICKER) {
    return `El sticker es muy grande: máximo ${MAX_LADO_STICKER} × ${MAX_LADO_STICKER} píxeles.`;
  }
  return null;
}

/**
 * Nombre limpio del sticker (es el texto descriptivo del mensaje,
 * «[Sticker: …]», que leen los agentes), o null si no sirve.
 */
export function limpiarNombreSticker(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null;
  const t = crudo
    .replace(/[[\]*_`<>#|\\~]/g, ' ')
    // Controles y saltos de línea fuera.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  return t.length > MAX_NOMBRE_STICKER ? t.slice(0, MAX_NOMBRE_STICKER).trimEnd() : t;
}

/** Texto del estado de una propuesta para la interfaz. */
export function textoEstadoPropuesta(estado: EstadoPropuesta | null | undefined): string | null {
  if (estado === 'propuesto') return 'Propuesto a la empresa';
  if (estado === 'aprobado') return 'Aprobado por la empresa';
  if (estado === 'rechazado') return 'No aprobado';
  return null;
}
