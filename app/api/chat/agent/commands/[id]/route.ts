import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/chat/agent-auth';
import { esEstadoOrden } from '../../../../../../lib/chat/agent-context';
import { ContextoNoDisponible, TransicionInvalida, reportarOrden } from '../../../../../../lib/chat/agent-context-store';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError, unauthorized } from '../../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * RESULTADO DE UNA ORDEN (2026-10-29) — lo reporta el ejecutor.
 *
 *   POST /api/chat/agent/commands/<id>
 *   Authorization: Bearer <llave del agente>
 *   { "estado": "en_curso" | "ok" | "ocupado" | "error", "detalle": "…", "ejecutor": "horus" }
 *
 * 'en_curso' TOMA la orden (solo desde 'pendiente'); los finales la cierran.
 * Solo órdenes del agente de la llave: otra cualquiera responde 404.
 * 409 si la transición no vale (ya la tomó otro ejecutor, ya se cerró, venció).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'channel') return forbidden('Esta llave no puede ejecutar órdenes sobre el agente.');

    const { id } = await params;
    const idCommand = Number(id);
    if (!Number.isInteger(idCommand) || idCommand <= 0) return badRequest('Id de orden inválido.');

    const body = await readJsonBody(request);
    if (!body) return badRequest('El cuerpo debe ser un objeto JSON.');
    const estado = body.estado ?? body.status;
    if (!esEstadoOrden(estado) || estado === 'pendiente' || estado === 'vencida') {
      return badRequest("estado debe ser 'en_curso', 'ok', 'ocupado' o 'error'.");
    }
    const detalle = typeof body.detalle === 'string' ? body.detalle.trim() || null : null;
    const ejecutor = typeof body.ejecutor === 'string' ? body.ejecutor.trim() || null : null;

    const orden = await reportarOrden(agent.idAgent, idCommand, estado, detalle, ejecutor ?? agent.keyLabel);
    if (!orden) return jsonNoStore({ error: 'Orden no encontrada.' }, { status: 404 });
    return jsonNoStore({ orden });
  } catch (error) {
    if (error instanceof TransicionInvalida) return jsonNoStore({ error: error.message }, { status: 409 });
    if (error instanceof ContextoNoDisponible) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/agent/commands/[id]', error);
  }
}
