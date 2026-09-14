import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { authenticateAgent, resolveAgentConversation } from '../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, readJsonBody, serverError, unauthorized } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * CONSUMO EN TOKENS DE UN TURNO — lo reporta el conector del agente.
 *
 *   POST /api/chat/agent/usage
 *   Authorization: Bearer <llave del agente>
 *   {
 *     "conversationIds": [46],
 *     "sessionId": "3433f201-…",
 *     "models": ["claude-opus-5"],
 *     "apiMessages": 30,
 *     "apiMessagesSubagents": 0,
 *     "tokens": { "input": 60, "cacheCreation": 97844, "cacheRead": 2786758,
 *                 "output": 23610, "thinking": 8434 },
 *     "turnStartedAt": "2026-09-10T10:49:34.015Z",
 *     "turnEndedAt": "2026-09-10T10:57:38.954Z"
 *   }
 *
 * POR QUÉ LO MANDA EL AGENTE Y NO LO CALCULA LA APLICACIÓN (pedido de Nicolás
 * el 2026-09-10, auditoría de permisos): los tokens los informa la API del
 * modelo al proceso del agente, que los deja en la bitácora de su sesión. Esta
 * aplicación no participa de esa conversación y no tiene forma de saber el
 * costo. La única fuente es el propio agente.
 *
 * QUÉ SIGNIFICA ESO PARA LA CONFIANZA DEL DATO: es un valor DECLARADO por el
 * agente, igual que un parte de trabajo. Sirve para revisar consumo y detectar
 * un uso desproporcionado; no es una medición independiente y no se debe usar
 * como prueba contra el propio agente. La llave garantiza QUIÉN reporta, y las
 * conversaciones se verifican contra las suyas — un agente no puede anotarle
 * consumo a otro ni a un hilo ajeno.
 *
 * UN TURNO PUEDE ATENDER VARIAS CONVERSACIONES a la vez (dos personas
 * escribiendo mientras el agente trabaja). No hay manera de partir el gasto,
 * así que se escribe la MISMA cifra para cada conversación del turno y se deja
 * `session_id` + `turn_started_at` para poder reconocer que son el mismo turno
 * al sumar. Inflar el total sumando a ciegas es un error de lectura conocido,
 * no un error del dato.
 */

/** Tope por renglón. Un turno real no llega ni cerca; ataja un dato absurdo. */
const MAX_TOKENS_POR_RENGLON = 2_000_000_000;
/** Conversaciones por reporte. Un turno que atienda más de esto es un error. */
const MAX_CONVERSACIONES = 20;

/** Entero no negativo, tolerante con lo que llegue como texto. */
function enteroNoNegativo(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), MAX_TOKENS_POR_RENGLON);
}

/** Fecha ISO válida, o null. Nunca lanza por un texto cualquiera. */
function fechaOpcional(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    // Se acepta una conversación o varias: el turno pudo atender a más de una.
    const crudas = Array.isArray(payload.conversationIds)
      ? payload.conversationIds
      : [payload.idConversation ?? payload.conversationId];
    const ids: number[] = [];
    for (const raw of crudas) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) continue;
      if (!ids.includes(n)) ids.push(n);
    }
    if (ids.length === 0) return badRequest('Falta conversationIds (o idConversation).');
    if (ids.length > MAX_CONVERSACIONES) {
      return badRequest(`Máximo ${MAX_CONVERSACIONES} conversaciones por reporte.`);
    }

    const tokens = (payload.tokens ?? {}) as Record<string, unknown>;
    const input = enteroNoNegativo(tokens.input ?? tokens.input_tokens);
    const cacheCreation = enteroNoNegativo(tokens.cacheCreation ?? tokens.cache_creation_input_tokens);
    const cacheRead = enteroNoNegativo(tokens.cacheRead ?? tokens.cache_read_input_tokens);
    const output = enteroNoNegativo(tokens.output ?? tokens.output_tokens);
    const thinking = enteroNoNegativo(tokens.thinking ?? tokens.thinking_tokens);
    // El razonamiento YA está dentro de la salida: no se suma otra vez.
    const total = Math.min(input + cacheCreation + cacheRead + output, MAX_TOKENS_POR_RENGLON);

    if (total === 0) return badRequest('El reporte no trae consumo.');

    const modelosCrudos = Array.isArray(payload.models)
      ? payload.models
      : payload.models
        ? [payload.models]
        : [];
    const models =
      modelosCrudos
        .map((m) => String(m ?? '').trim())
        .filter(Boolean)
        .join(', ')
        .slice(0, 300) || null;

    const datosComunes = {
      id_agent: agent.idAgent,
      session_id: payload.sessionId ? String(payload.sessionId).slice(0, 120) : null,
      models,
      api_messages: enteroNoNegativo(payload.apiMessages),
      api_messages_subagents: enteroNoNegativo(payload.apiMessagesSubagents),
      input_tokens: input,
      cache_creation_tokens: cacheCreation,
      cache_read_tokens: cacheRead,
      output_tokens: output,
      thinking_tokens: thinking,
      total_tokens: total,
      turn_started_at: fechaOpcional(payload.turnStartedAt),
      turn_ended_at: fechaOpcional(payload.turnEndedAt),
    };

    // Cada conversación se verifica contra las de ESTE agente. Una que no lo
    // sea se ignora en silencio y se informa en la respuesta: un id viejo o de
    // otro agente no debe tumbar el reporte de los que sí valen.
    const registradas: number[] = [];
    const rechazadas: number[] = [];
    for (const id of ids) {
      const conversation = await resolveAgentConversation(agent.idAgent, id);
      if (!conversation) {
        rechazadas.push(id);
        continue;
      }
      await prisma.chatAgentTurnUsage.create({
        data: { ...datosComunes, id_conversation: conversation.id },
      });
      registradas.push(conversation.id);
    }

    if (registradas.length === 0) {
      return jsonNoStore(
        { error: 'Ninguna de las conversaciones reportadas es de este agente.', rechazadas },
        { status: 404 }
      );
    }

    return jsonNoStore({ recorded: registradas.length, conversations: registradas, rechazadas }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/agent/usage', error);
  }
}
