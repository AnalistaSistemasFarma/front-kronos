import { prisma } from '@/lib/prisma';
import { getFlowVersion, saveDraftDefinition } from '@/lib/sgc/db/flows';
import { companyAccess, configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/flows/versions/<id>?company=3 — definición de una versión.
 * PUT — guarda la definición completa de un BORRADOR ({ company, definition,
 * reason, changeReference? }); queda en el registro de cambios.
 */
export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).versionId);
    const idCompany = parseCompanyParam(request.url);
    if (!id || !idCompany) return jsonNoStore({ error: 'Petición inválida' }, 400);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso de administración de flujos' }, 403);
    return jsonNoStore(await getFlowVersion(prisma, idCompany, id));
  } catch (error) {
    return errorResponse(error, 'flows:version');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).versionId);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canAdminFlows')) return jsonNoStore({ error: 'Sin permiso de administración de flujos' }, 403);
    return jsonNoStore(await saveDraftDefinition(prisma, idCompany, id, body as never, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'flows:guardar');
  }
}
