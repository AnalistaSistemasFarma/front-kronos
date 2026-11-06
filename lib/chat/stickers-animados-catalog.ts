/**
 * PAQUETE de stickers ANIMADOS del chat (2026-10-20).
 *
 * Pedido de Nicolás (2026-10-20, 12:16): «me lo imaginaba distinto, como
 * stickers animados en vez de algo estático… mira cómo lo hacen Telegram o
 * WhatsApp». Telegram usa Lottie (TGS) y WebM; WhatsApp, WebP animado.
 *
 * FORMATO: WebP animado, servido como <img> nativo. Sin dependencias nuevas
 * (Lottie exigiría lottie-web, ~250 KB, y ventana controlada en el pase a
 * producción). A 160 px y ~16 cuadros por segundo cada animado pesa entre 16
 * y 170 KB (unos 95 KB en promedio; el cuadro fijo, unos 5 KB). Solo se
 * descargan los que están en pantalla y el navegador los decodifica fuera del
 * hilo principal (ver components/chat/StickerAnimado.tsx). Lottie pesaría
 * menos por archivo (10–40 KB comprimido), pero se dibuja con JavaScript en el
 * hilo principal y suma la librería. Ver CREDITS.md.
 *
 * FUENTE Y LICENCIA: «Noto Emoji Animation» de Google
 * (https://googlefonts.github.io/noto-emoji-animation/). El sitio oficial
 * dice: «Animated Noto Emoji is licensed under CC BY 4.0»
 * (https://creativecommons.org/licenses/by/4.0/legalcode), verificado el
 * 2026-10-20. CC BY 4.0 permite uso comercial y modificación (aquí se
 * redujeron a 160 px y ~16 cuadros por segundo y se sacó un cuadro fijo para la vista sin movimiento)
 * con ATRIBUCIÓN: va en public/chat/stickers/noto/CREDITS.md, en CREDITS.md de
 * la raíz y al pie del panel de stickers.
 *
 * Archivos: public/chat/stickers/noto/<nombre>.webp (animado) y
 * <nombre>.poster.webp (primer cuadro, estático). El código que se guarda en
 * chat_message_media.external_id es `noto-<nombre>` con provider 'gss': entra
 * en el CHECK que ya existe (sticker + gss + external_id), así que no hace
 * falta SQL.
 *
 * ⚠️ Solo AGREGAR: los mensajes viejos guardan el código; renombrar o quitar
 * uno deja esos mensajes sin imagen (quedan con su texto descriptivo).
 */

export interface StickerAnimado {
  /** Código estable que se guarda en la base: `noto-<nombre>`. */
  code: string;
  /** Lo que dice el sticker y el texto descriptivo del mensaje. */
  label: string;
  /** Palabras de búsqueda en español. */
  keywords: string;
  /** Punto de código del emoji en Noto (para la atribución y para regenerar). */
  codepoint: string;
}

const PREFIJO = 'noto-';

const s = (nombre: string, codepoint: string, label: string, keywords: string): StickerAnimado => ({
  code: `${PREFIJO}${nombre}`,
  label,
  keywords,
  codepoint,
});

export const STICKERS_ANIMADOS: readonly StickerAnimado[] = [
  s('pulgar-arriba', '1f44d', '¡De acuerdo!', 'pulgar arriba ok de acuerdo me gusta'),
  s('listo', '2705', '¡Listo!', 'listo hecho terminado check chulo'),
  s('gracias', '1f64f', '¡Gracias!', 'gracias por favor manos'),
  s('aplausos', '1f44f', '¡Aplausos!', 'aplausos bravo felicitaciones'),
  s('celebracion', '1f389', '¡A celebrar!', 'celebración fiesta serpentina logro'),
  s('fiesta', '1f973', '¡Fiesta!', 'fiesta celebración cumpleaños gorro'),
  s('hola', '1f44b', '¡Hola!', 'hola saludo buenos días chao'),
  s('pensando', '1f914', 'Déjeme pensarlo', 'pensando pensar duda analizar'),
  s('risa', '1f602', '¡Jajaja!', 'risa jaja chiste gracioso'),
  s('carcajada', '1f923', '¡Me muero de la risa!', 'carcajada risa jaja revolcado'),
  s('corazon', '2764_fe0f', 'Con cariño', 'corazón cariño amor aprecio'),
  s('fuego', '1f525', '¡Está buenísimo!', 'fuego excelente buenísimo'),
  s('cohete', '1f680', '¡A producción!', 'cohete producción lanzamiento pase despegue'),
  s('cien', '1f4af', '¡Perfecto!', 'cien perfecto excelente 100'),
  s('me-encanta', '1f60d', '¡Me encanta!', 'me encanta amor ojos corazón'),
  s('que-detalle', '1f970', '¡Qué detalle!', 'detalle cariño corazones lindo'),
  s('muy-amable', '1f60a', 'Muy amable', 'amable sonrisa gracias'),
  s('revisando', '1f440', 'Lo estoy revisando', 'ojos revisando mirando reviso'),
  s('un-momento', '231b', 'Un momento', 'momento espera reloj de arena'),
  s('idea', '1f4a1', '¡Tengo una idea!', 'idea bombillo propuesta'),
  s('con-toda', '1f4aa', '¡Con toda!', 'fuerza con toda ánimo músculo'),
  s('trato-hecho', '1f91d', '¡Trato hecho!', 'trato hecho acuerdo apretón de manos'),
  s('por-fin', '1f64c', '¡Por fin!', 'por fin manos arriba aleluya'),
  s('todo-bajo-control', '1f60e', 'Todo bajo control', 'tranquilo gafas control'),
  s('impresionante', '1f92f', '¡Impresionante!', 'impresionante explota cabeza wow'),
  s('por-poco', '1f605', 'Uy, por poco', 'uy por poco sudor nervios'),
  s('no-puede-ser', '1f631', '¡No puede ser!', 'susto grito no puede ser sorpresa'),
  s('que-pesar', '1f622', 'Qué pesar', 'triste pesar lágrima'),
  s('urgente', '1f6a8', '¡Urgente!', 'urgente alerta sirena prioridad'),
  s('un-tinto', '2615', '¿Un tinto?', 'tinto café pausa descanso'),
  s('que-sueno', '1f634', 'Qué sueño', 'sueño dormir cansado'),
  s('feliz-cumpleanos', '1f382', '¡Feliz cumpleaños!', 'cumpleaños torta celebración'),
];

const POR_CODIGO = new Map(STICKERS_ANIMADOS.map((x) => [x.code, x]));

/** El sticker animado con ese código, o null si no existe. */
export function stickerAnimado(code: unknown): StickerAnimado | null {
  return typeof code === 'string' ? (POR_CODIGO.get(code) ?? null) : null;
}

function nombreDeArchivo(code: string): string {
  return encodeURIComponent(code.startsWith(PREFIJO) ? code.slice(PREFIJO.length) : code);
}

/** Ruta pública del WebP ANIMADO. */
export function urlStickerAnimado(code: string): string {
  return `/chat/stickers/noto/${nombreDeArchivo(code)}.webp`;
}

/** Ruta pública del cuadro FIJO (sin movimiento, fuera de pantalla, mientras carga). */
export function urlPosterStickerAnimado(code: string): string {
  return `/chat/stickers/noto/${nombreDeArchivo(code)}.poster.webp`;
}

/** Atribución corta que exige CC BY 4.0 (se muestra al pie del panel). */
export const ATRIBUCION_STICKERS_ANIMADOS = 'Stickers animados: Noto Emoji Animation de Google · CC BY 4.0';
