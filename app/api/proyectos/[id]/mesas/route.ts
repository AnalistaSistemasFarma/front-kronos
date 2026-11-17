import { NextRequest } from 'next/server';
import { jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../lib/proyectos/acciones';
import { candidatosMesa, crearMesa, listarMesas } from '../../../../../lib/proyectos/mesas';
import { politicaGuardadaConCodigo } from '../../../../../lib/proyectos/permisos-agentes';

export const dynamic = 'force-dynamic';

/**
 * MESAS DE DISCUSIÓN de un proyecto (2026-11-04, docs/proyectos-mesas-discusion.md).
 *
 *   GET                                   -> { mesas }      (cualquier miembro)
 *   GET ?candidatos=1                     -> { candidatos, conCodigo }  agentes que la persona puede poner
 *                                            en una mesa; conCodigo = el proyecto tiene acceso a código
 *   POST { tema, participantes: [{ idAgent, rol }], idAgentModerador, reglas? }
 *                                         -> { idMesa, idConversation, avisos }   (dueño o editor)
 *
 * La mesa NO depende de que el proyecto sea de desarrollo (2026-11-11): un agente de negocio
 * participa sin acceso al código; `avisos` lo informa, no bloquea.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    if (request.nextUrl.searchParams.get('candidatos') === '1') {
      const [candidatos, conCodigo] = await Promise.all([
        candidatosMesa(guard.user, guard.project),
        politicaGuardadaConCodigo(guard.project.idProject).catch(() => false),
      ]);
      return jsonNoStore({ candidatos, conCodigo });
    }
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
