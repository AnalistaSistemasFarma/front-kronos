import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { accesoAMedia } from '../../../../../../lib/chat/media-access';
import { readClientOrigin } from '../../../../../../lib/chat/client-origin';
import { gifConfig, obtenerGifParaEnviar } from '../../../../../../lib/chat/gif';
import { crearMensajeConMedia, type MediaNueva } from '../../../../../../lib/chat/message-media';
import { ExtrasNoDisponibles, tablaAusente } from '../../../../../../lib/chat/message-extras';
import { stickerPropio } from '../../../../../../lib/chat/stickers-paquetes';
import { stickerEnviable } from '../../../../../../lib/chat/stickers-personales';
import {
  badRequest,
  forbidden,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * Enviar un GIF o un STICKER (2026-10-20).
 *
 *   POST /api/chat/conversations/12/media
 *   { "kind": "sticker", "code": "pulgar-arriba" }        sticker propio de GSS
 *   { "kind": "sticker", "code": "noto-aplausos" }        sticker animado (Noto)
 *   { "kind": "sticker", "idSticker": 7 }                  sticker de la empresa
 *   { "kind": "gif", "id": "<id de GIPHY>" }               GIF
 *   (+ "replyTo": <id> opcional, igual que un mensaje)
 *
 * El navegador manda SOLO identificadores. El servidor resuelve todo lo demás:
 *   - el sticker propio sale del catálogo versionado (lib/chat/stickers-catalog);
 *   - el de la empresa tiene que estar activo y ser de una empresa donde quien
 *     envía tiene el módulo de Chat (o de todas, `id_company` NULL), o ser un
 *     sticker PROPIO de quien envía («Mis stickers», 2026-10-21);
 *   - el GIF se vuelve a pedir a GIPHY por su id y se rechaza si su rating no
 *     está permitido. La URL que queda guardada la eligió el servidor.
 *
 * Permisos: los de enviar un mensaje (guardConversation; en un proyecto,
 * además, poder escribir).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;
    if (guard.kind === 'project' && !guard.projectWritable.ok) {
      return forbidden(guard.projectWritable.motivo);
    }

    const body = await readJsonBody(request);
    if (!body) return badRequest('El cuerpo debe ser un objeto JSON.');

    // La cita se valida contra ESTA conversación, igual que en los mensajes.
    let idReplyTo: number | null = null;
    if (body.replyTo !== undefined && body.replyTo !== null && body.replyTo !== '') {
      const candidato = Number(body.replyTo);
      if (!Number.isInteger(candidato) || candidato <= 0) return badRequest('El mensaje citado no es válido.');
      const citado = await prisma.chatMessage.findUnique({ where: { id: candidato }, select: { id_conversation: true } });
      if (!citado || citado.id_conversation !== guard.conversationId) {
        return badRequest('Solo se puede citar un mensaje de esta misma conversación.');
      }
      idReplyTo = candidato;
    }

    let media: MediaNueva;
    if (body.kind === 'sticker' && body.code !== undefined) {
      // Paquete propio estático (SVG) o animado (WebP de Noto, `noto-…`).
      const s = stickerPropio(body.code);
      if (!s) return badRequest('Ese sticker no existe.');
      media = { kind: 'sticker', provider: 'gss', externalId: s.code, idSticker: null, title: s.label, mediaUrl: null, width: 160, height: 160 };
    } else if (body.kind === 'sticker' && body.idSticker !== undefined) {
      const idSticker = Number(body.idSticker);
      if (!Number.isInteger(idSticker) || idSticker <= 0) return badRequest('Ese sticker no existe.');
      const { empresas } = await accesoAMedia(guard.user);
      // De una empresa de quien envía (o de todas) o uno PROPIO suyo («Mis
      // stickers»); nunca el sticker personal de otra persona.
      let fila: { id_sticker: number; label: string } | null = null;
      try {
        fila = await stickerEnviable(idSticker, empresas, guard.user.id);
      } catch (error) {
        if (tablaAusente(error)) throw new ExtrasNoDisponibles();
        throw error;
      }
      if (!fila) return badRequest('Ese sticker no existe.');
      media = { kind: 'sticker', provider: 'empresa', externalId: null, idSticker: fila.id_sticker, title: fila.label, mediaUrl: null, width: null, height: null };
    } else if (body.kind === 'gif') {
      const cfg = gifConfig();
      if (!cfg.enabled) return jsonNoStore({ error: 'Los GIF no están habilitados.' }, { status: 404 });
      let gif;
      try {
        gif = await obtenerGifParaEnviar(String(body.id ?? ''), cfg);
      } catch (error) {
        console.error('[chat] GIPHY no respondió al enviar un GIF:', error);
        return jsonNoStore({ error: 'El servicio de GIF no respondió. Intente de nuevo.' }, { status: 502 });
      }
      if (!gif) return badRequest('Ese GIF no está disponible.');
      media = { kind: 'gif', provider: 'giphy', externalId: gif.id, idSticker: null, title: gif.title, mediaUrl: gif.url, width: gif.width, height: gif.height };
    } else {
      return badRequest('Debe indicar un sticker o un GIF.');
    }

    const message = await crearMensajeConMedia(guard, media, { idReplyTo, ...readClientOrigin(request) });
    return jsonNoStore(
      {
        message,
        // Igual que en los mensajes: en un proyecto lo atiende su agente; en un
        // grupo no hay menciones, así que nadie.
        notifiedAgents: guard.kind === 'project' ? [guard.idAgent] : [],
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ExtrasNoDisponibles) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/conversations/[id]/media', error);
  }
}
