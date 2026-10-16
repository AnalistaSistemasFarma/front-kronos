import { noLeidosBandeja } from '../../../../lib/correo/noLeidos';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo/no-leidos — icono del Correo en la cabecera.
 * 401 sin sesión · 403 sin el permiso del módulo (el icono no se muestra) ·
 * 200 { noLeidos: número | null } (null: sin contador, p. ej. inquilino no habilitado).
 * Solo un número: sin contenido de correos. Caché de 3 min por persona (lib/correo/noLeidos).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const noLeidos = await noLeidosBandeja(ctx.deps, ctx.acceso);
    return jsonNoStore({ noLeidos });
  } catch (error) {
    return errorResponse(error, 'no-leidos');
  }
}
