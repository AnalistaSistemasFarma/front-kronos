import { invalidarNoLeidos } from '../../../../lib/correo/noLeidos';
import { marcarLeidoMensajes } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/leido { mensajesIds: string[], leido } — «Marcar como leído / no leído» de los correos
 * seleccionados (máx. 100), por Graph `$batch` en el buzón PROPIO. 200 { cambiados, fallidos }.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'marcado');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (typeof body?.leido !== 'boolean') return jsonNoStore({ error: 'Indique si los correos quedan leídos o no leídos.' }, 400);
    if (!Array.isArray(body?.mensajesIds)) return jsonNoStore({ error: 'Seleccione al menos un correo.' }, 400);
    const r = await marcarLeidoMensajes(ctx.deps, ctx.acceso, (body.mensajesIds as unknown[]).map(String), body.leido, ctx.ip);
    invalidarNoLeidos(ctx.acceso.idUser);
    return jsonNoStore(r);
  } catch (error) {
    return errorResponse(error, 'leido');
  }
}
