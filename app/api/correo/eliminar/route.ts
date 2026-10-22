import { eliminarMensajes } from '../../../../lib/correo/eliminar';
import { invalidarNoLeidos } from '../../../../lib/correo/noLeidos';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/eliminar { mensajesIds: string[], confirmarVinculados?: boolean } — «Eliminar» (deslizar a la
 * izquierda, botón o selección; máx. 100). MUEVE los correos del buzón de la SESIÓN a «Elementos eliminados»
 * (nunca borra de forma permanente). 200 { eliminados, yaEnEliminados, fallidos, deshacer, venceEn };
 * 409 { code: 'VINCULADO', vinculos } si algún hilo está ligado a una solicitud o a un proyecto y no se confirmó.
 * El cuerpo no admite buzón ni usuario: salen de la sesión (lib/correo/eliminar.ts).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'eliminar');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!Array.isArray(body?.mensajesIds)) return jsonNoStore({ error: 'Seleccione al menos un correo.' }, 400);
    const r = await eliminarMensajes(ctx.deps, ctx.acceso, body.mensajesIds as unknown[], { confirmarVinculados: body.confirmarVinculados === true }, ctx.ip);
    if (r.requiereConfirmacion) {
      return jsonNoStore({ error: 'El hilo está vinculado a una solicitud o a un proyecto. Confirme para eliminarlo.', code: 'VINCULADO', vinculos: r.vinculos }, 409);
    }
    if (r.eliminados.length) invalidarNoLeidos(ctx.acceso.idUser);
    const { requiereConfirmacion: _r, ...resto } = r;
    return jsonNoStore(resto);
  } catch (error) {
    return errorResponse(error, 'eliminar');
  }
}
