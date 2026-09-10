/**
 * Constantes compartidas del módulo "Asistentes IA" (chat de agentes).
 *
 * Un solo lugar para los topes: si un límite vive duplicado en cada endpoint,
 * tarde o temprano uno queda desactualizado y se convierte en el hueco.
 */

/** Roles válidos de un mensaje. Texto y no enum: el provider sqlserver de
 *  Prisma no soporta enums nativos (ver prisma/schema.prisma). */
export const MESSAGE_ROLES = ['user', 'agent', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Estados válidos del indicador "qué está haciendo el agente". */
export const AGENT_STATES = ['idle', 'thinking', 'tool'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

/**
 * Tope de longitud de un mensaje del USUARIO. La columna es NVARCHAR(MAX), así
 * que el límite no lo impone la base: lo imponemos nosotros para que nadie
 * empuje un texto gigantesco (memoria del proceso, costo de render en el
 * cliente y, sobre todo, lo que después habría que mandarle al agente).
 */
export const MAX_USER_MESSAGE_CHARS = 8_000;

/**
 * Tope de longitud de un mensaje del AGENTE. Más alto que el del usuario a
 * propósito: una respuesta con tablas o bloques de código en Markdown es
 * legítimamente larga. Sigue siendo un tope duro.
 */
export const MAX_AGENT_MESSAGE_CHARS = 40_000;

/** Tope del texto del indicador de estado. */
export const MAX_STATUS_LABEL_CHARS = 200;

/**
 * Tope de sub-agentes que se listan en la tablita del indicador. Con más de
 * ocho la tabla deja de informar y empieza a estorbar; el resto se resume en
 * el contador.
 */
export const MAX_STATUS_TASKS = 8;

/** Tope de la descripción de cada sub-agente en esa tablita. */
export const MAX_TASK_DESC_CHARS = 80;

/** Tope del título de una conversación. */
export const MAX_TITLE_CHARS = 300;

/** Paginación de mensajes (histórico). */
export const MESSAGES_PAGE_DEFAULT = 30;
export const MESSAGES_PAGE_MAX = 100;

/** Cuántos mensajes nuevos devuelve como máximo una vuelta de sondeo. */
export const POLL_PAGE_MAX = 100;

/** Bandeja del agente: cuántos mensajes se entregan por vuelta. */
export const INBOX_PAGE_DEFAULT = 20;
export const INBOX_PAGE_MAX = 50;

/** Cuántos ids admite un ACK de la bandeja en una sola llamada. */
export const INBOX_ACK_MAX_IDS = 200;

/**
 * Long-poll de la bandeja del agente: segundos máximos que el servidor sostiene
 * la petición esperando trabajo. 30 s es cómodamente menor que cualquier
 * timeout intermedio (proxy/IIS/Cloudflare) y evita que el bot tenga que
 * martillar la base cada segundo.
 */
export const INBOX_WAIT_MAX_SECONDS = 30;
export const INBOX_WAIT_DEFAULT_SECONDS = 0;
/**
 * Cada cuánto revisa la base el long-poll mientras espera.
 *
 * 400 ms es un compromiso: es el PRIMER tramo de la demora que percibe el
 * usuario —el mensaje ya está escrito en `chat_message` pero el agente no se
 * entera hasta el siguiente tick—, así que bajarlo se nota de inmediato en la
 * pantalla. Al mismo tiempo, cada tick es un `SELECT TOP (n)` por el índice
 * (delivered_at, id) de UN agente: barato, pero no gratis. Por debajo de ~250 ms
 * el usuario ya no distingue la diferencia y solo se multiplican las consultas
 * contra SQL Server; por encima de 1 s la respuesta se siente tardía.
 */
export const INBOX_WAIT_TICK_MS = 400;

/** Longitud del extracto del último mensaje que se muestra en la bandeja. */
export const PREVIEW_CHARS = 160;

/** Recorta un cuerpo Markdown a un extracto de una línea para la lista. */
export function toPreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

/**
 * Valida y normaliza el cuerpo de un mensaje.
 *
 * El body se guarda SIEMPRE como Markdown crudo, jamás HTML: el render (y su
 * saneamiento) es responsabilidad del cliente. Aquí solo se recorta el espacio
 * sobrante y se verifican los topes.
 */
export function normalizeMessageBody(
  raw: unknown,
  maxChars: number
): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'El cuerpo del mensaje es obligatorio.' };
  }
  const body = raw.trim();
  if (body.length === 0) {
    return { ok: false, error: 'El mensaje no puede estar vacío.' };
  }
  if (body.length > maxChars) {
    return {
      ok: false,
      error: `El mensaje supera el máximo de ${maxChars} caracteres (tiene ${body.length}).`,
    };
  }
  return { ok: true, body };
}

/** Lee un entero positivo de la query string, con valor por defecto y tope. */
export function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max: number
): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** Lee un entero >= 0 de la query string (cursores). Devuelve null si no es válido. */
export function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
