import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { authenticateAgent, resolveAgentConversation } from '../../../../../lib/chat/agent-auth';
import { MAX_STATUS_LABEL_CHARS, isAgentState } from '../../../../../lib/chat/constants';
import { normalizeAgentTasks, parseAgentTasks } from '../../../../../lib/chat/status-tasks';
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
 *
 * `tasks` es OPCIONAL y lleva el desglose de sub-agentes en curso, que la
 * interfaz pinta como una tabla:
 *   { "tasks": [{ "desc": "Muestra de phishing", "startedAt": 1788786955 }] }
 * `startedAt` admite ISO, milisegundos o segundos epoch (el hook de bash usa
 * segundos). Omitir `tasks` DEJA la lista como estaba; mandar `null` o `[]` la
 * borra — así un `pre` que no sepa de sub-agentes no pisa lo que otro publicó,
 * pero el cierre del turno sí limpia.
 * Es un estado puntual que se sobrescribe: una sola fila por conversación Y
 * AGENTE (la PK de chat_agent_status es (id_conversation, id_agent)), no un
 * histórico. En un grupo cada agente mueve su propio indicador y los demás no
 * se enteran, que es exactamente lo que hay que ver cuando tres están
 * trabajando a la vez.
 *
 * El usuario lo lee por GET /api/chat/conversations/[id]/status y en cada
 * vuelta del sondeo.
 *
 * Seguridad: el agente sale de la llave; resolveAgentConversation() verifica
 * que el hilo sea suyo —o que el agente sea integrante del grupo— antes de
 * escribir. Un agente no puede mover el indicador de una conversación en la
 * que no está, ni el indicador de OTRO agente: la fila que se escribe lleva su
 * propio id, tomado de la llave.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const conversation = await resolveAgentConversation(agent.idAgent, Number(payload.idConversation));
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

    // Omitido = no se toca. Presente (incluso null o []) = se reemplaza.
    let tasksColumn: string | null | undefined;
    if (payload.tasks !== undefined) {
      const tasks = normalizeAgentTasks(payload.tasks);
      if (tasks === undefined) return badRequest('tasks debe ser una lista.');
      tasksColumn = tasks ? JSON.stringify(tasks) : null;
    }

    const status = await prisma.chatAgentStatus.upsert({
      where: {
        id_conversation_id_agent: { id_conversation: conversation.id, id_agent: agent.idAgent },
      },
      create: {
        id_conversation: conversation.id,
        id_agent: agent.idAgent,
        state,
        label,
        tasks: tasksColumn ?? null,
      },
      update: { state, label, ...(tasksColumn !== undefined ? { tasks: tasksColumn } : {}) },
    });

    return jsonNoStore({
      status: {
        idConversation: status.id_conversation,
        idAgent: status.id_agent,
        state: status.state,
        label: status.label,
        tasks: parseAgentTasks(status.tasks),
        updatedAt: status.updated_at.toISOString(),
      },
    });
  } catch (error) {
    return serverError('POST /api/chat/agent/status', error);
  }
}
