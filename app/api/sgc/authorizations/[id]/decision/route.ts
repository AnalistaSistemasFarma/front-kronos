import { prisma } from '@/lib/prisma';
import { decideTask, taskOfAuthorization } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/authorizations/<id>/decision — { decision: 'autorizar' | 'rechazar', comment }.
 * Autorizar = aprobar el cupo en su tarea; rechazar = devolver a elaboración
 * (con observaciones obligatorias). Se decide con el MISMO motor de la tarea.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const decision = body.decision === 'autorizar' ? 'aprobar' : body.decision === 'rechazar' ? 'devolver' : null;
    if (!decision) return jsonNoStore({ error: 'Decisión inválida: autorizar o rechazar' }, 400);
    const target = await taskOfAuthorization(prisma, id);
    if (!ctx.access.some((a) => a.idCompany === target.idCompany && a.canRead)) return jsonNoStore({ error: 'Autorización no encontrada' }, 404);
    const result = await decideTask(prisma, sgcNotifier, target.idTask, { decision, comment: body.comment, idAssignee: target.idAssignee }, ctx.actor);
    return jsonNoStore(result);
  } catch (error) {
    return errorResponse(error, 'authorizations:decision');
  }
}
