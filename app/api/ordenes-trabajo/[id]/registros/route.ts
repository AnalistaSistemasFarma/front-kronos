import { prisma } from '../../../../../lib/prisma';
import { crearRegistro } from '../../../../../lib/ordenes-trabajo/db';
import { parseNuevoRegistro } from '../../../../../lib/ordenes-trabajo/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ordenes-trabajo/[id]/registros?company=1  { id_actividad, observacion? }
 * Registra una intervención. La hora la pone la base de datos y el usuario sale
 * de la sesión: cualquier hora o usuario que envíe el cliente se ignora.
 * No existe PUT ni DELETE: los registros no se editan ni se borran.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Orden no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const input = parseNuevoRegistro(await readJson(request));
    const registro = await crearRegistro(prisma, id, access, input, ctx.actor);
    return jsonNoStore({ registro }, 201);
  } catch (error) {
    return errorResponse(error, 'registro');
  }
}
