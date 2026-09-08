import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { serializeAttachment } from '../../../../../lib/chat/conversations';
import {
  INBOX_PAGE_DEFAULT,
  INBOX_PAGE_MAX,
  INBOX_WAIT_DEFAULT_SECONDS,
  INBOX_WAIT_MAX_SECONDS,
  INBOX_WAIT_TICK_MS,
  parsePositiveInt,
} from '../../../../../lib/chat/constants';
import { jsonNoStore, serverError, unauthorized } from '../../../../../lib/chat/http';

// El long-poll obliga a que la ruta sea dinámica: nada de esto se cachea.
export const dynamic = 'force-dynamic';

/**
 * BANDEJA DEL AGENTE — lo que este agente todavía no ha recogido.
 *
 * Dos fuentes, en una sola respuesta:
 *
 *   - HILOS DIRECTOS: los mensajes del usuario con `delivered_at` en null en
 *     los hilos de este agente. Es la bandeja original y no cambió en nada.
 *   - GRUPOS: las filas de `chat_message_delivery` de este agente con
 *     `delivered_at` en null. En un grupo **existe una fila solo si el agente
 *     fue MENCIONADO**, así que la bandeja ya viene filtrada por la regla de la
 *     mención: lo que no lo nombra, no le llega. Y como la entrega es por
 *     (mensaje, agente), que un agente recoja el mensaje no se lo esconde a
 *     los otros.
 *
 * Los mensajes de grupo pueden venir de una PERSONA o de OTRO AGENTE (así se
 * pasan el turno). `author` lo dice; `conversation.user` se rellena con el
 * autor cuando es una persona para que un canal viejo siga mostrando el nombre
 * correcto.
 *
 *   GET /api/chat/agent/inbox?wait=25&limit=20&ack=true
 *   Authorization: Bearer <llave del agente>
 *
 * Parámetros:
 *   wait   segundos de long-poll (0..30, por defecto 0 = responde ya). Mientras
 *          espera revisa la base cada segundo y devuelve en cuanto haya algo.
 *   limit  cuántos mensajes por vuelta (1..50).
 *   ack    'true' (por defecto) marca los mensajes entregados en la misma
 *          vuelta. 'false' los deja pendientes y obliga a confirmarlos con
 *          POST /api/chat/agent/ack.
 *
 * Sobre `ack`: con el valor por defecto la entrega es "a lo sumo una vez" — si
 * el bot se cae después de recibirlos, esos mensajes ya quedaron marcados. Con
 * `ack=false` la entrega es "al menos una vez" y el bot decide cuándo
 * confirmar, a cambio de que el long-poll le devuelva lo mismo hasta que lo
 * haga. Se dejó `true` por defecto para que un bot mal escrito no gire en vacío
 * martillando SQL Server.
 *
 * -------------------------------------------------------------------------
 * SEGURIDAD
 * -------------------------------------------------------------------------
 * El agente sale de la LLAVE (lib/chat/agent-auth.ts), nunca del payload ni de
 * la query. El WHERE está anclado a `conversation.id_agent = <agente de la
 * llave>`: un agente no puede ver —ni tocar— la bandeja de otro, no importa lo
 * que pida. La comparación de la llave es en tiempo constante (SHA-256 +
 * timingSafeEqual) y sin cortocircuito.
 */
