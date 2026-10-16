import { invalidarNoLeidos } from '../../../../../lib/correo/noLeidos';
import { marcarLeidoCarpeta } from '../../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/leido/carpeta { carpeta: id | null, leido } — «Marcar todo como leído» / toda la carpeta
 * seleccionada: marca UN lote (200) por petición y responde { cambiados, fallidos, restantes }; el navegador
 * repite mientras queden y muestra el avance. null = Bandeja de entrada.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'marcado');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (typeof body?.leido !== 'boolean') return jsonNoStore({ error: 'Indique si los correos quedan leídos o no leídos.' }, 400);
    const carpeta = body?.carpeta == null || body.carpeta === '' ? null : String(body.carpeta);
    const r = await marcarLeidoCarpeta(ctx.deps, ctx.acceso, carpeta, body.leido, ctx.ip);
    invalidarNoLeidos(ctx.acceso.idUser);
    return jsonNoStore(r);
  } catch (error) {
    return errorResponse(error, 'leido-carpeta');
  }
}
