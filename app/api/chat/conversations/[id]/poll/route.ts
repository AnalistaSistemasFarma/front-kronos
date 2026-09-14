import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { parseAgentTasks } from '../../../../../../lib/chat/status-tasks';
import { messageInclude, serializeMessage } from '../../../../../../lib/chat/conversations';
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

    const [rows, estados, conversation, lastMessage] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { id_conversation: guard.conversationId, id: { gt: after } },
        orderBy: { id: 'asc' },
        take: limit + 1,
        include: messageInclude,
      }),
      // En un grupo hay un estado POR AGENTE, así que ya no es una sola fila.
      prisma.chatAgentStatus.findMany({
        where: { id_conversation: guard.conversationId },
        include: { agent: { select: { display_name: true, avatar_url: true } } },
      }),
      prisma.chatConversation.findUnique({
        where: { id: guard.conversationId },
        select: { last_message_at: true, updated_at: true },
      }),
      // Quién habló de último. Alimenta `awaitingAgent` (ver más abajo): es un
      // seek de UNA fila por el índice (id_conversation, id DESC), el mismo que
      // ya usa la consulta de arriba.
      prisma.chatMessage.findFirst({
        where: { id_conversation: guard.conversationId },
        orderBy: { id: 'desc' },
        select: { role: true },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const statuses = estados.map((f) => ({
      idAgent: f.id_agent,
      agentName: f.agent.display_name,
      agentAvatarUrl: f.agent.avatar_url,
      state: f.state,
      label: f.label,
      tasks: parseAgentTasks(f.tasks),
      updatedAt: f.updated_at.toISOString(),
    }));

    // El estado que gobierna la cadencia del sondeo. En el hilo directo es el
    // del agente del hilo; en un grupo, el "más ocupado" de todos: si alguno
    // está trabajando, al usuario le tiene que llegar rápido lo que publique.
    const status =
      guard.kind === 'direct'
        ? statuses.find((s) => s.idAgent === guard.idAgent) ?? null
        : statuses.find((s) => s.state !== 'idle') ?? null;

    const lastActivity =
      conversation?.last_message_at ?? conversation?.updated_at ?? null;
    const msSinceLastActivity = lastActivity
      ? Date.now() - lastActivity.getTime()
      : Number.POSITIVE_INFINITY;

    // El usuario escribió de último y el agente todavía no contesta: se sondea
    // en vivo aunque el estado siga en 'idle', que es lo que pasa entre que se
    // envía el mensaje y el bot publica su primer "Pensando…".
    const lastRole = page.length > 0 ? page[page.length - 1].role : lastMessage?.role ?? null;
    // En un grupo, que el último mensaje sea de una persona NO significa que
    // haya un agente por contestar: si no mencionó a nadie, nadie va a
    // responder y sondear en vivo sería quemar consultas para siempre. Ahí el
    // criterio es que quede alguna mención sin recoger.
    const awaitingAgent =
      guard.kind === 'direct'
        ? lastRole === 'user'
        : (await prisma.chatMessageDelivery.count({
            where: { delivered_at: null, message: { id_conversation: guard.conversationId } },
          })) > 0;

    const nextPollMs = computeNextPollMs({
      hasNewMessages: page.length > 0,
      agentState: status?.state ?? null,
      msSinceLastActivity,
      hidden,
      awaitingAgent,
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
            tasks: status.tasks,
            updatedAt: status.updatedAt,
          }
        : null,
      // Desglose por agente: lo que pinta el encabezado de un grupo.
      statuses,
      nextPollMs,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/poll', error);
  }
}
