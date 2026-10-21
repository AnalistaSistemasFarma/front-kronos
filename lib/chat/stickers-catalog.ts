/**
 * PAQUETE PROPIO de stickers de GSS (2026-10-20).
 *
 * Dibujo PROPIO, hecho para SynerLink con la paleta de gss-design (azul
 * #1a3c6e, verde #1f7a4d, ocre #b07300, rojo #b3261e y los acentos de las
 * empresas). No viene de ningún paquete de terceros: los packs comerciales y
 * los de licencia dudosa quedaron descartados a propósito (ver la memoria del
 * proyecto de avatares: DrawKit prohíbe ese uso). Los archivos SVG viven en
 * public/chat/stickers y se sirven como imagen (<img>), donde un SVG no puede
 * ejecutar nada.
 *
 * Lo comparten el navegador (selector) y el servidor (que valida el código
 * antes de guardar el mensaje). ⚠️ Solo AGREGAR: los mensajes viejos guardan
 * el código, así que renombrar o quitar uno deja esos mensajes sin imagen.
 */

export interface StickerGss {
  /** Código estable; es el nombre del archivo en public/chat/stickers. */
  code: string;
  /** Lo que dice el sticker y el texto descriptivo del mensaje. */
  label: string;
  /** Palabras de búsqueda en español. */
  keywords: string;
}

export const STICKERS_GSS: readonly StickerGss[] = [
  { code: 'pulgar-arriba', label: '¡De acuerdo!', keywords: 'pulgar arriba ok de acuerdo me gusta' },
  { code: 'listo', label: '¡Listo!', keywords: 'listo hecho terminado check' },
  { code: 'gracias', label: '¡Gracias!', keywords: 'gracias agradecido corazón' },
  { code: 'hola', label: '¡Hola!', keywords: 'hola saludo buenos días' },
  { code: 'buen-trabajo', label: '¡Buen trabajo!', keywords: 'buen trabajo medalla felicitaciones' },
  { code: 'bravo', label: '¡Bravo!', keywords: 'bravo trofeo ganador excelente' },
  { code: 'lo-reviso', label: 'Lo reviso', keywords: 'reviso revisar lupa documento' },
  { code: 'un-momento', label: 'Un momento', keywords: 'momento espera reloj de arena' },
  { code: 'en-reunion', label: 'En reunión', keywords: 'reunión ocupado calendario' },
  { code: 'idea', label: '¡Idea!', keywords: 'idea bombillo propuesta' },
  { code: 'a-produccion', label: '¡A producción!', keywords: 'producción cohete lanzamiento pase' },
  { code: 'un-tinto', label: '¿Un tinto?', keywords: 'tinto café pausa descanso' },
  { code: 'feliz-cumpleanos', label: '¡Feliz cumpleaños!', keywords: 'cumpleaños torta celebración' },
  { code: 'con-carino', label: 'Con cariño', keywords: 'cariño corazones aprecio' },
];

const POR_CODIGO = new Map(STICKERS_GSS.map((s) => [s.code, s]));

/** El sticker propio con ese código, o null si no existe. */
export function stickerGss(code: unknown): StickerGss | null {
  return typeof code === 'string' ? (POR_CODIGO.get(code) ?? null) : null;
}

/** Ruta pública de la imagen de un sticker propio. */
export function urlStickerGss(code: string): string {
  return `/chat/stickers/${encodeURIComponent(code)}.svg`;
}
