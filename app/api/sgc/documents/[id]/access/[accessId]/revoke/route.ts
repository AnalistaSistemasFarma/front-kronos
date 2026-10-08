import { prisma } from '../../../../../../../../lib/prisma';
import { revokeDocumentAccess } from '../../../../../../../../lib/sgc/db/documents';
import { errorResponse, getSgcRequestContext, jsonNoStore } from '../../../../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/documents/<id>/access/<accessId>/revoke { reason } — revoca un acceso (solo Calidad). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; accessId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { id, accessId } = await params;
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
    const saved = await revokeDocumentAccess(prisma, ctx.access, Number(id), Number(accessId), body?.reason, ctx.actor);
    return jsonNoStore({ saved });
  } catch (error) {
    return errorResponse(error, 'documents:revocacion');
  }
}
