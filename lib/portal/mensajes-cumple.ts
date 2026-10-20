/**
 * PORTAL TH — MENSAJES DE CUMPLEAÑOS (Cristian Baldión, 2026-10-20).
 *
 * En el recuadro de eventos del calendario, quien ve a una persona que cumple años puede pulsar su nombre y dejarle un mensaje
 * («Deja tu mensaje»: texto y emojis). Lo lee SOLO la persona que cumple años y el administrador, que puede borrar los que no
 * correspondan.
 *
 * Este archivo es PURO y sirve tanto al servidor como al navegador (sin `node:crypto`, sin red): validación del texto, ventana de
 * fechas en que se puede escribir y leer, y la paleta de emojis. El guardado y los permisos están en `mensajes-cumple-servidor.ts`.
 */

export const MAX_CARACTERES_MENSAJE = 500;
export const MAX_LINEAS_MENSAJE = 8;
/** Días después del cumpleaños en que el mensaje se puede escribir y leer (el administrador lo ve siempre). */
export const DIAS_VISIBLE_MENSAJE = 7;
/** Cuántos mensajes puede dejar una misma persona a un mismo cumpleañero el mismo día. */
export const MAX_MENSAJES_POR_REMITENTE = 3;
/** Tope de mensajes que se leen por día (protege la lectura de SharePoint). */
export const MAX_MENSAJES_POR_DIA = 100;

/** Paleta de emojis del cuadro «Deja tu mensaje» (también se puede escribir con el teclado del sistema). */
export const EMOJIS_MENSAJE = [
  '🎉', '🎂', '🥳', '🎈', '🎁', '🍰', '🎊', '✨',
  '😀', '😊', '😍', '🥰', '😘', '😎', '🤗', '😂',
  '👏', '🙌', '👍', '💪', '🙏', '🤝', '💐', '🌹',
  '❤️', '💙', '💛', '💚', '🌟', '⭐', '🍀', '☀️',
] as const;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esBisiesto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** `AAAA-MM-DD` que existe de verdad. */
export function fechaIsoValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !FECHA.test(valor)) return false;
  const [a, m, d] = [Number(valor.slice(0, 4)), Number(valor.slice(5, 7)), Number(valor.slice(8, 10))];
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= [31, esBisiesto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

const diaNumero = (fecha: string) => Math.floor(new Date(`${fecha}T00:00:00Z`).getTime() / 86_400_000);

/**
 * ¿`fecha` está dentro de la ventana en que se puede dejar y leer un mensaje? Del día del cumpleaños hasta
 * `DIAS_VISIBLE_MENSAJE` días después: hoy mismo o hasta 7 días atrás. No se escribe a un cumpleaños que todavía no llega.
 */
export function fechaEnVentanaMensaje(fecha: string, hoy: string): boolean {
  if (!fechaIsoValida(fecha) || !fechaIsoValida(hoy)) return false;
  const atras = diaNumero(hoy) - diaNumero(fecha);
  return atras >= 0 && atras <= DIAS_VISIBLE_MENSAJE;
}

export type ResultadoTexto = { ok: true; texto: string } | { ok: false; error: string };

/** Caracteres «de verdad» (un emoji cuenta como uno, no como dos). */
export const contarCaracteres = (t: string) => Array.from(t).length;

/**
 * Valida y limpia el texto de un mensaje: sin caracteres de control (salvo el salto de línea), espacios recortados, hasta
 * `MAX_CARACTERES_MENSAJE` caracteres y `MAX_LINEAS_MENSAJE` líneas. Los emojis se aceptan (incluidos los compuestos).
 */
export function validarTextoMensaje(crudo: unknown): ResultadoTexto {
  if (typeof crudo !== 'string') return { ok: false, error: 'Escriba su mensaje.' };
  const limpio = crudo
    .replace(/\r\n?/g, '\n')
    // Caracteres de control (menos \n), separadores de línea Unicode y marcas de dirección que cambian cómo se lee el texto.
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!limpio) return { ok: false, error: 'Escriba su mensaje.' };
  if (contarCaracteres(limpio) > MAX_CARACTERES_MENSAJE) return { ok: false, error: `El mensaje admite máximo ${MAX_CARACTERES_MENSAJE} caracteres.` };
  if (limpio.split('\n').length > MAX_LINEAS_MENSAJE) return { ok: false, error: `El mensaje admite máximo ${MAX_LINEAS_MENSAJE} líneas.` };
  return { ok: true, texto: limpio };
}

/** Un correo razonable: sin espacios, una arroba y un dominio con punto («No Aplica» y vacío NO lo son). */
export const esCorreoMensaje = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Lo que el navegador recibe de un mensaje. El correo del remitente y si el destinatario tiene correo solo los ve el administrador. */
export interface MensajeVisible {
  /** Nombre del archivo en SharePoint; sirve para que el administrador borre. Nunca contiene datos personales. */
  id: string;
  paraNombre: string;
  paraEmpresa: string;
  deNombre: string;
  texto: string;
  enviadoEl: string;
  deCorreo?: string;
  /** Solo administrador: el cumpleañero no tiene correo corporativo, así que nadie más que usted lo ve. */
  sinCorreo?: boolean;
}

export interface RespuestaMensajes {
  mensajes: MensajeVisible[];
  /** Quien pregunta es administrador: puede borrar y ve todos los mensajes del día. */
  puedeModerar: boolean;
}
