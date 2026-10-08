import { prisma } from '@/lib/prisma';
import { revokeApproverAuthorization } from '@/lib/sgc/db/approvers';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/approvers/<id>/revoke { company, reason } — revoca una autorización de aprobador (solo Calidad; no se borra). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!id || !body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await revokeApproverAuthorization(prisma, companyAccess(ctx, idCompany) ?? null, id, body as { reason?: unknown }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'aprobadores:revocar');
  }
}
