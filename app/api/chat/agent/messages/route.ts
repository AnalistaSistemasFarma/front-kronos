import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { assertAgentConversation, authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { serializeMessage } from '../../../../../lib/chat/conversations';
import {
  MAX_AGENT_MESSAGE_CHARS,
  MAX_STATUS_LABEL_CHARS,
  isAgentState,
  normalizeMessageBody,
} from '../../../../../lib/chat/constants';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * RESPUESTA DEL AGENTE — publica un mensaje del agente en una conversación.
 *
 *   POST /api/chat/agent/messages
 *   Authorization: Bearer <llave del agente>
 *   { "idConversation": 12, "body": "…markdown…", "state": "idle", "label": null }
 *
 * `state`/`label` son opcionales: dejan el indicador de "qué está haciendo" en
 * el valor que corresponda al terminar de responder. Si no vienen, el estado
 * queda en 'idle' — responder ES terminar de trabajar, y dejar el indicador
 * colgado en "Pensando…" después de contestar sería un error visible para el
 * usuario.
 *
 * -------------------------------------------------------------------------
 * SEGURIDAD
 * -------------------------------------------------------------------------
 *  - El AGENTE sale de la LLAVE. El payload NO lleva ni puede llevar un
 *    id_agent: un bot no puede escribir haciéndose pasar por otro.
 *  - El `role` lo pone el servidor ('agent'). No se acepta del cliente.
 *  - assertAgentConversation() verifica que la conversación sea de ESTE agente
 *    antes de escribir nada (anti-IDOR del lado del bot). Si no lo es, 404: no
 *    se le confirma al bot que el hilo existe.
 *  - El body es Markdown crudo con tope de longitud; jamás HTML.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const conversation = await assertAgentConversation(agent.idAgent, Number(payload.idConversation));
    if (!conversation) {
      return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    const normalized = normalizeMessageBody(payload.body, MAX_AGENT_MESSAGE_CHARS);
    if (!normalized.ok) return badRequest(normalized.error);

    let state = 'idle';
    if (payload.state !== undefined && payload.state !== null) {
      if (!isAgentState(payload.state)) {
        return badRequest("state debe ser 'idle', 'thinking' o 'tool'.");
      }
      state = payload.state;
    }

    let label: string | null = null;
    if (payload.label !== undefined && payload.label !== null) {
      if (typeof payload.label !== 'string') return badRequest('label debe ser texto.');
      label = payload.label.trim().slice(0, MAX_STATUS_LABEL_CHARS) || null;
    }

    const now = new Date();

    // Transacción: el mensaje, la marca de la bandeja y el estado del indicador
    // son un solo hecho ("el agente respondió"). Si se aplicaran por separado,
    // un fallo intermedio dejaría al usuario viendo "Pensando…" con la
    // respuesta ya publicada, o al revés.
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          id_conversation: conversation.id,
          role: 'agent',
          body: normalized.body,
          created_at: now,
          // El agente escribe: su propio mensaje nace ya entregado.
          delivered_at: now,
        },
        include: { attachments: true },
      });

      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { last_message_at: now },
      });

      await tx.chatAgentStatus.upsert({
        where: { id_conversation: conversation.id },
        create: { id_conversation: conversation.id, state, label },
        update: { state, label },
      });

      return created;
    });

    return jsonNoStore({ message: serializeMessage(message) }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/agent/messages', error);
  }
}
