import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { serializeMessage } from '../../../../../../lib/chat/conversations';
import {
  MAX_USER_MESSAGE_CHARS,
  MESSAGES_PAGE_DEFAULT,
  MESSAGES_PAGE_MAX,
  normalizeMessageBody,
  parseNonNegativeInt,
  parsePositiveInt,
} from '../../../../../../lib/chat/constants';
import {
  badRequest,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * Histórico de mensajes de una conversación, MÁS RECIENTES PRIMERO y paginado
 * por cursor.
 *
 *   GET /api/chat/conversations/12/messages?limit=30&before=<idMensaje>
 *
 * `before` es el id del mensaje más antiguo que ya tiene el cliente; la
 * siguiente página trae los inmediatamente anteriores. Se pagina por id y no
 * por offset porque el id es monótono y aprovecha el índice
 * (id_conversation, id DESC): una página profunda cuesta lo mismo que la
 * primera, y no se salta ni repite mensajes si llegan nuevos mientras tanto.
 *
 * Seguridad: guardConversation() valida sesión + propiedad del hilo + permiso
 * vigente sobre el agente. Un id de otra persona responde 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const sp = request.nextUrl.searchParams;
    const limit = parsePositiveInt(sp.get('limit'), MESSAGES_PAGE_DEFAULT, MESSAGES_PAGE_MAX);

    const rawBefore = sp.get('before');
    const before = parseNonNegativeInt(rawBefore);
    if (rawBefore !== null && rawBefore.trim() !== '' && before === null) {
      return badRequest('El cursor "before" debe ser un entero positivo.');
    }

    const rows = await prisma.chatMessage.findMany({
      where: {
        id_conversation: guard.conversationId,
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { id: 'desc' },
      // Se pide uno de más para saber si hay página siguiente sin un COUNT.
      take: limit + 1,
      include: { attachments: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return jsonNoStore({
      messages: page.map(serializeMessage),
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/messages', error);
  }
}

/**
 * Envía un mensaje del USUARIO.
 *
 *   POST /api/chat/conversations/12/messages   { "body": "…markdown…" }
 *
 * El `body` se guarda como MARKDOWN CRUDO, jamás HTML: guardar HTML sería un
 * XSS almacenado esperando a que alguien lo renderice. Sanear y renderizar es
 * responsabilidad del cliente.
 *
 * El `role` lo pone el servidor ('user'): aunque el cliente mande otro, se
 * ignora. Un usuario no puede fabricar un mensaje que parezca del agente.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const normalized = normalizeMessageBody(payload.body, MAX_USER_MESSAGE_CHARS);
    if (!normalized.ok) return badRequest(normalized.error);

    const now = new Date();

    // Transacción: el mensaje y la marca de tiempo de la bandeja entran juntos
    // o no entra ninguno. Si se separan, un fallo intermedio deja la bandeja
    // ordenada por un instante que no corresponde a ningún mensaje.
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          id_conversation: guard.conversationId,
          role: 'user',
          body: normalized.body,
          created_at: now,
        },
        include: { attachments: true },
      });

      await tx.chatConversation.update({
        where: { id: guard.conversationId },
        data: { last_message_at: now },
      });

      return created;
    });

    return jsonNoStore({ message: serializeMessage(message) }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/conversations/[id]/messages', error);
  }
}
