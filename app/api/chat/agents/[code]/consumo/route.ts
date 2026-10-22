import { NextRequest, NextResponse } from 'next/server';
import { getChatAccess } from '../../../../../../lib/chat/access';
import { NO_STORE, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { cuotaDelAgente } from '../../../../../../lib/proyectos/consumo-anthropic-servidor';

export const dynamic = 'force-dynamic';

/**
 * CONSUMO DE ANTHROPIC DE UN AGENTE, para el botón del chat (2026-10-22).
 *
 * Pedido de Nicolás Rivera: «quiero que el widget de consumo se pueda ver desde
 * el chat como un botoncito». Es la misma medición del medidor de Proyectos
 * (tabla chat_agent_quota, la publica el puente de hilos), leída por agente.
 *
 *   GET /api/chat/agents/<code>/consumo  → { agents: CuotaAgenteDto[] }  (0 o 1)
 *
 * Va por el `code` y no por el id porque el árbol ya tiene
 * /api/chat/agents/[code]/avatar (Next no admite dos nombres de segmento en el
 * mismo nivel).
 *
 * Sesión + ACCESO a ese agente (getChatAccess: el subproceso del agente en
 * alguna empresa a la que pertenece). Sin acceso, 404 —no 403—, para que nadie
 * pueda sondear qué agentes existen. Un agente que no publica cuota responde
 * una lista vacía y el botón no se pinta.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const { code } = await params;
    const access = await getChatAccess(user.email);
    const agente = access.canUseChat ? access.agents.find((a) => a.code === code) : undefined;
    if (!agente) {
      return NextResponse.json({ error: 'Agente no encontrado.' }, { status: 404, headers: NO_STORE });
    }

    const agents = await cuotaDelAgente({ id_agent: agente.idAgent, code: agente.code, display_name: agente.displayName });
    return jsonNoStore({ agents });
  } catch (error) {
    return serverError('GET /api/chat/agents/[code]/consumo', error);
  }
}
