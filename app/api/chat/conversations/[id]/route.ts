import { getConversationPayload } from '../../../../../lib/chat/conversations';
import { guardConversation, jsonNoStore, serverError } from '../../../../../lib/chat/http';

/**
 * Ficha de UNA conversación: título, empresa, integrantes, no leídos y el
 * estado de cada agente.
 *
 *   GET /api/chat/conversations/12
 *
 * Los hilos DIRECTOS no necesitan este endpoint: se abren con
 * `POST /api/chat/conversations { idAgent }`, que es idempotente y devuelve la
 * ficha de una vez. Un GRUPO, en cambio, ya existe y se abre por su id — no
 * hay nada que crear —, así que hace falta poder leerlo.
 *
 * Seguridad: guardConversation() valida sesión + propiedad (hilo directo) o
 * participación vigente (grupo). Un id ajeno responde 404, no 403: distinguirlos
 * le confirmaría a quien sondea ids que la conversación existe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const conversation = await getConversationPayload(guard.conversationId, guard.user.id);
    if (!conversation) {
      return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    return jsonNoStore({
      conversation,
      // Papel del usuario en el grupo: la interfaz lo usa para saber si pintar
      // la administración de integrantes. La reja real está en el endpoint de
      // participantes.
      myRole: guard.kind === 'group' ? guard.groupRole : null,
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]', error);
  }
}
