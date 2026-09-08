import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { assertAgentConversation, authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { serializeMessage } from '../../../../../lib/chat/conversations';
import {
  MAX_AGENT_MESSAGE_CHARS,
  MAX_STATUS_LABEL_CHARS,
  isAgentState,
  normalizeMessageBody,
} from '../../../../../lib/chat/constants';
import {
  badRequest,
  jsonNoStore,
  readMessageRequest,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';
import {
  collectChatAttachments,
  type ChatAttachmentCandidate,
} from '../../../../../lib/chat/attachments';
import {
  uploadChatAttachments,
  type UploadedChatAttachment,
} from '../../../../../lib/chat/attachmentStorage';
import { notifyAgentReply } from '../../../../../lib/chat/notifyAgentReply';

export const dynamic = 'force-dynamic';

/**
 * RESPUESTA DEL AGENTE — publica un mensaje del agente en una conversación.
 *
 *   POST /api/chat/agent/messages
 *   Authorization: Bearer <llave del agente>
 *   { "idConversation": 12, "body": "…markdown…", "state": "idle", "label": null }
 *
 * Con adjuntos, la MISMA ruta y los MISMOS nombres de campo, pero en
 * `multipart/form-data`:
 *
 *   idConversation=12  body=…markdown…  state=idle  label=…
 *   files=<archivo>  files=<archivo>  …
 *
 * El camino JSON de solo texto no cambia: un bot que ya lo usa sigue igual.
 * Con adjuntos el `body` puede ir vacío; lo que se rechaza es un mensaje sin
 * texto y sin archivos.
 *
 * `state`/`label` son opcionales: dejan el indicador de "qué está haciendo" en
 * el valor que corresponda al terminar de responder. Si no vienen, el estado
 * queda en 'idle' — responder ES terminar de trabajar, y dejar el indicador
 * colgado en "Pensando…" después de contestar sería un error visible para el
 * usuario.
 *
 * -------------------------------------------------------------------------
 * SEGURIDAD
 * -------------------------------------------------------------------------
 *  - El AGENTE sale de la LLAVE. El payload NO lleva ni puede llevar un
 *    id_agent: un bot no puede escribir haciéndose pasar por otro.
 *  - El `role` lo pone el servidor ('agent'). No se acepta del cliente.
 *  - assertAgentConversation() verifica que la conversación sea de ESTE agente
 *    antes de escribir nada (anti-IDOR del lado del bot). Si no lo es, 404: no
 *    se le confirma al bot que el hilo existe.
 *  - El body es Markdown crudo con tope de longitud; jamás HTML.
 *  - Los adjuntos se validan por EXTENSIÓN y TAMAÑO en el servidor
 *    (lib/chat/attachments.ts), sin confiar en el `Content-Type` declarado: un
 *    bot es un cliente HTTP más y puede mandar lo que quiera en esa cabecera.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const payload = await readMessageRequest(request);
    if (!payload) {
      return badRequest('El cuerpo debe ser un objeto JSON o un formulario multipart/form-data.');
    }
    const fields = payload.fields;

    const conversation = await assertAgentConversation(agent.idAgent, Number(fields.idConversation));
    if (!conversation) {
      return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    let files: ChatAttachmentCandidate[] = [];
    if (payload.form) {
      const collected = collectChatAttachments(payload.form);
      if (!collected.ok) return badRequest(collected.error);
      files = collected.files;
    }

    // Con adjuntos, el texto es opcional. Sin adjuntos, se exige como siempre.
    const rawBody = typeof fields.body === 'string' ? fields.body : '';
    let body = '';
    if (files.length === 0 || rawBody.trim() !== '') {
      const normalized = normalizeMessageBody(fields.body, MAX_AGENT_MESSAGE_CHARS);
      if (!normalized.ok) return badRequest(normalized.error);
      body = normalized.body;
    }

    let state = 'idle';
    if (fields.state !== undefined && fields.state !== null && fields.state !== '') {
      if (!isAgentState(fields.state)) {
        return badRequest("state debe ser 'idle', 'thinking' o 'tool'.");
      }
      state = fields.state;
    }

    let label: string | null = null;
    if (fields.label !== undefined && fields.label !== null) {
      if (typeof fields.label !== 'string') return badRequest('label debe ser texto.');
      label = fields.label.trim().slice(0, MAX_STATUS_LABEL_CHARS) || null;
    }

    const now = new Date();

    // OneDrive primero: si falla, no se escribe nada en la base.
    let uploaded: UploadedChatAttachment[] = [];
    if (files.length > 0) {
      try {
        uploaded = await uploadChatAttachments(conversation.id, files, now);
      } catch (error) {
        console.error('[chat] no se pudieron subir los adjuntos del agente a OneDrive:', error);
        return jsonNoStore(
          { error: 'No se pudieron guardar los adjuntos. El mensaje no se publicó.' },
          { status: 502 }
        );
      }
    }

    // Transacción: el mensaje, la marca de la bandeja y el estado del indicador
    // son un solo hecho ("el agente respondió"). Si se aplicaran por separado,
    // un fallo intermedio dejaría al usuario viendo "Pensando…" con la
    // respuesta ya publicada, o al revés.
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          id_conversation: conversation.id,
          role: 'agent',
          body,
          created_at: now,
          // El agente escribe: su propio mensaje nace ya entregado.
          delivered_at: now,
          // Mensaje y adjuntos, una sola escritura: o entran los dos o ninguno.
          ...(uploaded.length > 0 ? { attachments: { create: uploaded } } : {}),
        },
        include: { attachments: true },
      });

      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { last_message_at: now },
      });

      await tx.chatAgentStatus.upsert({
        where: { id_conversation: conversation.id },
        create: { id_conversation: conversation.id, state, label },
        update: { state, label },
      });

      return created;
    });

    // AVISO AL DUEÑO DEL HILO. Va DESPUÉS de la transacción y sin `await`: la
    // respuesta del agente ya está publicada y no debe quedar en vilo porque
    // un endpoint de push esté lento o una suscripción esté vencida. Los
    // errores se registran adentro; nunca se propagan al bot.
    void notifyAgentReply({
      idConversation: conversation.id,
      idUser: conversation.idUser,
      agentCode: agent.code,
      agentName: agent.displayName,
      agentAvatarUrl: agent.avatarUrl,
      body,
      attachmentCount: uploaded.length,
    });

    return jsonNoStore({ message: serializeMessage(message) }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/agent/messages', error);
  }
}
