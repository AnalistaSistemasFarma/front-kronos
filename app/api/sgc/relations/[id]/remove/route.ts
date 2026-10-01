import { prisma } from '@/lib/prisma';
import { removeDocumentRelation } from '@/lib/sgc/db/relations';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/relations/<id>/remove { reason } — Calidad retira una relación (no se borra). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Relación inválida' }, 400);
    const body = await readJson(request);
    return jsonNoStore({ saved: await removeDocumentRelation(prisma, ctx.access, id, body?.reason, ctx.actor) });
  } catch (error) {
    return errorResponse(error, 'relaciones:retirar');
  }
}
