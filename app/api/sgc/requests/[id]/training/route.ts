import { prisma } from '@/lib/prisma';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { saveTraining } from '@/lib/sgc/db/training';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/training — registra o ajusta la CAPACITACIÓN
 * (Calidad, paso de capacitación abierto): { mode, title, videoUrl,
 * formsUrl, sessionDate, instructor, maxScore, minScorePct, notes }.
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
    return jsonNoStore(await saveTraining(prisma, access, id, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:capacitacion');
  }
}
