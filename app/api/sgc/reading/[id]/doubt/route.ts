import { prisma } from '@/lib/prisma';
import { recordReadingDoubt } from '@/lib/sgc/db/dissemination';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/reading/<idCupo>/doubt — «NO ENTENDÍ» en la lectura
 * obligatoria: { body } con lo que la persona no entendió. Queda en el
 * historial de la solicitud y se avisa al creador y a Calidad. Solo la persona
 * asignada a esa lectura.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('solicitudAcceso', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await recordReadingDoubt(prisma, sgcNotifier, id, body, { email: ctx.email, access: ctx.access }, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'lectura:no-entendi');
  }
}
