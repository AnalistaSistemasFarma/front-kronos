import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../lib/proyectos/acciones';
import { configurarEquipo, equipoDelProyecto } from '../../../../../lib/proyectos/equipo';

export const dynamic = 'force-dynamic';

/**
 * EQUIPO DE SUBAGENTES de un proyecto (F2, 2026-10-18).
 *
 *   GET    el equipo (propuestos, aprobados y descartados), el pedido de
 *          sugerencia más reciente, lo que hizo cada subagente y su consumo.
 *          Cualquier miembro (un archivado, solo su dueño).
 *   PATCH  { enabled?, maxParallel? } encender/apagar el equipo y el tope de
 *          subagentes a la vez (1 a 5). Solo el DUEÑO.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const team = await equipoDelProyecto(guard.user, guard.project);
    return jsonNoStore({ team });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/equipo', error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    await configurarEquipo(guard.user, guard.project, payload);
    return jsonNoStore({ ok: true });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('PATCH /api/proyectos/[id]/equipo', error);
  }
}
