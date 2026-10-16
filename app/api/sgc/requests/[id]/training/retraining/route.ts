import { prisma } from '@/lib/prisma';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { recordRetraining } from '@/lib/sgc/db/training';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/training/retraining { email, mode, sessionDate,
 * result, notes? } — Sprint 10: Calidad registra la RECAPACITACIÓN (presencial o
 * virtual) de quien no aprobó la evaluación en los intentos permitidos.
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
    return jsonNoStore(await recordRetraining(prisma, access, id, body, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'requests:recapacitacion');
  }
}
