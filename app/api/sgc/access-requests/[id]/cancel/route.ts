import { prisma } from '@/lib/prisma';
import { cancelAccessRequest } from '@/lib/sgc/db/accessRequests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/access-requests/<id>/cancel — quien la pidió cancela su solicitud pendiente. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    return jsonNoStore(await cancelAccessRequest(prisma, ctx.access, id, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'accesos:cancelar');
  }
}