export async function GET(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const sp = request.nextUrl.searchParams;
    const limit = parsePositiveInt(sp.get('limit'), INBOX_PAGE_DEFAULT, INBOX_PAGE_MAX);
    const ack = sp.get('ack') !== 'false';

    const rawWait = sp.get('wait');
    const waitSeconds =
      rawWait === null || rawWait.trim() === ''
        ? INBOX_WAIT_DEFAULT_SECONDS
        : Math.min(Math.max(Number.parseInt(rawWait, 10) || 0, 0), INBOX_WAIT_MAX_SECONDS);

    const startedAt = Date.now();
    const deadline = startedAt + waitSeconds * 1000;

    const conversationSelect = {
      id: true,
      title: true,
      kind: true,
      user: { select: { id: true, name: true, email: true } },
    } as const;

    const autorSelect = {
      userAuthor: { select: { id: true, name: true, email: true } },
      agentAuthor: { select: { id_agent: true, code: true, display_name: true } },
    } as const;

    /** Pendientes de los HILOS DIRECTOS (la bandeja original). */
    const fetchDirectos = () =>
      prisma.chatMessage.findMany({
        where: {
          role: 'user',
          delivered_at: null,
          // ANCLA DE SEGURIDAD: solo hilos DIRECTOS de ESTE agente.
          conversation: { kind: 'direct', id_agent: agent.idAgent },
        },
        orderBy: { id: 'asc' },
        take: limit,
        include: { attachments: true, conversation: { select: conversationSelect }, ...autorSelect },
      });

    /** Pendientes de GRUPOS: sus menciones sin recoger. */
    const fetchGrupos = () =>
      prisma.chatMessageDelivery.findMany({
        where: {
          // ANCLA DE SEGURIDAD: las entregas son de ESTE agente, y la fila
          // solo existe si lo mencionaron.
          id_agent: agent.idAgent,
          delivered_at: null,
        },
        orderBy: { id_message: 'asc' },
        take: limit,
        select: {
          message: {
            include: {
              attachments: true,
              conversation: { select: conversationSelect },
              ...autorSelect,
            },
          },
        },
      });

    type Pendiente = Awaited<ReturnType<typeof fetchDirectos>>[number];

    const fetchPending = async (): Promise<Pendiente[]> => {
      const [directos, grupos] = await Promise.all([fetchDirectos(), fetchGrupos()]);
      // Se mezclan por id (que es monótono) para que el bot los reciba en el
      // orden en que se escribieron, sin importar de qué fuente vengan.
      return [...directos, ...grupos.map((g) => g.message)]
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    };

    let pending = await fetchPending();

    // Long-poll: revisa cada segundo hasta la fecha límite. Se aborta de
    // inmediato si el cliente cuelga (request.signal), para no dejar la
    // consulta girando contra la base sin nadie al otro lado.
    while (pending.length === 0 && Date.now() < deadline && !request.signal.aborted) {
      const remaining = deadline - Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.min(INBOX_WAIT_TICK_MS, remaining)));
      if (request.signal.aborted) break;
      pending = await fetchPending();
    }

    if (ack && pending.length > 0) {
      const ahora = new Date();
      const idsDirectos = pending.filter((m) => m.conversation.kind !== 'group').map((m) => m.id);
      const idsGrupo = pending.filter((m) => m.conversation.kind === 'group').map((m) => m.id);

      await Promise.all([
        idsDirectos.length > 0
          ? prisma.chatMessage.updateMany({
              where: { id: { in: idsDirectos }, delivered_at: null },
              data: { delivered_at: ahora },
            })
          : Promise.resolve(null),
        // En un grupo NO se toca `chat_message.delivered_at`: marcarlo ahí se
        // lo esconderÍa a los demás agentes mencionados. Se marca la fila de
        // ESTE agente y nada más.
        idsGrupo.length > 0
          ? prisma.chatMessageDelivery.updateMany({
              where: { id_message: { in: idsGrupo }, id_agent: agent.idAgent, delivered_at: null },
              data: { delivered_at: ahora },
            })
          : Promise.resolve(null),
      ]);
    }

    return jsonNoStore({
      agent: { idAgent: agent.idAgent, code: agent.code, displayName: agent.displayName },
      acknowledged: ack,
      waitedMs: Date.now() - startedAt,
      messages: pending.map((m) => ({
        id: m.id,
        idConversation: m.id_conversation,
        role: m.role,
        body: m.body,
        createdAt: m.created_at.toISOString(),
        // Quién escribió: en un grupo puede ser una persona o OTRO agente.
        author: m.agentAuthor
          ? {
              kind: 'agent' as const,
              id: m.agentAuthor.id_agent,
              code: m.agentAuthor.code,
              name: m.agentAuthor.display_name,
            }
          : m.userAuthor
            ? {
                kind: 'user' as const,
                id: m.userAuthor.id,
                name: m.userAuthor.name,
                email: m.userAuthor.email,
              }
            : null,
        conversation: {
          id: m.conversation.id,
          title: m.conversation.title,
          kind: m.conversation.kind,
          // En un hilo directo, el dueño. En un grupo, QUIEN ESCRIBIÓ si es una
          // persona; null si el mensaje lo escribió otro agente. Se rellena así
          // para que un canal que solo lee `conversation.user.name` siga
          // mostrando el nombre correcto en vez del creador del grupo.
          user:
            m.conversation.kind === 'group'
              ? m.userAuthor
                ? { id: m.userAuthor.id, name: m.userAuthor.name, email: m.userAuthor.email }
                : null
              : {
                  id: m.conversation.user.id,
                  name: m.conversation.user.name,
                  email: m.conversation.user.email,
                },
        },
        // Misma forma que en el resto del módulo (serializeAttachment): el bot
        // baja el archivo por /api/chat/attachments/<id> con su propia llave,
        // no por un enlace de OneDrive.
        attachments: m.attachments.map(serializeAttachment),
      })),
    });
  } catch (error) {
    return serverError('GET /api/chat/agent/inbox', error);
  }
}
