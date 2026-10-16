import { marcarLeidoHilo } from '../../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/hilo/leido { conversationId, leido } — marca el hilo como leído (todos sus mensajes) o
 * no leído (el último), en el buzón PROPIO de la sesión. Botón de la barra del hilo, como en Gmail.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (typeof body?.leido !== 'boolean') return jsonNoStore({ error: 'Indique si el hilo queda leído o no leído.' }, 400);
    const r = await marcarLeidoHilo(ctx.deps, ctx.acceso, String(body?.conversationId ?? ''), body.leido, ctx.ip);
    return jsonNoStore(r);
  } catch (error) {
    return errorResponse(error, 'hilo-leido');
  }
}
