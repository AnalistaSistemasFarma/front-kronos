import { auditarLectura, imagenesMensajeHilo } from '../../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo/hilo/imagenes?hilo=<conversationId>&id=<mensajeId>[&remotas=1] — el mensaje (HTML SANEADO)
 * con sus imágenes incrustadas, al desplegarlo. El mensaje debe pertenecer a ese hilo del buzón PROPIO.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const q = new URL(request.url).searchParams;
    const hilo = q.get('hilo') ?? '';
    const id = q.get('id') ?? '';
    const mensaje = await imagenesMensajeHilo(ctx.deps, ctx.acceso, hilo, id, { remotas: q.get('remotas') === '1' });
    await auditarLectura(ctx.deps, ctx.acceso, { accion: 'LEER_HILO', conversationId: hilo, mensajeId: mensaje.id, detalle: 'Imágenes incrustadas de 1 mensaje' }, ctx.ip);
    return jsonNoStore({ mensaje });
  } catch (error) {
    return errorResponse(error, 'hilo-imagenes');
  }
}
