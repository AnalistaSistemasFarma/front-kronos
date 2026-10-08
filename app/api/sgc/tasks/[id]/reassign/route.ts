import { prisma } from '@/lib/prisma';
import { reassignTask, requestOfTask } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/tasks/<id>/reassign — { toEmail, reason } (tareas de un solo responsable). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const { idCompany } = await requestOfTask(prisma, id);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Tarea no encontrada' }, 404);
    return jsonNoStore(await reassignTask(prisma, sgcNotifier, access, id, body as never, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'tasks:reasignar');
  }
}
