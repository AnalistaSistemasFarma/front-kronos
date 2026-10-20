import 'server-only';
import { prisma } from '../prisma';
import type { ChatMessagePayload } from './conversations';
import { gifConfig, rutaProxyFirmada, urlDeGiphyValida } from './gif';
import { resumirReacciones, type ChatMediaDto, type ChatReactionDto } from './media-rules';
import { urlStickerGss } from './stickers-catalog';

/**
 * REACCIONES y GIF/STICKERS de los mensajes (2026-10-20) — la parte que toca
 * la base.
 *
 * Van APARTE de `messageInclude` a propósito: las tablas son nuevas y, si el
 * código llega a un ambiente antes que el DDL, un `include` las haría fallar
 * TODAS las lecturas del chat («Invalid object name»). Aquí cada lectura está
 * envuelta: sin tablas, los mensajes salen como siempre (sin reacciones ni
 * imagen) y el resto del chat no se entera. Es el mismo criterio de las anclas
 * (app/api/chat/pins).
 *
 * Costo: DOS consultas por página de mensajes, ambas por índice
 * (`chat_message_reaction(id_message, …)` y la clave primaria de
 * `chat_message_media`), solo sobre los ids de la página.
 */

/** ¿La tabla todavía no existe en esta base? (Prisma P2021 o SQL Server 208). */
export function tablaAusente(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: string; number?: number; message?: string };
  return e.code === 'P2021' || e.number === 208 || /Invalid object name 'dbo\.chat_(message_reaction|message_media|sticker)'/i.test(e.message ?? '');
}

export class ExtrasNoDisponibles extends Error {
  constructor() {
    super('Las reacciones, los GIF y los stickers aún no están habilitados en esta base de datos.');
    this.name = 'ExtrasNoDisponibles';
  }
}

