import { prepararSolicitud } from '../../../../../../../lib/correo/agente';
import { agentePort } from '../../../../../../../lib/correo/agenteRuntime';
import { empresaParam, errorResponse, getCorreoContext, jsonNoStore } from '../../../../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/agente/acciones/<id>/preparar[?empresa=] — datos para revisar la solicitud propuesta (misma simulación del Correo). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;
    return jsonNoStore(await prepararSolicitud(ctx.deps, agentePort(), ctx.acceso, Number(id), empresaParam(request.url), ctx.ip));
  } catch (error) {
    return errorResponse(error, 'agente-preparar');
  }
}
