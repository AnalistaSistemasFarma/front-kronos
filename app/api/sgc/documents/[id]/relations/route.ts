import { prisma } from '@/lib/prisma';
import { listDocumentRelations } from '@/lib/sgc/db/relations';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/documents/<id>/relations — relaciones del documento hacia lo que la persona puede consultar (404 si no lo puede ver). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Documento no encontrado' }, 404);
    const relations = await listDocumentRelations(prisma, ctx.access, ctx.subject, id);
    if (!relations) return jsonNoStore({ error: 'Documento no encontrado' }, 404);
    return jsonNoStore({ relations });
  } catch (error) {
    return errorResponse(error, 'documents:relaciones');
  }
}
