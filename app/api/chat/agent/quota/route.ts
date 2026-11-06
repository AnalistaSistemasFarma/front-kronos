import { NextRequest } from 'next/server';
import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, readJsonBody, serverError, unauthorized } from '../../../../../lib/chat/http';
import { normalizarCuota } from '../../../../../lib/proyectos/consumo-anthropic';
import { CuotaNoDisponible, guardarCuota } from '../../../../../lib/proyectos/consumo-anthropic-servidor';

export const dynamic = 'force-dynamic';

/**
 * CUPO DE ANTHROPIC DEL TOKEN DEL AGENTE — lo reporta el puente de hilos (2026-10-22).
 *
 *   POST /api/chat/agent/quota
 *   Authorization: Bearer <llave del agente>
 *   {
 *     "utilizacion7d": 40, "reset7d": "2026-10-23T22:00:00.000Z",
 *     "utilizacion5h": 22, "reset5h": "2026-10-22T16:30:00.000Z",
 *     "overage": "rejected", "medidoEn": "2026-10-22T12:00:00.000Z", "fuente": "turno"
 *   }
 *
 * La LLAVE decide de qué agente es la fila (regla de oro de lib/chat/agent-auth.ts):
 * el cuerpo no trae agente. Vale cualquier alcance de llave (bot vivo o puente):
 * solo toca la fila de SU agente, y no ve nada de nadie.
 *
 * Es un valor DECLARADO por el agente (lo lee de los encabezados o del stream de
 * Anthropic): sirve para ver cuánto queda, no como prueba de consumo.
 *
 * 200 { guardado: true|false } — false si ya había una medición más nueva.
 * 503 si la tabla todavía no existe (el puente lo registra y sigue).
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const cuota = normalizarCuota(await readJsonBody(request));
    if (!cuota.ok) return badRequest(cuota.error);

    const guardado = await guardarCuota(agent.idAgent, cuota.value);
    return jsonNoStore({ guardado });
  } catch (error) {
    if (error instanceof CuotaNoDisponible) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/agent/quota', error);
  }
}
