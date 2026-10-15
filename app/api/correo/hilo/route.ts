import { auditarLectura, verHilo } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/hilo?id=<conversationId>[&remotas=1] — hilo completo (HTML SANEADO) y su caso vinculado. */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const q = new URL(request.url).searchParams;
    const id = q.get('id') ?? '';
    const hilo = await verHilo(ctx.deps, ctx.acceso, id, { remotas: q.get('remotas') === '1' });
    await auditarLectura(
      ctx.deps,
      ctx.acceso,
      { accion: 'LEER_HILO', conversationId: id, mensajeId: hilo.mensajes[0]?.id ?? null, detalle: `${hilo.mensajes.length} mensaje(s)` },
      ctx.ip
    );
    return jsonNoStore({ hilo });
  } catch (error) {
    return errorResponse(error, 'hilo');
  }
}
