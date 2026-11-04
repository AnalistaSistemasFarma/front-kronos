import { NextRequest } from 'next/server';
import { jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../lib/proyectos/acciones';
import { crearMesa, listarMesas } from '../../../../../lib/proyectos/mesas';

export const dynamic = 'force-dynamic';

/**
 * MESAS DE DISCUSIÓN de un proyecto (2026-11-04, docs/proyectos-mesas-discusion.md).
 *
 *   GET                                   -> { mesas }      (cualquier miembro)
 *   POST { tema, participantes: [{ idAgent, rol }], idAgentModerador, reglas? }
 *                                         -> { idMesa, idConversation }   (dueño o editor)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    return jsonNoStore({ mesas: await listarMesas(guard.project) });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/mesas', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const payload = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
    return jsonNoStore(await crearMesa(guard.user, guard.project, payload), { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/mesas', error);
  }
}
