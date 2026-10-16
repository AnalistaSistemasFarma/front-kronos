import { accionesDeChat } from '../../../../../lib/correo/agente';
import { agentePort } from '../../../../../lib/correo/agenteRuntime';
import { errorResponse, getCorreoContext, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/correo/agente/acciones?chat=<id> — propuestas del agente (tarjetas) en SU chat directo.
 * Solo las de concesiones de la persona de la sesión. Sin el módulo Correo responde una lista
 * vacía (el chat la consulta en cada hilo y no debe ensuciar la consola con 403).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx.status === 403 ? jsonNoStore({ acciones: [] }) : ctx;
    const chat = Number(new URL(request.url).searchParams.get('chat'));
    return jsonNoStore({ acciones: await accionesDeChat(ctx.deps, agentePort(), ctx.acceso, chat) });
  } catch (error) {
    return errorResponse(error, 'agente-acciones');
  }
}
