import { prisma } from '@/lib/prisma';
import { revokeAuthorizationTypeUser } from '@/lib/sgc/db/authorizations';
import { configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/authorization-types/users/<id>/revoke — retira a la persona del grupo (no se borra), con `reason`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso para configurar autorizaciones' }, 403);
    return jsonNoStore(await revokeAuthorizationTypeUser(prisma, idCompany, id, body as never, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'authorization-types:retirar');
  }
}
