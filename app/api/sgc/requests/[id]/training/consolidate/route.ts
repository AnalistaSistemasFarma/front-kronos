import { prisma } from '@/lib/prisma';
import { consolidateEvaluation } from '@/lib/sgc/db/evaluation';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { uploadToSgcStorage } from '@/lib/sgc/onedrive';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/training/consolidate — CONSOLIDA los resultados
 * de la evaluación en SynerLink (S18, R30): genera el Excel de resultados
 * (reporte para la auditoría, con su huella) y lo registra como la carga de
 * resultados vigente; luego se cierra con la firma «Capacitó», sin cargar un Excel.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await consolidateEvaluation(prisma, uploadToSgcStorage, access, id, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'evaluacion:consolidar');
  }
}
