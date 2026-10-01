import { prisma } from '@/lib/prisma';
import { recordReadingEvent } from '@/lib/sgc/db/dissemination';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/reading/<idCupo>/progress — avance de la LECTURA OBLIGATORIA
 * que informa el visor: { event: 'final', pages } cuando la persona llegó al
 * final del documento. Solo la persona asignada; exige haber abierto el PDF
 * desde el servidor. Es la condición para firmar «Leído».
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await recordReadingEvent(prisma, id, body, { email: ctx.email, access: ctx.access }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'lectura:avance');
  }
}
