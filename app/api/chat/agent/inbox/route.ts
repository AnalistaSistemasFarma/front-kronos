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
 * BANDEJA DEL AGENTE — los mensajes del usuario que este agente todavía no ha
 * recogido.
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

    const fetchPending = () =>
      prisma.chatMessage.findMany({
        where: {
          role: 'user',
          delivered_at: null,
          // ANCLA DE SEGURIDAD: solo hilos de ESTE agente.
          conversation: { id_agent: agent.idAgent },
        },
        orderBy: { id: 'asc' },
        take: limit,
        include: {
          attachments: true,
          conversation: {
            select: {
              id: true,
              title: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });

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
      await prisma.chatMessage.updateMany({
        where: { id: { in: pending.map((m) => m.id) }, delivered_at: null },
        data: { delivered_at: new Date() },
      });
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
        conversation: {
          id: m.conversation.id,
          title: m.conversation.title,
          user: {
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
