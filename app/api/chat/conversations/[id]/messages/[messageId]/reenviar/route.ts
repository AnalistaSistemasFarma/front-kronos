import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../../../lib/prisma';
import { serializeMessage } from '../../../../../../../../lib/chat/conversations';
import { readClientOrigin } from '../../../../../../../../lib/chat/client-origin';
import { normalizeMessageBody } from '../../../../../../../../lib/chat/constants';
import { MAX_CHAT_ATTACHMENT_BYTES, isBlockedAttachmentExtension } from '../../../../../../../../lib/chat/attachments';
import { downloadChatAttachment, uploadChatAttachments } from '../../../../../../../../lib/chat/attachmentStorage';
import { publicarMensajeDePersona } from '../../../../../../../../lib/chat/publicar-mensaje';
import { destinosDe, puertaDestinoReenvio } from '../../../../../../../../lib/chat/reenviar-archivo';
import { MAX_NOTA_REENVIO, ordenarDestinos } from '../../../../../../../../lib/chat/compartir';
import { agentForwardDestinations, agentForwardGate } from '../../../../../../../../lib/chat/forward-to-agent';
import {
  MAX_ADJUNTOS_REENVIO,
  MAX_MENSAJE_REENVIADO,
  armarCuerpoReenvio,
} from '../../../../../../../../lib/chat/reenviar-mensaje-rules';
import {
  badRequest,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
  type ChatSessionUser,
} from '../../../../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * REENVIAR UN MENSAJE del chat a otra conversación (2026-11-17).
 *
 *   GET  /api/chat/conversations/12/messages/345/reenviar
 *        → { destinos: DestinoReenvio[] }   a dónde lo puede reenviar
 *   POST /api/chat/conversations/12/messages/345/reenviar   { "idConversation": 77, "body": "opcional" }
 *   POST /api/chat/conversations/12/messages/345/reenviar   { "idAgent": 5, "body": "opcional" }
 *        → 201 { message }                   el mensaje nuevo en el destino
 *
 * Pedido de Nicolás Rivera: «ayúdame a poder reenviar un mensaje a un chat o a
 * un proyecto». Destinos: los mismos del reenvío de archivos (personas, grupos
 * y conversaciones de proyecto con escritura).
 *
 * AGENTS (2026-11-18, SynerLink prod msg 35511): `idAgent` forwards to the
 * user's direct conversation with that agent (created if missing, like opening
 * the chat). It is published as a regular user message, so the agent's inbox
 * picks it up as if the user had typed it. Only agents the user has assigned
 * (lib/chat/forward-to-agent.ts). A direct thread is never a target by
 * `idConversation`: only by `idAgent`, which re-checks the agent permission.
 *
 * SEGURIDAD — DOS PUERTAS, como el reenvío de adjuntos:
 *   1. ORIGEN: guardConversation() sobre la conversación del mensaje, y el
 *      mensaje tiene que ser de ESA conversación. Si no, 404 sin pistas.
 *   2. DESTINO: puertaDestinoReenvio() (membresía y escritura), or
 *      agentForwardGate() for an agent (agent assigned + thread ownership).
 *
 * Lo publica quien reenvía (publicarMensajeDePersona): el texto original con
 * una línea de quién era, las menciones del original neutralizadas y una COPIA
 * de sus adjuntos en la carpeta del destino. Avisos del sistema y stickers/GIF
 * no se reenvían.
 */
