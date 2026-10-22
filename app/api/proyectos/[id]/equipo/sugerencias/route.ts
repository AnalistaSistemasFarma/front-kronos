import { NextRequest } from 'next/server';
import { jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { pedirSugerencia } from '../../../../../../lib/proyectos/equipo';

export const dynamic = 'force-dynamic';

/**
 * POST { agentCode? } — «Sugerir equipo». Deja un pedido que atiende el puente
 * de hilos del asistente (consume de SU plan): dueño y editor, con un
 * asistente del proyecto que la persona tenga asignado. Un solo pedido abierto
 * por proyecto y máximo 10 al día. Los subagentes llegan PROPUESTOS.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const payload = (await readJsonBody(request)) ?? {};
    const r = await pedirSugerencia(guard.user, guard.project, { agentCode: payload.agentCode });
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/equipo/sugerencias', error);
  }
}
