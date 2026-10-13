import { prisma } from '../../../../../lib/prisma';
import { cerrarOrden } from '../../../../../lib/ordenes-trabajo/db';
import { parseCierre } from '../../../../../lib/ordenes-trabajo/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/ordenes-trabajo/[id]/cerrar?company=1  { observacion? } — solo Gestión. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Orden no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const { observacion } = parseCierre(await readJson(request));
    await cerrarOrden(prisma, id, access, observacion, ctx.actor);
    return jsonNoStore({ ok: true });
  } catch (error) {
    return errorResponse(error, 'cerrar');
  }
}
