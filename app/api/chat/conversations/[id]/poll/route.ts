import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { serializeMessage } from '../../../../../../lib/chat/conversations';
import {
  POLL_PAGE_MAX,
  parseNonNegativeInt,
  parsePositiveInt,
} from '../../../../../../lib/chat/constants';
import { computeNextPollMs } from '../../../../../../lib/chat/polling';
import {
  badRequest,
  guardConversation,
  jsonNoStore,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * Sondeo adaptativo del hilo abierto: "¿hay algo nuevo después del mensaje X?".
 *
 *   GET /api/chat/conversations/12/poll?after=57&hidden=0&limit=50
 *
 * Es el reemplazo deliberado de SSE. Producción corre PM2 en cluster
 * (`instances: 2`, ecosystem.config.js): un registro de suscriptores SSE sería
 * estado en memoria de UNA instancia, funcionaría en testing (una instancia) y
 * fallaría de forma intermitente en producción. Ver lib/chat/polling.ts.
 *
 * Barato por diseño:
 *   - `after` es el id del último mensaje que el cliente ya tiene. La consulta
 *     es un seek por el índice (id_conversation, id DESC) — cuando no hay nada
 *     nuevo devuelve cero filas de inmediato.
 *   - No hay COUNT en el camino caliente: `hasMore` sale de pedir una fila de
 *     más.
 *   - La respuesta trae `nextPollMs`: el servidor le dice al cliente cuándo
 *     volver a preguntar. Hilo vivo -> 1 s; hilo quieto -> hasta 30 s; pestaña
 *     oculta (`hidden=1`) -> siempre el tope. Así el costo cae solo cuando no
 *     está pasando nada.
 *
 * Seguridad: guardConversation() valida sesión + propiedad + permiso vigente
 * sobre el agente, en CADA vuelta del sondeo. Un permiso revocado corta el
 * sondeo en la siguiente vuelta.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const sp = request.nextUrl.searchParams;

    const after = parseNonNegativeInt(sp.get('after'));
    if (after === null) {
      return badRequest('Debe indicar "after" (id del último mensaje que ya tiene; 0 si no tiene ninguno).');
    }
    const limit = parsePositiveInt(sp.get('limit'), POLL_PAGE_MAX, POLL_PAGE_MAX);
    const hidden = sp.get('hidden') === '1';

    const [rows, status, conversation] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { id_conversation: guard.conversationId, id: { gt: after } },
        orderBy: { id: 'asc' },
        take: limit + 1,
        include: { attachments: true },
      }),
      prisma.chatAgentStatus.findUnique({ where: { id_conversation: guard.conversationId } }),
      prisma.chatConversation.findUnique({
        where: { id: guard.conversationId },
        select: { last_message_at: true, updated_at: true },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const lastActivity =
      conversation?.last_message_at ?? conversation?.updated_at ?? null;
    const msSinceLastActivity = lastActivity
      ? Date.now() - lastActivity.getTime()
      : Number.POSITIVE_INFINITY;

    const nextPollMs = computeNextPollMs({
      hasNewMessages: page.length > 0,
      agentState: status?.state ?? null,
      msSinceLastActivity,
      hidden,
    });

    return jsonNoStore({
      messages: page.map(serializeMessage),
      // El cliente usa este cursor tal cual en la siguiente vuelta.
      cursor: page.length > 0 ? page[page.length - 1].id : after,
      hasMore,
      status: status
        ? {
            state: status.state,
            label: status.label,
            updatedAt: status.updated_at.toISOString(),
          }
        : null,
      nextPollMs,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/poll', error);
  }
}
