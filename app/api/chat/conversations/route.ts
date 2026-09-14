import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { getChatAgentAccess } from '../../../../lib/chat/access';
import {
  getConversationPayload,
  listUserConversations,
} from '../../../../lib/chat/conversations';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../lib/chat/http';

/**
 * Bandeja del usuario: sus conversaciones con agente, último mensaje, no
 * leídos y estado en vivo del agente.
 *
 * Seguridad: exige sesión y resuelve el usuario desde el correo de la sesión.
 * El cliente no manda ningún identificador de usuario, así que no hay nada que
 * suplantar. La lista se filtra además por los agentes sobre los que el usuario
 * todavía tiene permiso (getChatAccess).
 *
 *   GET /api/chat/conversations?archived=1
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const archived = request.nextUrl.searchParams.get('archived') === '1';
    const conversations = await listUserConversations(user.id, user.email, { archived });

    return jsonNoStore({ conversations });
  } catch (error) {
    return serverError('GET /api/chat/conversations', error);
  }
}

/**
 * Abre (o crea) la conversación del usuario con UN agente.
 *
 *   POST /api/chat/conversations   { "idAgent": 1 }
 *
 * Es idempotente: si ya existe un hilo activo con ese agente lo devuelve tal
 * cual en vez de crear uno nuevo (un agente = un hilo, como un chat directo).
 *
 * Seguridad: no basta con tener sesión ni con tener acceso al módulo. Se valida
 * el permiso sobre ESE agente con getChatAgentAccess(); si el usuario no lo
 * tiene, no se crea nada.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const body = await readJsonBody(request);
    if (!body) return badRequest('El cuerpo debe ser un objeto JSON.');

    const idAgent = Number(body.idAgent);
    if (!Number.isInteger(idAgent) || idAgent <= 0) {
      return badRequest('Debe indicar un idAgent válido.');
    }

    // El permiso sobre el agente se comprueba SIEMPRE, en cada operación.
    const agentAccess = await getChatAgentAccess(user.email, idAgent);
    if (!agentAccess) {
      return jsonNoStore({ error: 'No tiene permiso para hablar con este agente.' }, { status: 403 });
    }

    // ⚠️ SOLO HILOS DIRECTOS. Un GRUPO también guarda `id_user` (quien lo creó)
    // e `id_agent` (el anfitrión, ver app/api/chat/groups/route.ts): sin este
    // filtro, si Nicolás crea un grupo y elige a un agente X como anfitrión,
    // esta consulta encuentra ESE grupo al abrir su chat directo con X —mismo
    // id_user, mismo id_agent— y lo devuelve como si fuera el hilo privado. La
    // interfaz termina mostrando y enviando al grupo en vez de al hilo 1:1.
    // Bug reportado por Nicolás el 2026-09-12 (su chat con horus lo mandaba al
    // grupo y no lo dejaba hablarle en privado).
    const existing = await prisma.chatConversation.findFirst({
      where: { kind: 'direct', id_user: user.id, id_agent: idAgent, archived: false },
      orderBy: { id: 'desc' },
      select: { id: true },
    });

    if (existing) {
      const payload = await getConversationPayload(existing.id);
      return jsonNoStore({ conversation: payload, created: false });
    }

    const created = await prisma.chatConversation.create({
      data: {
        kind: 'direct',
        id_user: user.id,
        id_agent: idAgent,
        title: agentAccess.displayName,
      },
      select: { id: true },
    });

    const payload = await getConversationPayload(created.id);
    return jsonNoStore({ conversation: payload, created: true }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/conversations', error);
  }
}
