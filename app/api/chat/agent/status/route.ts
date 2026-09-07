import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { assertAgentConversation, authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { MAX_STATUS_LABEL_CHARS, isAgentState } from '../../../../../lib/chat/constants';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * ESTADO DEL AGENTE — alimenta el indicador de "qué está haciendo".
 *
 *   POST /api/chat/agent/status
 *   Authorization: Bearer <llave del agente>
 *   { "idConversation": 12, "state": "tool", "label": "Consultando SAP…" }
 *
 * `state` es 'idle' | 'thinking' | 'tool'. `label` es el texto que ve el
 * usuario; se recorta al tope y se guarda tal cual (texto plano, no HTML).
 * Es un estado puntual que se sobrescribe: una sola fila por conversación
 * (la PK de chat_agent_status es id_conversation), no un histórico.
 *
 * El usuario lo lee por GET /api/chat/conversations/[id]/status y en cada
 * vuelta del sondeo.
 *
 * Seguridad: el agente sale de la llave; assertAgentConversation() verifica
 * que el hilo sea suyo antes de escribir. Un agente no puede mover el
 * indicador de una conversación de otro.
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

    if (!isAgentState(payload.state)) {
      return badRequest("state debe ser 'idle', 'thinking' o 'tool'.");
    }
    const state = payload.state;

    let label: string | null = null;
    if (payload.label !== undefined && payload.label !== null) {
      if (typeof payload.label !== 'string') return badRequest('label debe ser texto.');
      label = payload.label.trim().slice(0, MAX_STATUS_LABEL_CHARS) || null;
    }

    const status = await prisma.chatAgentStatus.upsert({
      where: { id_conversation: conversation.id },
      create: { id_conversation: conversation.id, state, label },
      update: { state, label },
    });

    return jsonNoStore({
      status: {
        idConversation: status.id_conversation,
        state: status.state,
        label: status.label,
        updatedAt: status.updated_at.toISOString(),
      },
    });
  } catch (error) {
    return serverError('POST /api/chat/agent/status', error);
  }
}
