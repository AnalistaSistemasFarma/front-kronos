import { vinculosDeSolicitud } from '../../../../lib/correo/db';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/correo/vinculos?solicitud=<id> — hilos PROPIOS vinculados a la solicitud (enlace desde la solicitud). */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const id = Number(new URL(request.url).searchParams.get('solicitud'));
    if (!Number.isInteger(id) || id <= 0) return jsonNoStore({ error: 'Solicitud inválida.' }, 400);
    return jsonNoStore({ vinculos: await vinculosDeSolicitud(ctx.deps.db, ctx.acceso.idUser, id) });
  } catch (error) {
    return errorResponse(error, 'vinculos');
  }
}
