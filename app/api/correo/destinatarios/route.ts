import { sugerirDestinatarios } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo/destinatarios?q=<texto> — autocompletado de «Redactar»: contactos recientes de la persona (de
 * sus Enviados) y, con 2 o más letras, el directorio de la organización (solo nombre y correo de miembros activos
 * de los dominios de su empresa). Cuota de lectura.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return jsonNoStore({ destinatarios: await sugerirDestinatarios(ctx.deps, ctx.acceso, q) });
  } catch (error) {
    return errorResponse(error, 'destinatarios');
  }
}
