import { prisma } from '../prisma';
import { messageInclude } from './conversations';
import { calcularEntregas } from './groups';
import { mencionablesDelHilo } from './projects';
import { entregasHiloProyecto } from '../proyectos/hilos-rules';
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

  // PROYECTO (2026-10-29, multiagente): una persona puede mencionar con @ a
  // otro agente designado en el proyecto al que ella misma le escribe. Ese
  // agente recibe el mensaje por SU puente (fila de entrega, como en un
  // grupo). Si mencionó solo a otros, el principal no lo atiende: el mensaje
  // nace entregado para él (lo verá en el historial de su próximo turno).
  let principalAtiende = true;
  if (guard.kind === 'project' && body.includes('@')) {
    const { principal, mencionables } = await mencionablesDelHilo(guard.user, guard.idProject, guard.projectRole, guard.idAgent);
    if (principal && mencionables.length > 0) {
      const r = entregasHiloProyecto({ body, mencionables, principal });
      entregas.idAgents = r.invitados;
      principalAtiende = r.principalAtiende;
    }
  }

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
        // Proyecto con menciones solo a otros agentes: el principal no lo recoge.
        ...(guard.kind === 'project' && !principalAtiende ? { delivered_at: now } : {}),
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

  // En un PROYECTO el mensaje va al agente principal (salvo que solo se haya
  // mencionado a otros) y a los mencionados; todos lo recogen por SU puente
  // de hilos (llave 'projects').
  const notifiedAgents =
    guard.kind === 'project' ? [...(principalAtiende ? [guard.idAgent] : []), ...entregas.idAgents] : entregas.idAgents;
  return { message, notifiedAgents };
}
