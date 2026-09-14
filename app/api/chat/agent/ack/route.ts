import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { INBOX_ACK_MAX_IDS } from '../../../../../lib/chat/constants';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * Confirma la recepción de mensajes traídos con `GET /api/chat/agent/inbox?ack=false`.
 *
 *   POST /api/chat/agent/ack   { "messageIds": [12, 13] }
 *   Authorization: Bearer <llave del agente>
 *
 * Escribe `delivered_at`, que es justo lo que dice el modelo: "momento en que
 * el agente confirmó la recepción". Es idempotente — confirmar dos veces no
 * mueve la marca original (el WHERE exige delivered_at IS NULL).
 *
 * Dos destinos según de dónde venga el mensaje, y la diferencia importa:
 *   - HILO DIRECTO: se marca `chat_message.delivered_at`. Hay un solo agente,
 *     así que la columna del mensaje alcanza.
 *   - GRUPO: se marca la fila de ESTE agente en `chat_message_delivery`. Tocar
 *     la columna del mensaje se lo escondería a los otros agentes mencionados,
 *     que es justo el error que esa tabla existe para evitar.
 * El bot manda los mismos ids en los dos casos; el servidor sabe cuál es cuál.
 *
 * Seguridad: el agente sale de la llave y los dos WHERE están anclados a lo
 * suyo. Mandar el id de un mensaje de otro agente no marca nada: la respuesta
 * dirá `updated: 0`.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const raw = payload.messageIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return badRequest('messageIds debe ser un arreglo con al menos un id.');
    }
    if (raw.length > INBOX_ACK_MAX_IDS) {
      return badRequest(`No se pueden confirmar más de ${INBOX_ACK_MAX_IDS} mensajes por llamada.`);
    }

    const ids: number[] = [];
    for (const item of raw) {
      const n = Number(item);
      if (!Number.isInteger(n) || n <= 0) {
        return badRequest('messageIds solo admite enteros positivos.');
      }
      ids.push(n);
    }

    const ahora = new Date();

    const [directos, grupos] = await Promise.all([
      prisma.chatMessage.updateMany({
        where: {
          id: { in: ids },
          delivered_at: null,
          role: 'user',
          // ANCLA DE SEGURIDAD: solo mensajes de hilos DIRECTOS de ESTE agente.
          conversation: { kind: 'direct', id_agent: agent.idAgent },
        },
        data: { delivered_at: ahora },
      }),
      prisma.chatMessageDelivery.updateMany({
        where: {
          id_message: { in: ids },
          // ANCLA DE SEGURIDAD: solo las entregas de ESTE agente.
          id_agent: agent.idAgent,
          delivered_at: null,
        },
        data: { delivered_at: ahora },
      }),
    ]);

    return jsonNoStore({
      updated: directos.count + grupos.count,
      direct: directos.count,
      group: grupos.count,
    });
  } catch (error) {
    return serverError('POST /api/chat/agent/ack', error);
  }
}
