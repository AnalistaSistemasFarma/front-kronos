import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { assertAgentProjectConversation, whereProyectoDelAgente } from '../../../../../../lib/chat/projects';
import { politicaParaPuente } from '../../../../../../lib/proyectos/permisos-agentes';

export const dynamic = 'force-dynamic';

/**
 * PERMISOS DE LOS AGENTES para el PUENTE DE HILOS (2026-10-20).
 *
 *   GET /api/chat/agent/projects/policy?idConversation=12   la de UN hilo (lo que pide el puente
 *                                                           al iniciar cada turno)
 *   GET /api/chat/agent/projects/policy                     la de CADA proyecto activo donde este
 *                                                           agente está designado
 *   Authorization: Bearer <llave del agente con scope "projects">
 *
 * Respuesta: { policy } o { policies: [...] } con PoliticaPuenteDto
 * (lib/proyectos/permisos-agentes-tipos.ts):
 *   - source 'bd': la escogió la administración en la pantalla; MANDA, incluso «ninguno»
 *     (así se revoca un acceso que venía del archivo manual).
 *   - source 'sin-politica': el proyecto no tiene fila; el puente sigue con su archivo
 *     repos-por-proyecto.json o, sin él, «ninguno».
 * Los repos desactivados en el catálogo no salen; un nivel con código sin repos baja a «ninguno».
 *
 * Solo con la llave del puente: la del bot vivo responde 404, igual que una conversación
 * que no es de un proyecto de ESTE agente. El id del agente sale de la llave.
 */
export async function GET(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'projects') return jsonNoStore({ error: 'No encontrado.' }, { status: 404 });

    const raw = request.nextUrl.searchParams.get('idConversation');
    if (raw !== null) {
      const idConversation = Number(raw);
      if (!Number.isInteger(idConversation) || idConversation <= 0) return badRequest('idConversation inválido.');
      const conv = await assertAgentProjectConversation(agent.idAgent, idConversation);
      if (!conv) return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
      return jsonNoStore({ policy: await politicaParaPuente(conv.idProject) });
    }

    const proyectos = await prisma.chatProject.findMany({
      where: whereProyectoDelAgente(agent.idAgent),
      select: { id_project: true },
      orderBy: { id_project: 'asc' },
      take: 500,
    });
    const policies = [];
    for (const p of proyectos) policies.push(await politicaParaPuente(p.id_project));
    return jsonNoStore({ policies });
  } catch (error) {
    return serverError('GET /api/chat/agent/projects/policy', error);
  }
}
