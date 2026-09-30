import { prisma } from '@/lib/prisma';
import { updateFlowProcess } from '@/lib/sgc/db/flows';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** PATCH /api/sgc/flows/<id> — nombre, descripción o activo del proceso (con `reason`). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canAdminFlows')) return jsonNoStore({ error: 'Sin permiso de administración de flujos' }, 403);
    return jsonNoStore({ process: await updateFlowProcess(prisma, idCompany, id, body as never, ctx.actor) });
  } catch (error) {
    return errorResponse(error, 'flows:editar');
  }
}
