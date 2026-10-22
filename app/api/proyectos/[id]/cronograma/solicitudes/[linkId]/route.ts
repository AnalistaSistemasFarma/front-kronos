import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../../lib/proyectos/acciones';
import { fijarFechaObjetivo } from '../../../../../../../lib/proyectos/cronograma';

export const dynamic = 'force-dynamic';

/**
 * PATCH { targetDate: 'AAAA-MM-DD' | null } — fecha OBJETIVO de una solicitud
 * vinculada (el «vencimiento» del cronograma). Dueño y editores. El caso no
 * cambia en SynerLink.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  try {
    const { id, linkId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    if (!payload || !('targetDate' in payload)) return badRequest('Debe indicar targetDate (AAAA-MM-DD o null).');
    const n = Number.parseInt(linkId, 10);
    await fijarFechaObjetivo(guard.user, guard.project, String(n) === linkId.trim() ? n : -1, payload.targetDate);
    return jsonNoStore({ updated: true });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('PATCH /api/proyectos/[id]/cronograma/solicitudes/[linkId]', error);
  }
}