type Params = { params: Promise<{ id: string; messageId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id, messageId } = await params;
    const origen = await mensajeVisible(id, messageId);
    if ('response' in origen) return origen.response;

    const [destinos, agentes] = await Promise.all([
      destinosDe(origen.user, origen.idConversation),
      agentForwardDestinations(origen.user, origen.idConversation),
    ]);
    return jsonNoStore({ destinos: ordenarDestinos([...destinos, ...agentes]) });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/messages/[messageId]/reenviar', error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id, messageId } = await params;
    const origen = await mensajeVisible(id, messageId);
    if ('response' in origen) return origen.response;
    const { mensaje } = origen;

    const datos = await readJsonBody(request);
    if (!datos) return badRequest('El cuerpo debe ser un objeto JSON.');

    const toAgent = datos.idAgent !== undefined && datos.idAgent !== null;
    const idDestino = Number(toAgent ? datos.idAgent : datos.idConversation);
    if (!Number.isInteger(idDestino) || idDestino <= 0) return badRequest('Elija a dónde reenviar el mensaje.');
    if (!toAgent && idDestino === origen.idConversation) return badRequest('El mensaje ya está en esta conversación.');

    let nota = '';
    if (typeof datos.body === 'string' && datos.body.trim() !== '') {
      const normalizada = normalizeMessageBody(datos.body, MAX_NOTA_REENVIO);
      if (!normalizada.ok) return badRequest(normalizada.error);
      nota = normalizada.body;
    }

    const destino = toAgent
      ? await agentForwardGate(origen.user, idDestino, origen.idConversation)
      : await puertaDestinoReenvio(idDestino);
    if ('response' in destino) return destino.response;

    const adjuntos = mensaje.attachments.filter((a) => a.onedrive_item_id);
    if (adjuntos.length > MAX_ADJUNTOS_REENVIO) {
      return badRequest(`El mensaje tiene más de ${MAX_ADJUNTOS_REENVIO} adjuntos; reenvíelos por separado.`);
    }
    for (const a of adjuntos) {
      if (isBlockedAttachmentExtension(a.file_name)) return badRequest(`«${a.file_name}» no se puede reenviar.`);
      if (a.size_bytes !== null && a.size_bytes > MAX_CHAT_ATTACHMENT_BYTES) {
        return badRequest(`«${a.file_name}» supera el tamaño máximo de un adjunto.`);
      }
    }

    const autor =
      mensaje.agentAuthor?.display_name ??
      (mensaje.userAuthor ? mensaje.userAuthor.name?.trim() || mensaje.userAuthor.email : null) ??
      (mensaje.role === 'agent' ? 'el asistente' : 'una persona');
    const cuerpo = normalizeMessageBody(armarCuerpoReenvio({ nota, autor, original: mensaje.body }), MAX_MENSAJE_REENVIADO);
    if (!cuerpo.ok) return badRequest(cuerpo.error);

    // OneDrive primero (bajar y subir), la base después: si algo falla no
    // queda ningún mensaje a medias.
    const now = new Date();
    let uploaded: Awaited<ReturnType<typeof uploadChatAttachments>> = [];
    if (adjuntos.length > 0) {
      try {
        const copias = [];
        for (const a of adjuntos) {
          const contenido = await downloadChatAttachment(a.onedrive_item_id as string);
          if (!contenido?.stream) throw new Error('No se pudo bajar el archivo de OneDrive');
          const blob = await new Response(contenido.stream).blob();
          if (blob.size > MAX_CHAT_ATTACHMENT_BYTES) {
            return badRequest(`«${a.file_name}» supera el tamaño máximo de un adjunto.`);
          }
          copias.push({ fileName: a.file_name, contentType: a.content_type, size: blob.size, blob });
        }
        uploaded = await uploadChatAttachments(destino.conversationId, copias, now);
      } catch (error) {
        console.error('[chat/reenviar-mensaje] no se pudieron copiar los adjuntos en OneDrive:', error);
        return jsonNoStore({ error: 'No se pudieron copiar los adjuntos. No se reenvió.' }, { status: 502 });
      }
    }

    const { clientIp, userAgent } = readClientOrigin(request);
    const { message } = await publicarMensajeDePersona(destino, { body: cuerpo.body, uploaded, clientIp, userAgent, now });

    return jsonNoStore({ message: serializeMessage(message) }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/conversations/[id]/messages/[messageId]/reenviar', error);
  }
}

/* ───────────────────────────── Ayudantes ────────────────────────────── */

/** 1. Puerta del ORIGEN: quien pide ve la conversación y el mensaje es de ella. */
async function mensajeVisible(rawId: string, rawMessageId: string) {
  const guard = await guardConversation(rawId);
  if ('response' in guard) return guard;

  const idMessage = Number.parseInt(rawMessageId, 10);
  if (!/^\d+$/.test(rawMessageId) || !Number.isInteger(idMessage) || idMessage <= 0) {
    return { response: noEncontrado() };
  }

  const mensaje = await prisma.chatMessage.findUnique({
    where: { id: idMessage },
    select: {
      id_conversation: true,
      role: true,
      body: true,
      userAuthor: { select: { name: true, email: true } },
      agentAuthor: { select: { display_name: true } },
      attachments: {
        select: { file_name: true, content_type: true, size_bytes: true, onedrive_item_id: true },
        orderBy: { id: 'asc' },
      },
    },
  });
  // Mismo 404 para «no existe» y «es de otra conversación».
  if (!mensaje || mensaje.id_conversation !== guard.conversationId) return { response: noEncontrado() };
  if (mensaje.role === 'system') return { response: badRequest('Los avisos del sistema no se reenvían.') };

  // Si la tabla de stickers aún no existe en esa base, no hay stickers que frenar.
  const media = await prisma.chatMessageMedia
    .findFirst({ where: { id_message: idMessage }, select: { id_message: true } })
    .catch(() => null);
  if (media) return { response: badRequest('Los stickers y GIF no se reenvían.') };

  return { user: guard.user as ChatSessionUser, idConversation: guard.conversationId, mensaje };
}

function noEncontrado() {
  return jsonNoStore({ error: 'Mensaje no encontrado.' }, { status: 404 });
}
