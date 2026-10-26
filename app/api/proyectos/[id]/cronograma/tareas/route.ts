import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { crearTarea } from '../../../../../../lib/proyectos/cronograma';

export const dynamic = 'force-dynamic';

/**
 * POST { title, description?, idResponsible?, startDate, endDate?, status?, progress?, isMilestone? }
 * Crea una tarea del cronograma. Solo dueño y editores (403 para el lector).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await crearTarea(guard.user, guard.project, payload);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/cronograma/tareas', error);
  }
}
