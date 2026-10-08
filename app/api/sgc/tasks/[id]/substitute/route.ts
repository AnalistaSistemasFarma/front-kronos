import { prisma } from '@/lib/prisma';
import { assignSubstitute, requestOfTask } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/tasks/<id>/substitute — { idAssignee, toEmail, reason, absenceFrom?, absenceTo? }
 * Sprint 12: firmante SUSTITUTO de un cupo pendiente; solo el grupo exclusivo SGC-SUSTITUTOS (se valida en el servidor).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const { idCompany } = await requestOfTask(prisma, id);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Tarea no encontrada' }, 404);
    return jsonNoStore(await assignSubstitute(prisma, sgcNotifier, id, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'tasks:sustituto');
  }
}
