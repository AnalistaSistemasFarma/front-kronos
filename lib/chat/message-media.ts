import 'server-only';
import { prisma } from '../prisma';
import type { ConversationGuard } from './http';
import { messageInclude, serializeMessage, type ChatMessagePayload } from './conversations';
import { notifyPeopleMessage } from './notifyPeople';
import { ExtrasNoDisponibles, serializarMedia, tablaAusente } from './message-extras';
import { cuerpoDescriptivo } from './media-rules';

/**
 * Crea un mensaje de GIF o de STICKER (2026-10-20).
 *
 * Es un mensaje NORMAL de la persona —mismo `role`, mismo autor de la sesión,
 * mismo origen para la auditoría— cuyo `body` es el texto descriptivo
 * («[Sticker: ¡De acuerdo!]», «[GIF: …]»), más una fila en chat_message_media
 * que le dice a la interfaz que lo pinte como imagen. Los dos se escriben en la
 * MISMA transacción con la marca de la bandeja: o entra todo o nada.
 *
 * Por qué así y no con un `event_type` nuevo: chat_message.event_type tiene un
 * CHECK que solo admite NULL o 'nudge', y la regla es no modificar lo que ya
 * existe. Además, con el texto en `body`, los agentes (synerlink-channel, los
 * puentes de openclaw y el puente de hilos), la bandeja, el buscador, las
 * notificaciones y la auditoría ya lo entienden sin tocar nada.
 *
 * En un GRUPO no hay menciones en el texto descriptivo, así que no despierta a
 * ningún agente. En un hilo DIRECTO o de PROYECTO el agente sí lo recibe, como
 * cualquier mensaje, y lee el texto descriptivo.
 */
export interface MediaNueva {
  kind: 'gif' | 'sticker';
  provider: 'giphy' | 'gss' | 'empresa';
  externalId: string | null;
  idSticker: number | null;
  title: string;
  mediaUrl: string | null;
  width: number | null;
  height: number | null;
}

type GuardOk = Exclude<ConversationGuard, { response: unknown }>;

export async function crearMensajeConMedia(
  guard: GuardOk,
  media: MediaNueva,
  extra: { idReplyTo: number | null; clientIp: string | null; userAgent: string | null }
): Promise<ChatMessagePayload> {
  const now = new Date();
  const body = cuerpoDescriptivo(media.kind, media.title);

  let creado;
  try {
    creado = await prisma.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: {
          id_conversation: guard.conversationId,
          role: 'user',
          body,
          created_at: now,
          id_user_author: guard.user.id,
          client_ip: extra.clientIp,
          user_agent: extra.userAgent,
          ...(extra.idReplyTo !== null ? { id_reply_to: extra.idReplyTo } : {}),
        },
        include: messageInclude,
      });
      const fila = await tx.chatMessageMedia.create({
        data: {
          id_message: m.id,
          kind: media.kind,
          provider: media.provider,
          external_id: media.externalId,
          id_sticker: media.idSticker,
          title: media.title.slice(0, 200),
          media_url: media.mediaUrl,
          width: media.width,
          height: media.height,
        },
      });
      await tx.chatConversation.update({
        where: { id: guard.conversationId },
        data: { last_message_at: now },
      });
      return { m, fila };
    });
  } catch (error) {
    if (tablaAusente(error)) throw new ExtrasNoDisponibles();
    throw error;
  }

  if (guard.kind === 'people') {
    void notifyPeopleMessage({
      idConversation: guard.conversationId,
      idRemitente: guard.user.id,
      idDestino: guard.otherUserId,
      body,
      attachmentCount: 0,
      idMessage: creado.m.id,
      createdAt: creado.m.created_at,
    });
  }

  const payload = serializeMessage(creado.m);
  const md = serializarMedia(creado.fila);
  return md ? { ...payload, media: md } : payload;
}
