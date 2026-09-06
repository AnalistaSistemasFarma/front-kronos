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
 * Seguridad: guardConversation() valida sesión + propiedad + permiso vigente.
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
