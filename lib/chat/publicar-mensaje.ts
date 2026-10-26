import { prisma } from '../prisma';
import { messageInclude } from './conversations';
import { calcularEntregas } from './groups';
import { notifyPeopleMessage } from './notifyPeople';
import type { ConversationGuard } from './http';
import type { UploadedChatAttachment } from './attachmentStorage';

/** Una puerta de conversación YA superada (sin la rama de error). */
export type ConversationGuardOk = Exclude<ConversationGuard, { response: unknown }>;

/**
 * PUBLICA un mensaje de una PERSONA en una conversación cuya puerta ya pasó.
 *
 * Es el cuerpo de `POST /api/chat/conversations/<id>/messages`, sacado aparte
 * (2026-10-24) para que «Compartir → Reenviar por el chat» del visor de
 * adjuntos publique EXACTAMENTE igual que un envío normal: mismo autor (la
 * sesión), mismas entregas a los agentes mencionados en un grupo, mismo push
 * entre personas y la misma transacción mensaje + adjuntos + bandeja.
 *
 * Quien llama ya validó: la puerta (guardConversation), la escritura en un
 * proyecto, el texto y la cita. Los adjuntos llegan YA subidos a OneDrive.
 */
export async function publicarMensajeDePersona(
  guard: ConversationGuardOk,
  datos: {
    body: string;
    uploaded: UploadedChatAttachment[];
    idReplyTo?: number | null;
    clientIp: string | null;
    userAgent: string | null;
    now: Date;
  }
) {
  const { body, uploaded, now } = datos;
  const idReplyTo = datos.idReplyTo ?? null;

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

  // Transacción: el mensaje y la marca de tiempo de la bandeja entran juntos
  // o no entra ninguno. Si se separan, un fallo intermedio deja la bandeja
  // ordenada por un instante que no corresponde a ningún mensaje.
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        id_conversation: guard.conversationId,
        role: 'user',
        body,
        created_at: now,
        // El autor sale de la SESIÓN, nunca del payload.
        id_user_author: guard.user.id,
        // Desde dónde se escribió. Solo se guarda en los mensajes de
        // personas: el agente entra por la API con su llave, sin navegador.
        client_ip: datos.clientIp,
        user_agent: datos.userAgent,
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

  // Entre personas, push a la otra (decisión D7). Por detrás: no se espera.
  if (guard.kind === 'people') {
    void notifyPeopleMessage({
      idConversation: guard.conversationId,
      idRemitente: guard.user.id,
      idDestino: guard.otherUserId,
      body,
      attachmentCount: uploaded.length,
      idMessage: message.id,
      createdAt: message.created_at,
    });
  }

  // En un PROYECTO no hay menciones: todo mensaje va al agente del proyecto,
  // que lo recoge por el PUENTE de hilos (llave 'projects').
  const notifiedAgents = guard.kind === 'project' ? [guard.idAgent] : entregas.idAgents;
  return { message, notifiedAgents };
}
