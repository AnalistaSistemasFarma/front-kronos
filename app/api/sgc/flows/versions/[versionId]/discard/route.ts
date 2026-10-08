import { prisma } from '@/lib/prisma';
import { discardDraftVersion } from '@/lib/sgc/db/flows';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/flows/versions/<id>/discard — descarta un BORRADOR nunca publicado. Exige `reason`. */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).versionId);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canAdminFlows')) return jsonNoStore({ error: 'Sin permiso de administración de flujos' }, 403);
    return jsonNoStore(await discardDraftVersion(prisma, idCompany, id, body as never, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'flows:discard');
  }
}
