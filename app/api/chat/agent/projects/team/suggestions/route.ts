import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, readJsonBody, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { errorDeProyecto } from '../../../../../../../lib/proyectos/acciones';
import { entregarSugerencia } from '../../../../../../../lib/proyectos/equipo';

export const dynamic = 'force-dynamic';

/**
 * ENTREGA DE UNA SUGERENCIA DE EQUIPO (puente de hilos, F2).
 *
 *   POST /api/chat/agent/projects/team/suggestions
 *   { idRequest, items: [{ name, purpose, instructions, tools, model }], tokens?, models? }
 *   o { idRequest, error }
 *
 * Entrada NO confiable (la escribió un modelo): se valida contra el catálogo
 * cerrado y el perfil del proyecto. Los subagentes quedan PROPUESTOS; nada
 * llega al proceso del modelo hasta que el dueño los aprueba.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'projects') return jsonNoStore({ error: 'No encontrado.' }, { status: 404 });
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await entregarSugerencia({ idAgent: agent.idAgent, code: agent.code }, payload);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/chat/agent/projects/team/suggestions', error);
  }
}
