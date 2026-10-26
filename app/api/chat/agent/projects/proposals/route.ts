import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, readJsonBody, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { assertAgentProjectConversation } from '../../../../../../lib/chat/projects';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { crearPropuestasDelPuente } from '../../../../../../lib/proyectos/propuestas';

export const dynamic = 'force-dynamic';

/**
 * PROPUESTAS DEL PUENTE DE HILOS (cronograma, 2026-10-18).
 *
 *   POST /api/chat/agent/projects/proposals
 *   Authorization: Bearer <llave del agente con scope "projects">
 *   { idConversation, items: [{ kind: 'tarea_crear' | 'tarea_editar', ... }] }
 *
 * El modelo de una conversación del proyecto escribe sus propuestas en
 * ./trabajo/propuestas-cronograma.json; el PUENTE las lee y las entrega aquí con
 * su llave (el modelo nunca la ve). Solo tareas, y NADA se ejecuta: quedan
 * pendientes hasta que un dueño o editor las confirme en el Cronograma.
 * Solo la llave del puente y solo conversaciones de proyectos donde ESTE agente
 * está designado; si no, 404.
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
    const r = await crearPropuestasDelPuente({ id: conv.id, idProject: conv.idProject }, agent.idAgent, payload.items);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/chat/agent/projects/proposals', error);
  }
}
