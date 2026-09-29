/**
 * AVISOS de los hilos ENTRE PERSONAS (decisión D7): push por mensaje directo y
 * por zumbido, con un `tag` por conversación para que varios mensajes seguidos
 * reemplacen la notificación en vez de apilarse.
 *
 * Mismo criterio que lib/chat/notifyAgentReply.ts: reutiliza la tubería de
 * avisos de SynerLink (campanita + push), el service worker omite el aviso si
 * la persona ya tiene esa conversación a la vista, y NUNCA lanza — el mensaje
 * ya quedó escrito y un aviso fallido no puede tumbar la respuesta —. Se llama
 * sin `await` desde el endpoint (`void notify…`), para no demorar el envío.
 */
import { prisma } from '../prisma';
import { createAndSendNotifications } from '../notifications.js';
import { summarizeReply } from './notifyAgentReply';
import { NUDGE_VIBRATE_PATTERN } from './people-rules';

function urlDelHilo(idConversation: number): string {
  return `/process/chat/persona/${idConversation}`;
}

async function datosDeAviso(idConversation: number, idRemitente: string, idDestino: string) {
  const [remitente, destino, participacion] = await Promise.all([
    prisma.user.findUnique({ where: { id: idRemitente }, select: { name: true, email: true, image: true } }),
    prisma.user.findUnique({ where: { id: idDestino }, select: { email: true } }),
    prisma.chatParticipant.findFirst({
      where: { id_conversation: idConversation, id_user: idDestino },
      select: { nudges_muted: true },
    }),
  ]);
  return {
    nombre: remitente?.name?.trim() || remitente?.email || 'Alguien',
    // El icono solo si es una ruta propia: nunca se manda una URL externa.
    icono: remitente?.image && remitente.image.startsWith('/') ? remitente.image : undefined,
    correo: destino?.email?.trim() || null,
    silenciado: Boolean(participacion?.nudges_muted),
  };
}

/** Push del MENSAJE de una persona a la otra. */
export async function notifyPeopleMessage(input: {
  idConversation: number;
  idRemitente: string;
  idDestino: string;
  body: string;
  attachmentCount: number;
}): Promise<void> {
  try {
    const datos = await datosDeAviso(input.idConversation, input.idRemitente, input.idDestino);
    if (!datos.correo) return;
    await createAndSendNotifications([datos.correo], {
      title: datos.nombre,
      body: summarizeReply(input.body, input.attachmentCount),
      url: urlDelHilo(input.idConversation),
      tag: `chat-persona-${input.idConversation}`,
      icon: datos.icono,
    });
  } catch (error) {
    console.error('[chat/notify-people] no se pudo avisar el mensaje:', error);
  }
}

/**
 * Push del ZUMBIDO. Si quien lo recibe silenció los zumbidos de ese hilo, no
 * se manda nada (y el remitente no se entera: decisión D5).
 */
export async function notifyPeopleNudge(input: {
  idConversation: number;
  idRemitente: string;
  idDestino: string;
}): Promise<void> {
  try {
    const datos = await datosDeAviso(input.idConversation, input.idRemitente, input.idDestino);
    if (!datos.correo || datos.silenciado) return;
    await createAndSendNotifications([datos.correo], {
      title: `📳 ${datos.nombre}`,
      body: 'Le envió un zumbido.',
      url: urlDelHilo(input.idConversation),
      tag: `chat-persona-${input.idConversation}`,
      icon: datos.icono,
      vibrate: NUDGE_VIBRATE_PATTERN,
    });
  } catch (error) {
    console.error('[chat/notify-people] no se pudo avisar el zumbido:', error);
  }
}
