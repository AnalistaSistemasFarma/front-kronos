import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { messageInclude, serializeMessage } from '../../../../../../lib/chat/conversations';
import { calcularEntregas } from '../../../../../../lib/chat/groups';
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
  readMessageRequest,
  serverError,
} from '../../../../../../lib/chat/http';
import {
  collectChatAttachments,
  type ChatAttachmentCandidate,
} from '../../../../../../lib/chat/attachments';
import {
  uploadChatAttachments,
  type UploadedChatAttachment,
} from '../../../../../../lib/chat/attachmentStorage';

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
      include: messageInclude,
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
 * Envía un mensaje del USUARIO, con o sin adjuntos.
 *
 *   POST /api/chat/conversations/12/messages
 *   Content-Type: application/json
 *   { "body": "…markdown…" }
 *
 *   POST /api/chat/conversations/12/messages
 *   Content-Type: multipart/form-data
 *   body=…markdown…  files=<archivo>  files=<archivo>  …
 *
 * Las dos codificaciones usan LOS MISMOS nombres de campo (`body`), así que el
 * camino de solo texto que ya existía no cambia en nada.
 *
 * El `body` se guarda como MARKDOWN CRUDO, jamás HTML: guardar HTML sería un
 * XSS almacenado esperando a que alguien lo renderice. Sanear y renderizar es
 * responsabilidad del cliente.
 *
 * El `role` lo pone el servidor ('user'): aunque el cliente mande otro, se
 * ignora. Un usuario no puede fabricar un mensaje que parezca del agente. Lo
 * mismo con el AUTOR: sale de la sesión, así que nadie puede escribir en
 * nombre de otra persona del grupo.
 *
 * -------------------------------------------------------------------------
 * EN UN GRUPO: LAS MENCIONES SON LO QUE DESPIERTA A LOS AGENTES
 * -------------------------------------------------------------------------
 * Un mensaje de grupo se le entrega SOLO a los agentes mencionados con `@`
 * (decisión de Nicolás, 2026-09-08). Sin mención no se le entrega a ninguno:
 * la gente puede hablar entre ella sin gastar una sesión de Claude por cada
 * frase. Las filas de entrega se crean en la MISMA transacción del mensaje: si
 * se crearan después, un fallo intermedio dejaría un mensaje que menciona a
 * alguien que nunca se va a enterar.
 *
 * -------------------------------------------------------------------------
 * ADJUNTOS
 * -------------------------------------------------------------------------
 * Con adjuntos el `body` SÍ puede ir vacío (mandar solo un archivo es un uso
 * legítimo); lo que se sigue rechazando es un mensaje del todo vacío —ni texto
 * ni archivos—, que solo ensuciaría el hilo.
 *
 * El archivo se sube a OneDrive ANTES de abrir la transacción y el mensaje con
 * sus filas de `chat_attachment` se crean JUNTOS, en una sola escritura
 * anidada. Nunca se crea el mensaje primero para "engancharle" los adjuntos
 * después: `chat_attachment.id_message` es NOT NULL y ese orden dejaría
 * mensajes a medias en cuanto una subida fallara.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const payload = await readMessageRequest(request);
    if (!payload) {
      return badRequest('El cuerpo debe ser un objeto JSON o un formulario multipart/form-data.');
    }

    let files: ChatAttachmentCandidate[] = [];
    if (payload.form) {
      const collected = collectChatAttachments(payload.form);
      if (!collected.ok) return badRequest(collected.error);
      files = collected.files;
    }

    // Con adjuntos, el texto es opcional. Sin adjuntos, se exige como siempre.
    const rawBody = typeof payload.fields.body === 'string' ? payload.fields.body : '';
    let body = '';
    if (files.length === 0 || rawBody.trim() !== '') {
      const normalized = normalizeMessageBody(payload.fields.body, MAX_USER_MESSAGE_CHARS);
      if (!normalized.ok) return badRequest(normalized.error);
      body = normalized.body;
    }

    /*
     * EL MENSAJE CITADO SE VALIDA CONTRA ESTA CONVERSACIÓN.
     *
     * No basta con que el id exista: si se aceptara cualquiera, alguien podría
     * citar un mensaje de OTRA conversación y la cita —que viaja con el
     * extracto ya resuelto— le mostraría contenido que no le corresponde. Es
     * un id que llega del cliente, así que se comprueba dueño y todo.
     */
    let idReplyTo: number | null = null;
    const rawReply = payload.fields.replyTo;
    if (rawReply !== undefined && rawReply !== null && rawReply !== '') {
      const candidato = Number(rawReply);
      if (!Number.isInteger(candidato) || candidato <= 0) {
        return badRequest('El mensaje citado no es válido.');
      }
      const citado = await prisma.chatMessage.findUnique({
        where: { id: candidato },
        select: { id_conversation: true },
      });
      if (!citado || citado.id_conversation !== guard.conversationId) {
        return badRequest('Solo se puede citar un mensaje de esta misma conversación.');
      }
      idReplyTo = candidato;
    }

    const now = new Date();

    // OneDrive primero (operación externa, no transaccional). Si falla, se
    // responde sin haber escrito nada: no hay mensaje ni adjunto a medias.
    let uploaded: UploadedChatAttachment[] = [];
    if (files.length > 0) {
      try {
        uploaded = await uploadChatAttachments(guard.conversationId, files, now);
      } catch (error) {
        console.error('[chat] no se pudieron subir los adjuntos del usuario a OneDrive:', error);
        return jsonNoStore(
          { error: 'No se pudieron guardar los adjuntos. El mensaje no se envió.' },
          { status: 502 }
        );
      }
    }

    // Transacción: el mensaje y la marca de tiempo de la bandeja entran juntos
    // o no entra ninguno. Si se separan, un fallo intermedio deja la bandeja
    // ordenada por un instante que no corresponde a ningún mensaje.
    // A quién hay que despertar. Una PERSONA nunca choca con el tope de
    // turnos: ese tope existe para las cadenas entre agentes.
    const entregas =
      guard.kind === 'group'
        ? calcularEntregas({
            body,
            agentesDelGrupo: guard.groupAgents,
            idAgentAutor: null,
            turnosPrevios: 0,
          })
        : { idAgents: [], cadenaCortada: false };

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          id_conversation: guard.conversationId,
          role: 'user',
          body,
          created_at: now,
          // El autor sale de la SESIÓN, nunca del payload.
          id_user_author: guard.user.id,
          ...(idReplyTo !== null ? { id_reply_to: idReplyTo } : {}),
          // Mensaje y adjuntos, una sola escritura: o entran los dos o ninguno.
          ...(uploaded.length > 0 ? { attachments: { create: uploaded } } : {}),
          // Mensaje y entregas, también: ver la nota de arriba.
          ...(entregas.idAgents.length > 0
            ? {
                deliveries: {
                  create: entregas.idAgents.map((idAgent) => ({ id_agent: idAgent })),
                },
              }
            : {}),
        },
        include: messageInclude,
      });

      await tx.chatConversation.update({
        where: { id: guard.conversationId },
        data: { last_message_at: now },
      });

      return created;
    });

    return jsonNoStore(
      {
        message: serializeMessage(message),
        // Para que la interfaz pueda decir "no mencionó a ningún asistente"
        // en vez de dejar al usuario esperando una respuesta que no viene.
        notifiedAgents: entregas.idAgents,
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError('POST /api/chat/conversations/[id]/messages', error);
  }
}
