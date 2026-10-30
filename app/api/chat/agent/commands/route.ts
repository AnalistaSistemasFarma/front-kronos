import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { ContextoNoDisponible, ordenesPendientes } from '../../../../../lib/chat/agent-context-store';
import { forbidden, jsonNoStore, serverError, unauthorized } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * ÓRDENES PENDIENTES DEL AGENTE (2026-10-29) — las lee el ejecutor de la máquina del bot.
 *
 *   GET /api/chat/agent/commands
 *   Authorization: Bearer <llave del agente>  (alcance 'channel': la del bot vivo)
 *   → 200 { commands: [{ id, command: 'limpiar_contexto', sessionKey, runtime, idConversation, … }] }
 *
 * Solo lee: para tomar una orden, el ejecutor la pasa a 'en_curso' con
 * POST /api/chat/agent/commands/<id>. La llave del puente de Proyectos (alcance
 * 'projects') no puede ejecutar órdenes sobre la sesión del bot.
 */
export async function GET(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'channel') return forbidden('Esta llave no puede ejecutar órdenes sobre el agente.');
    const commands = await ordenesPendientes(agent.idAgent);
    return jsonNoStore({ commands });
  } catch (error) {
    if (error instanceof ContextoNoDisponible) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('GET /api/chat/agent/commands', error);
  }
}
