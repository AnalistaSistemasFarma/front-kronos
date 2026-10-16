import { prisma } from '../../../../../lib/prisma';
import { agregarOperadores } from '../../../../../lib/bitacora-proceso/db';
import { parseAgregarOperadores } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/operadores?company=1  { operadores: number[] }
 * El supervisor agrega operarios a una bitácora ABIERTA durante el turno (solo Gestión).
 * Solo se agregan: los operarios programados no se quitan (integridad).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const ids = parseAgregarOperadores(await readJson(request));
    const r = await agregarOperadores(prisma, id, access, ids, ctx.actor);
    return jsonNoStore(r);
  } catch (error) {
    return errorResponse(error, 'operadores-orden');
  }
}
