import { deshacerEliminar } from '../../../../../lib/correo/eliminar';
import { invalidarNoLeidos } from '../../../../../lib/correo/noLeidos';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/eliminar/deshacer { deshacer: <comprobante firmado> } — «Deshacer» del aviso: devuelve a su
 * carpeta de origen los correos que siguen en Elementos eliminados del buzón de la SESIÓN. El comprobante lo firmó
 * el servidor al eliminar (persona, buzón, ids y carpetas); vence a los 5 minutos. 200 { restaurados, fallidos }.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'eliminar');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const r = await deshacerEliminar(ctx.deps, ctx.acceso, body?.deshacer, ctx.ip);
    if (r.restaurados.length) invalidarNoLeidos(ctx.acceso.idUser);
    return jsonNoStore(r);
  } catch (error) {
    return errorResponse(error, 'eliminar-deshacer');
  }
}
