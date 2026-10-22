import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../../../lib/chat/agent-auth';
import { jsonNoStore, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { reclamarPedidos } from '../../../../../../../lib/proyectos/equipo';

export const dynamic = 'force-dynamic';

/**
 * PEDIDOS DE «SUGERIR EQUIPO» para el PUENTE DE HILOS (F2, 2026-10-18).
 *
 *   POST /api/chat/agent/projects/team/requests
 *   Authorization: Bearer <llave del agente con scope "projects">
 *
 * Reclama (pasa a 'en_curso') hasta 3 pedidos pendientes de proyectos ACTIVOS
 * donde ESTE agente está designado, y devuelve la ficha de cada proyecto: lo
 * mismo que ven los miembros (nombres, asuntos y títulos; nunca el cuerpo de
 * un correo). Es POST porque cambia el estado del pedido.
 * Solo la llave del puente: la del bot vivo recibe 404.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'projects') return jsonNoStore({ error: 'No encontrado.' }, { status: 404 });
    const requests = await reclamarPedidos({ idAgent: agent.idAgent, code: agent.code });
    return jsonNoStore({ requests });
  } catch (error) {
    return serverError('POST /api/chat/agent/projects/team/requests', error);
  }
}
