import { NextRequest } from 'next/server';
import { jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { crearConversacionProyecto, errorDeProyecto } from '../../../../../lib/proyectos/acciones';

export const dynamic = 'force-dynamic';

/**
 * NUEVA CONVERSACIÓN dentro de un proyecto, con UNO de sus agentes.
 *
 *   POST { agentCode, title? }  ->  { idConversation }
 *
 * Solo dueño o editor, y solo con un agente designado que la persona tenga
 * asignado en la empresa del proyecto (lib/chat/projects.ts, (d)–(f)). Cada
 * conversación es un hilo con SU sesión del modelo, que lleva el puente de
 * ESE agente con su plan y su token. Los mensajes van por las rutas de siempre
 * (/api/chat/conversations/[id]/…), cuya puerta reconoce kind = 'project'.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

    const payload = (await readJsonBody(request)) ?? {};
    const r = await crearConversacionProyecto(guard.user, guard.project, { agentCode: payload.agentCode, title: payload.title });
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/conversaciones', error);
  }
}
