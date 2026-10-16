import { puedeUsarEmpresa } from '../../../../lib/correo/service';
import { empresaParam, errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo/procesos?empresa=<id> — categorías y procesos de «Nueva solicitud»
 * en la empresa (misma regla de la pantalla normal), con los responsables.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const empresa = empresaParam(request.url);
    if (!empresa || !puedeUsarEmpresa(ctx.acceso, empresa)) return jsonNoStore({ error: 'Usted no pertenece a esa empresa.' }, 403);
    return jsonNoStore(await ctx.deps.kronos.catalogoEmpresa(empresa));
  } catch (error) {
    return errorResponse(error, 'procesos');
  }
}
