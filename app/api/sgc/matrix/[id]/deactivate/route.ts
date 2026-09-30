import { prisma } from '@/lib/prisma';
import { deactivateMatrixEntry } from '@/lib/sgc/db/matrix';
import { configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/matrix/<id>/deactivate — desactiva una fila (no se borra), con `reason`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Solo la administración de flujos o Calidad editan la matriz' }, 403);
    return jsonNoStore(await deactivateMatrixEntry(prisma, idCompany, id, body as never, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'matrix:desactivar');
  }
}
