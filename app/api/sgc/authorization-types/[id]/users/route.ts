import { prisma } from '@/lib/prisma';
import { grantAuthorizationTypeUser } from '@/lib/sgc/db/authorizations';
import { configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/authorization-types/<id>/users — agrega una persona al grupo del tipo ({ company, email, reason }). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso para configurar autorizaciones' }, 403);
    return jsonNoStore(await grantAuthorizationTypeUser(prisma, idCompany, id, body as never, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'authorization-types:grupo');
  }
}
