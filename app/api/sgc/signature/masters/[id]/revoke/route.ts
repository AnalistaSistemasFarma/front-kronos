import { prisma } from '@/lib/prisma';
import { revokeSignatureMaster } from '@/lib/sgc/db/signatures';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/signature/masters/<id>/revoke — { company, reason }. No se borra: se revoca con motivo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad administra el maestro de firmas' }, 403);
    return jsonNoStore(await revokeSignatureMaster(prisma, idCompany, id, { reason: body.reason }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'firmas:maestro:revocar');
  }
}
