import { prisma } from '@/lib/prisma';
import { cancelRequest, companyOfRequest } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/requests/<id>/cancel — cancela la solicitud (acción, no paso), con `reason`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await cancelRequest(prisma, sgcNotifier, access, id, body as never, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:cancelar');
  }
}
