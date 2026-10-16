import { NextRequest } from 'next/server';
import { authenticateAgent, resolveAgentConversation } from '../../../../../lib/chat/agent-auth';
import { MAX_METRICS_BODY_BYTES, normalizeMetricsPayload } from '../../../../../lib/chat/agent-metrics';
import { isMissingTableError, upsertAgentMetrics } from '../../../../../lib/chat/agent-metrics-store';
import { SgcRateLimiter } from '../../../../../lib/sgc/rateLimit';
import { badRequest, jsonNoStore, serverError, unauthorized } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * MÉTRICAS EN VIVO DEL AGENTE — las publica el mod "synerlink-metrics" de Claude Code.
 *
 *   POST /api/chat/agent/metrics
 *   Authorization: Bearer <llave del agente>
 *   {
 *     "idConversation": 46,
 *     "sessionId": "3433f201-…",
 *     "model": "claude-opus-5",
 *     "state": "tool",
 *     "tool": { "name": "Bash", "label": "Ejecutando comando" },
 *     "context": { "tokens": 84000, "window": 200000, "percent": 42 },
 *     "turn":    { "input": 12, "output": 900, "cacheRead": 80000, "cacheCreation": 3000 },
 *     "session": { "input": 300, "output": 25000, "cacheRead": 2500000, "cacheCreation": 90000 },
 *     "subagentTokens": { "input": 0, "output": 0 },
 *     "costUsd": 1.2345,
 *     "subagents": [{ "id": "a1", "type": "general-purpose", "description": "Revisar logs", "status": "running" }],
 *     "at": "2026-10-06T21:00:00.000Z"
 *   }
 *   → 200 { ok: true, updatedAt }
 *
 * Es una FOTO que se sobrescribe: una fila por (conversación, agente), no un histórico.
 * Solo lleva cifras y nombres; nunca texto de prompts ni de respuestas.
 *
 * Seguridad: el agente sale de la llave (nunca del payload) y resolveAgentConversation()
 * verifica que el hilo sea suyo o que sea integrante del grupo. Cuerpo máximo 16 KB y un
 * límite de tasa por agente (el mod publica cada 2 s y solo si algo cambió).
 */

/** 240 reportes por minuto y agente: holgado para ~8 conversaciones activas a la vez. */
const REGLA = { max: 240, windowMs: 60_000 };
const limitador = new SgcRateLimiter(500);

export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const decision = limitador.check(`agente:${agent.idAgent}`, REGLA, Date.now());
    if (!decision.allowed) {
      const res = jsonNoStore({ error: 'Demasiados reportes de métricas; reintente en un momento.' }, { status: 429 });
      res.headers.set('Retry-After', String(decision.retryAfterSeconds));
      return res;
    }

    const declarado = Number(request.headers.get('content-length') ?? 0);
    if (declarado > MAX_METRICS_BODY_BYTES) {
      return jsonNoStore({ error: 'El reporte supera 16 KB.' }, { status: 413 });
    }
    const crudo = await request.text();
    if (Buffer.byteLength(crudo, 'utf8') > MAX_METRICS_BODY_BYTES) {
      return jsonNoStore({ error: 'El reporte supera 16 KB.' }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(crudo);
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return badRequest('El cuerpo debe ser un objeto JSON.');
    }

    const normal = normalizeMetricsPayload(payload as Record<string, unknown>);
    if ('error' in normal) return badRequest(normal.error);

    const conversation = await resolveAgentConversation(agent.idAgent, normal.idConversation);
    if (!conversation) {
      return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    try {
      const updatedAt = await upsertAgentMetrics(conversation.id, agent.idAgent, normal.metrics);
      return jsonNoStore({ ok: true, updatedAt: updatedAt.toISOString() });
    } catch (error) {
      if (isMissingTableError(error)) {
        return jsonNoStore({ error: 'Las métricas aún no están habilitadas en este ambiente.' }, { status: 503 });
      }
      throw error;
    }
  } catch (error) {
    return serverError('POST /api/chat/agent/metrics', error);
  }
}
