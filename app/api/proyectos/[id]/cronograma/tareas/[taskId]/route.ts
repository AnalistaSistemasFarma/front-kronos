import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../../lib/proyectos/acciones';
import { borrarTarea, editarTarea, historial } from '../../../../../../../lib/proyectos/cronograma';

export const dynamic = 'force-dynamic';

/**
 * UNA tarea del cronograma.
 *   GET    historial (quién la creó y quién la cambió, y qué). Cualquier miembro.
 *   PATCH  cambia los campos que vengan. Dueño y editores.
 *   DELETE la borra: el dueño cualquiera; un editor, solo las suyas. El historial queda.
 */
type Ctx = { params: Promise<{ id: string; taskId: string }> };

function idDe(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return String(n) === raw.trim() ? n : -1;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id, taskId } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const n = idDe(taskId);
    if (n <= 0) return jsonNoStore({ error: 'Tarea no encontrada.' }, { status: 404 });
    return jsonNoStore({ eventos: await historial(guard.project, 'tarea', n) });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/cronograma/tareas/[taskId]', error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id, taskId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await editarTarea(guard.user, guard.project, idDe(taskId), payload);
    return jsonNoStore(r);
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('PATCH /api/proyectos/[id]/cronograma/tareas/[taskId]', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { id, taskId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    await borrarTarea(guard.user, guard.project, idDe(taskId));
    return jsonNoStore({ removed: true });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('DELETE /api/proyectos/[id]/cronograma/tareas/[taskId]', error);
  }
}
