import { prisma } from '../../../../../lib/prisma';
import { cambiarPlanta } from '../../../../../lib/bitacora-proceso/db';
import { parseCambioPlanta } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/planta?company=1  { planta: 1 | 2 } — asigna o corrige la planta de
 * una bitácora ABIERTA (2026-11-26: las vivas se abrieron antes de que existiera la planta). Queda
 * quién y cuándo. Una cerrada no cambia (409).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const { planta } = parseCambioPlanta(await readJson(request));
    const r = await cambiarPlanta(prisma, id, access, planta, ctx.actor);
    return jsonNoStore({ planta: r });
  } catch (error) {
    return errorResponse(error, 'planta');
  }
}
