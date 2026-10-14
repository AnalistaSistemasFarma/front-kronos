import { prisma } from '@/lib/prisma';
import { getEvaluationEditor, saveQuestionBank } from '@/lib/sgc/db/evaluation';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * BANCO DE PREGUNTAS de la evaluación en SynerLink (S17, R30): lo arma el
 * creador del documento o Aseguramiento de Calidad (con las respuestas
 * correctas). Con intentos presentados queda congelado.
 * GET  /api/sgc/requests/<id>/training/evaluation
 * PUT  /api/sgc/requests/<id>/training/evaluation { questions: [{ kind, text, points, options: [{ text, correct }] | correct }] }
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await getEvaluationEditor(prisma, access, id, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'evaluacion:banco');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await saveQuestionBank(prisma, access, id, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'evaluacion:banco-guardar');
  }
}
