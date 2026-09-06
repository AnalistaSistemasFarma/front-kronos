import { prisma } from '../../../../../../lib/prisma';
import { guardConversation, jsonNoStore, serverError } from '../../../../../../lib/chat/http';

/**
 * Estado en vivo del agente en una conversación — lo que alimenta el indicador
 * de "qué está haciendo" ("Pensando…", "Consultando SAP…").
 *
 *   GET /api/chat/conversations/12/status
 *
 * Devuelve `{ status: null }` cuando el agente nunca ha publicado un estado en
 * ese hilo; la interfaz lo trata como 'idle'.
 *
 * Este endpoint es solo de LECTURA. Quien escribe el estado es el agente, por
 * su propia API (POST /api/chat/agent/status) autenticada con su llave: el
 * usuario no puede fabricar el estado de un bot.
 *
 * Seguridad: guardConversation() valida sesión + propiedad + permiso vigente.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const status = await prisma.chatAgentStatus.findUnique({
      where: { id_conversation: guard.conversationId },
    });

    return jsonNoStore({
      status: status
        ? {
            state: status.state,
            label: status.label,
            updatedAt: status.updated_at.toISOString(),
          }
        : null,
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/status', error);
  }
}
