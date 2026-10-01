import { prisma } from '@/lib/prisma';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { uploadTrainingResults } from '@/lib/sgc/db/training';
import { uploadToSgcStorage } from '@/lib/sgc/onedrive';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, uploadGuard } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/training/results (multipart: file) — carga el
 * Excel de resultados de la evaluación de Microsoft Forms (Calidad). Se
 * evalúa contra el alcance y la nota mínima y queda en
 * SGC/<EMPRESA>/_capacitacion/SOL-<id>/ con su SHA-256.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const guard = uploadGuard(request, ctx);
    if (guard) return guard;
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!id || !form || !(file instanceof File)) return jsonNoStore({ error: 'Se esperaba el Excel de resultados' }, 400);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    const result = await uploadTrainingResults(prisma, uploadToSgcStorage, access, id, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, ctx.actor);
    return jsonNoStore(result, 201);
  } catch (error) {
    return errorResponse(error, 'requests:capacitacion-resultados');
  }
}
