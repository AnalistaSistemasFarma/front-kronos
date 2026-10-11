import { prisma } from '@/lib/prisma';
import { validateSignatureMaster } from '@/lib/sgc/db/signatures';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/signature/masters/<id>/validate — { company, reason }.
 * Sprint 13: Aseguramiento de Calidad VALIDA una firma propia pendiente (una vez; nunca la suya).
 * Para RECHAZARLA se revoca con motivo (…/revoke).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad valida las firmas' }, 403);
    return jsonNoStore(await validateSignatureMaster(prisma, idCompany, id, { reason: body.reason }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'firmas:maestro:validar');
  }
}
