import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, readJsonBody, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { assertAgentProjectConversation } from '../../../../../../../lib/chat/projects';
import { registrarCorridas } from '../../../../../../../lib/proyectos/equipo';

export const dynamic = 'force-dynamic';

/**
 * LO QUE HIZO CADA SUBAGENTE EN UN TURNO (puente de hilos, F2).
 *
 *   POST /api/chat/agent/projects/team/runs
 *   { idConversation, sessionId, turnStartedAt, blocked?: string[],
 *     runs: [{ slug, description, status, startedAt, endedAt, durationMs, totalTokens, toolUses, model }] }
 *
 * Como el consumo (/api/chat/agent/usage), es un dato DECLARADO por el
 * puente: sirve para ver qué hizo cada subagente y cuánto consumió, no como
 * prueba contra el agente. Solo conversaciones de proyecto de ESTE agente.
 * Un `blocked` (el vigía detuvo el turno) queda en la auditoría inmutable.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'projects') return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const conv = await assertAgentProjectConversation(agent.idAgent, payload.idConversation);
    if (!conv) return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    const r = await registrarCorridas({ idAgent: agent.idAgent }, { id: conv.id, idProject: conv.idProject }, payload);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/agent/projects/team/runs', error);
  }
}