/** Reacciones ACTIVAS de estos mensajes, ya agrupadas para quien mira. */
export async function reaccionesDe(idsMensajes: number[], yo: string): Promise<Map<number, ChatReactionDto[]>> {
  if (idsMensajes.length === 0) return new Map();
  const filas = await prisma.chatMessageReaction.findMany({
    where: { id_message: { in: idsMensajes }, active: true },
    select: {
      id: true,
      id_message: true,
      id_user: true,
      emoji: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { id: 'asc' },
  });
  return resumirReacciones(
    filas.map((f) => ({
      id: f.id,
      id_message: f.id_message,
      id_user: f.id_user,
      emoji: f.emoji,
      nombre: f.user?.name?.trim() || f.user?.email || 'Alguien',
    })),
    yo
  );
}

type FilaMedia = {
  id_message: number;
  kind: string;
  provider: string;
  external_id: string | null;
  id_sticker: number | null;
  title: string | null;
  media_url: string | null;
  width: number | null;
  height: number | null;
};

/** Convierte la fila de la base en lo que ve el navegador (sin la URL del proveedor). */
export function serializarMedia(f: FilaMedia): ChatMediaDto | null {
  if (f.kind === 'sticker' && f.provider === 'gss' && f.external_id) {
    return { kind: 'sticker', provider: 'gss', title: f.title ?? 'Sticker', src: urlStickerGss(f.external_id), width: 160, height: 160 };
  }
  if (f.kind === 'sticker' && f.provider === 'empresa' && f.id_sticker) {
    return { kind: 'sticker', provider: 'empresa', title: f.title ?? 'Sticker', src: `/api/chat/stickers/${f.id_sticker}`, width: null, height: null };
  }
  if (f.kind === 'gif' && f.provider === 'giphy' && urlDeGiphyValida(f.media_url)) {
    // Sin la llave del proxy (sin NEXTAUTH_SECRET) no hay cómo servirlo: el
    // mensaje queda con su texto descriptivo.
    try {
      return {
        kind: 'gif',
        provider: 'giphy',
        title: f.title ?? 'GIF',
        src: rutaProxyFirmada(f.media_url),
        width: f.width,
        height: f.height,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export async function mediaDe(idsMensajes: number[]): Promise<Map<number, ChatMediaDto>> {
  if (idsMensajes.length === 0) return new Map();
  const filas = await prisma.chatMessageMedia.findMany({
    where: { id_message: { in: idsMensajes } },
    select: {
      id_message: true,
      kind: true,
      provider: true,
      external_id: true,
      id_sticker: true,
      title: true,
      media_url: true,
      width: true,
      height: true,
    },
  });
  const salida = new Map<number, ChatMediaDto>();
  for (const f of filas) {
    const m = serializarMedia(f);
    if (m) salida.set(f.id_message, m);
  }
  return salida;
}

/**
 * Le pone a cada mensaje sus reacciones y su GIF/sticker. Nunca lanza por las
 * tablas nuevas: si faltan, devuelve los mensajes tal cual.
 */
export async function conExtras(mensajes: ChatMessagePayload[], yo: string): Promise<ChatMessagePayload[]> {
  const ids = mensajes.filter((m) => m.id > 0).map((m) => m.id);
  if (ids.length === 0) return mensajes;
  let reacciones = new Map<number, ChatReactionDto[]>();
  let media = new Map<number, ChatMediaDto>();
  try {
    [reacciones, media] = await Promise.all([reaccionesDe(ids, yo), mediaDe(ids)]);
  } catch (error) {
    if (!tablaAusente(error)) throw error;
    return mensajes;
  }
  return mensajes.map((m) => {
    const r = reacciones.get(m.id);
    const md = media.get(m.id);
    if (!r && !md) return m;
    return { ...m, ...(r ? { reactions: r } : {}), ...(md ? { media: md } : {}) };
  });
}

/**
 * CURSOR de reacciones de una conversación: el id más alto (lápidas incluidas).
 * Un seek por el índice (id_conversation, id). null si la tabla no existe.
 */
export async function cursorReacciones(idConversation: number): Promise<number | null> {
  try {
    const fila = await prisma.chatMessageReaction.findFirst({
      where: { id_conversation: idConversation },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return fila?.id ?? 0;
  } catch (error) {
    if (tablaAusente(error)) return null;
    throw error;
  }
}

/** Tope de mensajes cuyas reacciones viajan en UNA vuelta del sondeo. */
const MAX_MENSAJES_CAMBIADOS = 200;

/**
 * Qué reacciones cambiaron en esta conversación desde `despues` (para el
 * sondeo del hilo abierto). Devuelve, por mensaje tocado, su resumen COMPLETO
 * y vigente —no el delta—: el navegador simplemente reemplaza.
 *
 * `despues = 0` es la primera vuelta de un cliente que no tenía cursor:
 * responde solo con el cursor actual, sin recorrer la historia.
 */
export async function cambiosDeReacciones(
  idConversation: number,
  despues: number,
  yo: string
): Promise<{ cursor: number; cambios: Record<number, ChatReactionDto[]> } | null> {
  const cursor = await cursorReacciones(idConversation);
  if (cursor === null) return null;
  if (despues <= 0 || cursor <= despues) return { cursor: Math.max(cursor, despues), cambios: {} };

  try {
    const tocadas = await prisma.chatMessageReaction.findMany({
      where: { id_conversation: idConversation, id: { gt: despues, lte: cursor } },
      select: { id_message: true },
      orderBy: { id: 'asc' },
      take: 2_000,
    });
    const ids = [...new Set(tocadas.map((t) => t.id_message))].slice(-MAX_MENSAJES_CAMBIADOS);
    const resumen = await reaccionesDe(ids, yo);
    const cambios: Record<number, ChatReactionDto[]> = {};
    // Un mensaje sin reacciones activas viaja con lista vacía: así el
    // navegador quita el último chip.
    for (const id of ids) cambios[id] = resumen.get(id) ?? [];
    return { cursor, cambios };
  } catch (error) {
    if (tablaAusente(error)) return null;
    throw error;
  }
}

/** Estado de las funciones para la interfaz (pestañas del selector). */
export function funcionesDeMedia(): { gif: boolean } {
  return { gif: gifConfig().enabled };
}
