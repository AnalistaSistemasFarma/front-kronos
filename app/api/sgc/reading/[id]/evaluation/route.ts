import { prisma } from '@/lib/prisma';
import { getReaderEvaluation, submitEvaluationAttempt } from '@/lib/sgc/db/evaluation';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * EVALUACIÓN EN SYNERLINK del lector (S17–S18, R30), después de firmar su lectura.
 * GET  /api/sgc/reading/<idCupo>/evaluation — las preguntas SIN respuestas correctas, sus intentos y si puede presentar.
 * POST /api/sgc/reading/<idCupo>/evaluation { answers: { [idPregunta]: idOpción | idOpción[] } } — presenta un intento:
 *      se califica en el servidor y queda inmutable con su huella. Solo la persona de esa lectura.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Lectura no encontrada' }, 404);
    return jsonNoStore(await getReaderEvaluation(prisma, id, { email: ctx.email }));
  } catch (error) {
    return errorResponse(error, 'evaluacion:ver');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await submitEvaluationAttempt(prisma, id, body, { email: ctx.email }, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'evaluacion:intento');
  }
}
