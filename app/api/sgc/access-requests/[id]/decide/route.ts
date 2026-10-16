import { prisma } from '@/lib/prisma';
import { decideAccessRequest } from '@/lib/sgc/db/accessRequests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/access-requests/<id>/decide { decision: aprobar|rechazar, reason, expiresAt? } — Calidad decide. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    return jsonNoStore(await decideAccessRequest(prisma, sgcNotifier, ctx.access, id, { decision: body.decision, reason: body.reason, expiresAt: body.expiresAt }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'accesos:decidir');
  }
}
