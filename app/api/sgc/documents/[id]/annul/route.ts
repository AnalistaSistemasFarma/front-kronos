import { prisma } from '../../../../../../lib/prisma';
import { annulDocument } from '../../../../../../lib/sgc/db/documents';
import { errorResponse, getSgcRequestContext, jsonNoStore } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/documents/<id>/annul { reason } — anula el documento (solo Calidad; nada se borra). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
    const saved = await annulDocument(prisma, ctx.access, Number(id), body?.reason, ctx.actor);
    return jsonNoStore({ saved });
  } catch (error) {
    return errorResponse(error, 'documents:anulacion');
  }
}
