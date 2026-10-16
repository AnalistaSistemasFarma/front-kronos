import { agentesDisponibles } from '../../../../../lib/correo/agente';
import { agentePort } from '../../../../../lib/correo/agenteRuntime';
import { errorResponse, getCorreoContext, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/agente/agentes — agentes del chat que la persona puede usar (los mismos del chat). */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    return jsonNoStore({ agentes: await agentesDisponibles(agentePort(), ctx.acceso) });
  } catch (error) {
    return errorResponse(error, 'agente-agentes');
  }
}
