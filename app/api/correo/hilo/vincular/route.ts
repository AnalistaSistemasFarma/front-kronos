import { vincularHilo } from '../../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/correo/hilo/vincular { conversationId, idRequest } — vincula el hilo a una solicitud existente (en la que participa). */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idRequest = Number(body?.idRequest);
    if (!Number.isInteger(idRequest) || idRequest <= 0) return jsonNoStore({ error: 'Indique el número de la solicitud.' }, 400);
    const vinculo = await vincularHilo(ctx.deps, ctx.acceso, String(body?.conversationId ?? ''), idRequest, ctx.ip);
    return jsonNoStore({ vinculo }, 201);
  } catch (error) {
    return errorResponse(error, 'hilo-vincular');
  }
}
