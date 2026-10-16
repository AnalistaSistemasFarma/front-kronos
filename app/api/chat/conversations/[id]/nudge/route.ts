import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { messageInclude, serializeMessage } from '../../../../../../lib/chat/conversations';
import { readClientOrigin } from '../../../../../../lib/chat/client-origin';
import { notifyPeopleNudge } from '../../../../../../lib/chat/notifyPeople';
import {
  NUDGE_COOLDOWN_MS,
  NUDGE_EVENT_TYPE,
  NUDGE_MAX_PER_WINDOW,
  NUDGE_WINDOW_MS,
  segundosParaReintentar,
  segundosPorTopeDeVentana,
  textoDeZumbido,
} from '../../../../../../lib/chat/people-rules';
import {
  NO_STORE,
  badRequest,
  guardConversation,
  jsonNoStore,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * ZUMBIDO 📳 — "llamar la atención" de la otra persona de un hilo.
 *
 *   POST /api/chat/conversations/12/nudge
 *
 * Solo en hilos ENTRE PERSONAS (decisión D6): ni en grupos ni con agentes.
 *
 * El zumbido es un MENSAJE DE SISTEMA con `event_type = 'nudge'` y autor = quien
 * lo envía: queda en el hilo y en la auditoría como cualquier mensaje y le llega
 * a la otra persona por el mismo sondeo (y por el pulso global y el push).
 *
 * LÍMITES (D4), los dos respaldados en SQL para que valgan igual con las dos
 * instancias de producción:
 *   1. Diez cada diez minutos por remitente, sumando todos sus hilos.
 *   2. Uno cada 30 s por hilo: un UPDATE ATÓMICO sobre
 *      `chat_participant.last_nudge_at` que solo pasa si el último fue hace
 *      más de 30 s. Dos pestañas pulsando a la vez: una gana, la otra recibe
 *      429 — no hay ventana entre "leer" y "escribir" que se pueda colar.
 * Al pasarse se responde 429 con `Retry-After` en segundos.
 *
 * Si la otra persona silenció los zumbidos del hilo (D5), el mensaje igual se
 * escribe y el remitente no se entera; solo que a ella no le suena ni le llega
 * el push.
 */
function demasiados(segundos: number, mensaje: string) {
  const s = Math.max(1, Math.ceil(segundos));
  return NextResponse.json(
    { error: mensaje, retryAfterSeconds: s },
    { status: 429, headers: { ...NO_STORE, 'Retry-After': String(s) } }
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;
    if (guard.kind !== 'people') {
      return badRequest('El zumbido solo existe en las conversaciones entre personas.');
    }

    const ahora = new Date();

    // (1) Tope global por remitente. Se lee con el índice filtrado
    // chat_message_nudge_idx (solo filas de evento).
    const recientes = await prisma.chatMessage.findMany({
      where: {
        event_type: NUDGE_EVENT_TYPE,
        id_user_author: guard.user.id,
        created_at: { gt: new Date(ahora.getTime() - NUDGE_WINDOW_MS) },
      },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
      take: NUDGE_MAX_PER_WINDOW + 1,
    });
    const porVentana = segundosPorTopeDeVentana(
      recientes.map((r) => r.created_at),
      ahora
    );
    if (porVentana > 0) {
      return demasiados(porVentana, 'Ya envió muchos zumbidos seguidos. Espere un momento.');
    }

    // (2) Uno cada 30 s en este hilo: UPDATE atómico, pasa o no pasa.
    const reclamado = await prisma.chatParticipant.updateMany({
      where: {
        id_participant: guard.myParticipantId,
        OR: [
          { last_nudge_at: null },
          { last_nudge_at: { lte: new Date(ahora.getTime() - NUDGE_COOLDOWN_MS) } },
        ],
      },
      data: { last_nudge_at: ahora },
    });
    if (reclamado.count === 0) {
      const mio = await prisma.chatParticipant.findUnique({
        where: { id_participant: guard.myParticipantId },
        select: { last_nudge_at: true },
      });
      return demasiados(
        segundosParaReintentar(mio?.last_nudge_at ?? ahora, ahora) || 1,
        'Acaba de enviar un zumbido en esta conversación.'
      );
    }

    const remitente = await prisma.user.findUnique({
      where: { id: guard.user.id },
      select: { name: true, email: true },
    });
    const nombre = remitente?.name?.trim() || remitente?.email || guard.user.email;
    const { clientIp, userAgent } = readClientOrigin(request);

    const message = await prisma.$transaction(async (tx) => {
      const creado = await tx.chatMessage.create({
        data: {
          id_conversation: guard.conversationId,
          role: 'system',
          body: textoDeZumbido(nombre),
          event_type: NUDGE_EVENT_TYPE,
          created_at: ahora,
          // Autor de la SESIÓN: es lo que cuenta el tope y lo que ve la auditoría.
          id_user_author: guard.user.id,
          client_ip: clientIp,
          user_agent: userAgent,
        },
        include: messageInclude,
      });
      await tx.chatConversation.update({
        where: { id: guard.conversationId },
        data: { last_message_at: ahora },
      });
      return creado;
    });

    // El push va por detrás: no se espera para responder.
    void notifyPeopleNudge({
      idConversation: guard.conversationId,
      idRemitente: guard.user.id,
      idDestino: guard.otherUserId,
    });

    return jsonNoStore(
      { message: serializeMessage(message), cooldownSeconds: NUDGE_COOLDOWN_MS / 1000 },
      { status: 201 }
    );
  } catch (error) {
    return serverError('POST /api/chat/conversations/[id]/nudge', error);
  }
}
