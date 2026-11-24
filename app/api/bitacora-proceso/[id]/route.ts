import { prisma } from '../../../../lib/prisma';
import { getOrdenDetalle } from '../../../../lib/bitacora-proceso/db';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/bitacora-proceso/[id]?company=1 — detalle con su cronología (también sirve al informe). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const orden = await getOrdenDetalle(prisma, id, access, ctx.actor.idUser);
    if (!orden) return jsonNoStore({ error: 'Bitácora no encontrada' }, 404);
    // ahoraServidor: reloj vivo de planta (2026-11-24); el cliente calcula el desfase de su equipo.
    return jsonNoStore({ orden, ahoraServidor: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error, 'detail');
  }
}
