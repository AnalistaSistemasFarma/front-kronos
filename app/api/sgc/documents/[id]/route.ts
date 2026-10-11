import { prisma } from '../../../../../lib/prisma';
import { getDocumentDetail, updateDocumentMetadata } from '../../../../../lib/sgc/db/documents';
import { errorResponse, getSgcRequestContext, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/documents/<id> — ficha del documento con su historial de
 * versiones y los permisos de la persona. 404 si no existe o no lo puede
 * consultar (no se revela su existencia).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;
    const detail = await getDocumentDetail(prisma, ctx.access, ctx.subject, Number(id));
    if (!detail) return jsonNoStore({ error: 'Documento no encontrado' }, 404);
    return jsonNoStore(detail);
  } catch (error) {
    return errorResponse(error, 'documents:detalle');
  }
}

/** PATCH /api/sgc/documents/<id> — título, confidencialidad o dueño, con motivo (solo Calidad). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const saved = await updateDocumentMetadata(prisma, ctx.access, Number(id), body, ctx.actor);
    return jsonNoStore({ saved });
  } catch (error) {
    return errorResponse(error, 'documents:edicion');
  }
}
