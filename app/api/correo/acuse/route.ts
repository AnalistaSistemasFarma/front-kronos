import { enviarAcuse } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

const GRAPH_ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;

/**
 * POST /api/correo/acuse { conversationId, todos, confirmarExterno } — «Reintentar respuesta»:
 * vuelve a intentar el acuse automático de un hilo YA vinculado del usuario de la sesión.
 * Idempotente: si ya se envió para esa solicitud y ese hilo, responde YA_ENVIADO sin reenviar.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'envio');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const conversationId = String(body?.conversationId ?? '');
    if (!GRAPH_ID_RE.test(conversationId)) return jsonNoStore({ error: 'Hilo inválido.' }, 400);
    const acuse = await enviarAcuse(ctx.deps, ctx.acceso, {
      conversationId,
      todos: body?.todos === true,
      confirmarExterno: body?.confirmarExterno === true,
      ip: ctx.ip,
    });
    return jsonNoStore({ acuse });
  } catch (error) {
    return errorResponse(error, 'acuse');
  }
}
