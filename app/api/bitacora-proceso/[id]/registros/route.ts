import { prisma } from '../../../../../lib/prisma';
import { crearRegistro } from '../../../../../lib/bitacora-proceso/db';
import { parseNuevoRegistro } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/registros?company=1  { id_operador, id_actividad, observacion? }
 * Registra una intervención (A1, A2: el operario elige su nombre y la actividad).
 * La hora la pone la base de datos; el usuario de la sesión se guarda aparte del
 * operario elegido. Cualquier hora o usuario que envíe el cliente se ignora.
 * No existe PUT ni DELETE: los registros no se editan ni se borran.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const input = parseNuevoRegistro(await readJson(request));
    const registro = await crearRegistro(prisma, id, access, input, ctx.actor);
    return jsonNoStore({ registro }, 201);
  } catch (error) {
    return errorResponse(error, 'registro');
  }
}
