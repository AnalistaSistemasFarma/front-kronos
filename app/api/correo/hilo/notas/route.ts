import { sincronizarHilo } from '../../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/correo/hilo/notas { conversationId } — pasa a notas del caso los correos nuevos del hilo vinculado. */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const r = await sincronizarHilo(ctx.deps, ctx.acceso, String(body?.conversationId ?? ''), ctx.ip);
    return jsonNoStore(r);
  } catch (error) {
    return errorResponse(error, 'hilo-notas');
  }
}
