import { prisma } from '@/lib/prisma';
import { decideTask, requestOfTask } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/tasks/<id>/decision — { decision: 'aprobar' | 'devolver', comment }.
 * En Elaboración, «aprobar» es «enviar a revisión». Devolver exige observaciones.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const { idCompany } = await requestOfTask(prisma, id);
    if (!ctx.access.some((a) => a.idCompany === idCompany && a.canRead)) return jsonNoStore({ error: 'Tarea no encontrada' }, 404);
    return jsonNoStore(await decideTask(prisma, sgcNotifier, id, { decision: body.decision, comment: body.comment }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'tasks:decision');
  }
}
