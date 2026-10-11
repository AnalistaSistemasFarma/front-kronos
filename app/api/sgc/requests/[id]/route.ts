import { prisma } from '@/lib/prisma';
import { getRequestDetail } from '@/lib/sgc/db/requests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/requests/<id> — vista interna de la solicitud documental (solo involucrados o Calidad; si no, 404). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await getRequestDetail(prisma, id, { email: ctx.email, access: ctx.access }));
  } catch (error) {
    return errorResponse(error, 'requests:detalle');
  }
}
