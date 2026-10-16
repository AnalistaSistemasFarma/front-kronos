import { prisma } from '../../../../../../lib/prisma';
import {
  badRequest,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * Preferencias de UNA persona sobre UN hilo entre personas.
 *
 *   PATCH /api/chat/conversations/12/preferences   { "nudgesMuted": true }
 *
 * Hoy solo existe `nudgesMuted` (decisión D5): silenciar los zumbidos de este
 * hilo. Es de quien la cambia y de nadie más —se guarda en SU fila de
 * chat_participant— y la otra persona no se entera.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;
    if (guard.kind !== 'people') {
      return badRequest('Estas preferencias solo aplican a conversaciones entre personas.');
    }

    const body = await readJsonBody(request);
    if (!body || typeof body.nudgesMuted !== 'boolean') {
      return badRequest('Debe indicar nudgesMuted (true o false).');
    }

    const actualizado = await prisma.chatParticipant.update({
      where: { id_participant: guard.myParticipantId },
      data: { nudges_muted: body.nudgesMuted },
      select: { nudges_muted: true },
    });

    return jsonNoStore({ nudgesMuted: actualizado.nudges_muted });
  } catch (error) {
    return serverError('PATCH /api/chat/conversations/[id]/preferences', error);
  }
}
