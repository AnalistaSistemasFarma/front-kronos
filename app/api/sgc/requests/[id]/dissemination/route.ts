import { prisma } from '@/lib/prisma';
import { addScopeEntry, removeScopeEntry, sendReadingReminders } from '@/lib/sgc/db/dissemination';
import { closeDissemination, companyOfRequest, excludeReader } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/dissemination — DIVULGACIÓN (Sprint 4):
 *   { action: 'agregar', entry: { kind, idDepartment | idCargo | email }, reason }
 *   { action: 'retirar', idScope, reason }          (solo antes de la divulgación)
 *   { action: 'recordatorio' }                      (Calidad)
 *   { action: 'excluir', idReadRecord, reason }     (Calidad, justificación ≥ 10)
 *   { action: 'cerrar', reason }                    (Calidad, justificación ≥ 10)
 * Todo queda en el historial de la solicitud y en la auditoría.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    switch (body.action) {
      case 'agregar':
        return jsonNoStore(await addScopeEntry(prisma, sgcNotifier, access, id, body, ctx.actor), 201);
      case 'retirar':
        return jsonNoStore(await removeScopeEntry(prisma, access, id, Number(body.idScope), body, ctx.actor));
      case 'recordatorio':
        return jsonNoStore(await sendReadingReminders(prisma, sgcNotifier, access, id, ctx.actor));
      case 'excluir':
        return jsonNoStore(await excludeReader(prisma, sgcNotifier, access, id, Number(body.idReadRecord), { reason: body.reason }, ctx.actor));
      case 'cerrar':
        return jsonNoStore(await closeDissemination(prisma, sgcNotifier, access, id, { reason: body.reason }, ctx.actor));
      default:
        return jsonNoStore({ error: 'Acción inválida' }, 400);
    }
  } catch (error) {
    return errorResponse(error, 'requests:divulgacion');
  }
}
