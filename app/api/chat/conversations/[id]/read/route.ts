import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import {
  badRequest,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * Marca como leídos los mensajes del AGENTE en una conversación.
 *
 *   POST /api/chat/conversations/12/read            -> marca todo lo pendiente
 *   POST /api/chat/conversations/12/read  { "upToMessageId": 40 }
 *
 * Solo se marcan los mensajes con role='agent': el "leído" es del usuario sobre
 * lo que el agente le escribió. Sus propios mensajes no se marcan (no tendría
 * sentido) y los del sistema tampoco cuentan como no leídos.
 *
 * `upToMessageId` permite marcar solo hasta donde el usuario alcanzó a leer.
 * El WHERE está siempre acotado a `id_conversation`, así que un id de mensaje
 * de OTRA conversación simplemente no encuentra filas: no se puede marcar como
 * leído nada ajeno.
 *
 * -------------------------------------------------------------------------
 * EN UN GRUPO NO SE TOCA `read_at`
 * -------------------------------------------------------------------------
 * `chat_message.read_at` es UNA columna por mensaje. En un grupo de cinco, el
 * primero que leyera lo daría por leído para los otros cuatro y a todos se les
 * apagaría el contador sin haber abierto nada. Por eso en un grupo lo que se
 * mueve es la MARCA DE AGUA de esa persona
 * (`chat_participant.last_read_message_id`): cada quien tiene su propia
 * cuenta, y con un entero, sin una tabla de lecturas por persona.
 *
 * La marca solo avanza, nunca retrocede: dos pestañas abiertas marcando a
 * ritmos distintos no pueden "desleer" lo que ya se leyó.
 *
 * Seguridad: guardConversation() valida sesión + propiedad (o participación en
 * el grupo) + permiso vigente.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const payload = (await readJsonBody(request)) ?? {};

    let upTo: number | undefined;
    if (payload.upToMessageId !== undefined && payload.upToMessageId !== null) {
      const parsed = Number(payload.upToMessageId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return badRequest('upToMessageId debe ser un entero positivo.');
      }
      upTo = parsed;
    }

    if (guard.kind === 'group') {
      // Hasta dónde leyó: lo que pidió el cliente o, si no dijo nada, el
      // último mensaje del grupo.
      let hasta = upTo ?? 0;
      if (!upTo) {
        const ultimo = await prisma.chatMessage.findFirst({
          where: { id_conversation: guard.conversationId },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        hasta = ultimo?.id ?? 0;
      }

      const mio = await prisma.chatParticipant.findFirst({
        where: { id_conversation: guard.conversationId, id_user: guard.user.id },
        select: { id_participant: true, last_read_message_id: true },
      });
      // guardConversation ya validó que es participante; si no apareciera,
      // algo más está mal y no se inventa una fila.
      if (!mio) {
        return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
      }

      const anterior = mio.last_read_message_id ?? 0;
      // La marca solo avanza.
      const nueva = Math.max(anterior, hasta);
      if (nueva !== anterior) {
        await prisma.chatParticipant.update({
          where: { id_participant: mio.id_participant },
          data: { last_read_message_id: nueva },
        });
      }

      const unreadCount = await prisma.chatMessage.count({
        where: {
          id_conversation: guard.conversationId,
          id: { gt: nueva },
          NOT: { id_user_author: guard.user.id },
          role: { not: 'system' },
        },
      });

      return jsonNoStore({ updated: nueva - anterior > 0 ? 1 : 0, unreadCount });
    }

    const result = await prisma.chatMessage.updateMany({
      where: {
        id_conversation: guard.conversationId,
        role: 'agent',
        read_at: null,
        ...(upTo ? { id: { lte: upTo } } : {}),
      },
      data: { read_at: new Date() },
    });

    const unreadCount = await prisma.chatMessage.count({
      where: { id_conversation: guard.conversationId, role: 'agent', read_at: null },
    });

    return jsonNoStore({ updated: result.count, unreadCount });
  } catch (error) {
    return serverError('POST /api/chat/conversations/[id]/read', error);
  }
}
