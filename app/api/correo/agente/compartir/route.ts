import { compartirConAgente } from '../../../../../lib/correo/agente';
import { agentePort } from '../../../../../lib/correo/agenteRuntime';
import { readClientOrigin } from '../../../../../lib/sgc/clientOrigin';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/agente/compartir { conversationId, idAgent, pregunta? } — comparte el hilo
 * de SU buzón con uno de SUS agentes del chat por 24 h y deja el contexto en el chat directo.
 * El buzón sale de la sesión; el permiso sobre el agente es el del chat.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const r = await compartirConAgente(ctx.deps, agentePort(), ctx.acceso, {
      conversationId: String(body?.conversationId ?? ''),
      idAgent: Number(body?.idAgent),
      pregunta: typeof body?.pregunta === 'string' ? body.pregunta : null,
      ip: ctx.ip,
      userAgent: readClientOrigin(request).userAgent,
    });
    return jsonNoStore(r, 201);
  } catch (error) {
    return errorResponse(error, 'agente-compartir');
  }
}
