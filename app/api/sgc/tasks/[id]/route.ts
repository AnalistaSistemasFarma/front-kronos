import { prisma } from '@/lib/prisma';
import { getTaskDetail } from '@/lib/sgc/db/requests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/tasks/<id> — vista de la tarea documental (la solicitud con la tarea enfocada). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Tarea no encontrada' }, 404);
    return jsonNoStore(await getTaskDetail(prisma, id, { email: ctx.email, access: ctx.access }));
  } catch (error) {
    return errorResponse(error, 'tasks:detalle');
  }
}
