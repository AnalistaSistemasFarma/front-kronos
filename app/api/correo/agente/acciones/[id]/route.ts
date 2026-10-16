import { confirmarAccion, descartarAccion, parseEdicion } from '../../../../../../lib/correo/agente';
import { agentePort } from '../../../../../../lib/correo/agenteRuntime';
import { agenteApagado, errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/agente/acciones/<id> { op: 'confirmar' | 'descartar', …edición } — la DECISIÓN de la
 * persona sobre una propuesta del agente. Es la ÚNICA puerta que ejecuta: con la sesión de la persona
 * y desde su buzón (responder, crear solicitud, nota). El agente no tiene ningún camino hasta aquí.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCorreoContext(request, 'envio');
    if (ctx instanceof Response) return ctx;
    const apagado = agenteApagado();
    if (apagado) return apagado;
    const { id } = await params;
    const body = await readJson(request);
    const op = body?.op;
    const px = agentePort();
    if (op === 'descartar') return jsonNoStore(await descartarAccion(ctx.deps, px, ctx.acceso, Number(id), ctx.ip));
    if (op !== 'confirmar') return jsonNoStore({ error: 'Operación no válida.' }, 400);
    return jsonNoStore(await confirmarAccion(ctx.deps, px, ctx.acceso, Number(id), parseEdicion(body), ctx.ip));
  } catch (error) {
    return errorResponse(error, 'agente-accion');
  }
}
