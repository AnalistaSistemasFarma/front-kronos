import { prisma } from '@/lib/prisma';
import { taskOfAuthorization } from '@/lib/sgc/db/requests';
import { signTask } from '@/lib/sgc/db/signatures';
import { sgcSignatureDeps } from '@/lib/sgc/signature/deps';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/authorizations/<id>/sign — AUTORIZAR firmando (firma
 * electrónica propia del SGC, con reautenticación y motivo). Decide el cupo
 * exacto de la autorización con el mismo motor de la tarea. Rechazar sigue
 * por /decision (devolver con observaciones, sin firma).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const target = await taskOfAuthorization(prisma, id);
    if (!ctx.access.some((a) => a.idCompany === target.idCompany && a.canRead)) return jsonNoStore({ error: 'Autorización no encontrada' }, 404);
    const result = await signTask(prisma, sgcSignatureDeps(), target.idTask, { ...body, idAssignee: target.idAssignee }, ctx.actor);
    return jsonNoStore(result);
  } catch (error) {
    return errorResponse(error, 'authorizations:firmar');
  }
}
