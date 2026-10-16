import { auditarLectura, proveedorDe } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/carpetas — carpetas del buzón PROPIO. */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const prov = await proveedorDe(ctx.deps, ctx.acceso);
    const carpetas = await prov.carpetas();
    await auditarLectura(ctx.deps, ctx.acceso, { accion: 'LEER_CARPETAS', detalle: `${carpetas.length} carpeta(s)` }, ctx.ip);
    return jsonNoStore({ carpetas });
  } catch (error) {
    return errorResponse(error, 'carpetas');
  }
}
