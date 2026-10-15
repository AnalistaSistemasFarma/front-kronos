import { parseFilaCrear } from '../../../../lib/correo/rules';
import { crearDesdeFila } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

const GRAPH_ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;

/**
 * POST /api/correo/crear { conversationId, mensajeId, mensajesIds[], idCompany, idProcess, idSolicitante,
 * titulo, descripcion, adjuntosIds[], etiquetar } — crea UNA solicitud (el navegador recorre el lote
 * fila por fila para mostrar el avance). Idempotente por hilo y por correo.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const fila = parseFilaCrear(body);
    const mensajesIds = Array.isArray(body?.mensajesIds) ? (body!.mensajesIds as unknown[]).map(String).filter((x) => GRAPH_ID_RE.test(x)).slice(0, 50) : [];
    const r = await crearDesdeFila(ctx.deps, ctx.acceso, { ...fila, mensajesIds }, ctx.ip);
    return jsonNoStore(r, 201);
  } catch (error) {
    return errorResponse(error, 'crear');
  }
}
