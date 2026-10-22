import { concesionesDeHilo } from '../../../../../lib/correo/agente';
import { agentePort } from '../../../../../lib/correo/agenteRuntime';
import { agenteApagado, errorResponse, getCorreoContext, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/agente/compartidos?conversationId=<id> — accesos vigentes de SUS agentes a ese hilo. */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const apagado = agenteApagado();
    if (apagado) return apagado;
    const id = new URL(request.url).searchParams.get('conversationId') ?? '';
    return jsonNoStore({ compartidos: id ? await concesionesDeHilo(ctx.deps, agentePort(), ctx.acceso, id) : [] });
  } catch (error) {
    return errorResponse(error, 'agente-compartidos');
  }
}
