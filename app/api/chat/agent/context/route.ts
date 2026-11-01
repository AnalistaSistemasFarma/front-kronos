import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { MAX_CONTEXTO_BODY_BYTES, normalizarReporteContexto } from '../../../../../lib/chat/agent-context';
import { ContextoNoDisponible, guardarContextos } from '../../../../../lib/chat/agent-context-store';
import { SgcRateLimiter } from '../../../../../lib/sgc/rateLimit';
import { badRequest, jsonNoStore, serverError, unauthorized } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * CONTEXTO DE LA SESIÓN DEL AGENTE — lo publica el ejecutor de cada Mac
 * (contexto-agentes.py, ~/brain/migrar-agente-synerlink/scripts/rotacion-sesion/) (2026-10-29).
 *
 *   POST /api/chat/agent/context
 *   Authorization: Bearer <llave del agente>
 *   { "sesiones": [
 *       { "sessionKey": "principal", "runtime": "claude-code", "sessionId": "…", "model": "claude-opus-5-5",
 *         "tokens": 412000, "window": 1000000, "measuredAt": "2026-10-29T15:00:00Z" },
 *       { "sessionKey": "agent:duo:synerlink-108", "runtime": "openclaw", "idConversation": 108,
 *         "tokens": 586408, "window": 1000000 }
 *   ] }
 *   → 200 { guardadas, descartadas }
 *
 * 'principal' = la sesión ÚNICA de un bot de Claude Code (todas sus conversaciones).
 * Una sesión por conversación (openclaw) trae su idConversation.
 *
 * La LLAVE decide el agente (regla de oro de lib/chat/agent-auth.ts). Solo cifras: nunca
 * texto de la conversación. Una fila mal puesta solo afecta lo que se ve del MISMO agente.
 * 503 si la tabla aún no existe (el publicador lo registra y espera).
 */
const REGLA = { max: 30, windowMs: 60_000 };
const limitador = new SgcRateLimiter(500);

export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const decision = limitador.check(`contexto:${agent.idAgent}`, REGLA, Date.now());
    if (!decision.allowed) {
      const res = jsonNoStore({ error: 'Demasiados reportes de contexto; reintente en un momento.' }, { status: 429 });
      res.headers.set('Retry-After', String(decision.retryAfterSeconds));
      return res;
    }

    const crudo = await request.text();
    if (Buffer.byteLength(crudo, 'utf8') > MAX_CONTEXTO_BODY_BYTES) {
      return jsonNoStore({ error: 'El reporte supera 64 KB.' }, { status: 413 });
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(crudo);
    } catch {
      payload = null;
    }
    const r = normalizarReporteContexto(payload);
    if ('error' in r) return badRequest(r.error);

    const guardadas = await guardarContextos(agent.idAgent, r.sesiones);
    return jsonNoStore({ guardadas, descartadas: r.descartadas });
  } catch (error) {
    if (error instanceof ContextoNoDisponible) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/agent/context', error);
  }
}
