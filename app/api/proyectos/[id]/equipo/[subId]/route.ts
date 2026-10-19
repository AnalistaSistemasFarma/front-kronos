import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { actualizarSubagente } from '../../../../../../lib/proyectos/equipo';

export const dynamic = 'force-dynamic';

/**
 * PATCH { action?: 'aprobar' | 'descartar' | 'restaurar', name?, purpose?, instructions?, tools?, model? }
 * Aprueba, edita, descarta o restaura UN subagente. Solo el DUEÑO (el editor,
 * solo con PROYECTOS_EQUIPO_EDITOR_APRUEBA=1). Herramientas del catálogo
 * cerrado y que el perfil admita; todo queda en la auditoría inmutable.
 */
type Ctx = { params: Promise<{ id: string; subId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id, subId } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await actualizarSubagente(guard.user, guard.project, subId, payload);
    return jsonNoStore(r);
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('PATCH /api/proyectos/[id]/equipo/[subId]', error);
  }
}
