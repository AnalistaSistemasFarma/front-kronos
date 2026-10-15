import { empresaParam, errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/procesos?empresa=<id> — procesos activos de la empresa (con sus responsables). */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const empresa = empresaParam(request.url);
    if (!empresa || !ctx.acceso.empresas.some((e) => e.idCompany === empresa)) return jsonNoStore({ error: 'No tiene el módulo Correo en esa empresa.' }, 403);
    return jsonNoStore({ procesos: await ctx.deps.kronos.procesosEmpresa(empresa) });
  } catch (error) {
    return errorResponse(error, 'procesos');
  }
}
