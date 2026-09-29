/**
 * AVISOS de los hilos ENTRE PERSONAS (decisión D7, OBLIGATORIA según Nicolás,
 * 2026-09-29): push por cada mensaje directo y por CADA zumbido, con un `tag`
 * por conversación y por clase (`chat-dm-<id>`, `chat-nudge-<id>`): varios
 * mensajes seguidos reemplazan la notificación en vez de apilarse, y un
 * zumbido no pisa el aviso de un mensaje ni al revés.
 *
 * Límite de los MENSAJES (ajuste previo al pase a producción): como mucho un
 * aviso por conversación y receptor cada 60 s (`debeNotificarDirecto`). Si ya
 * hubo uno en ese lapso no se crea fila ni se manda push. El zumbido no se
 * limita aquí: ya tiene los suyos (D4).
 *
 * Mismo criterio que lib/chat/notifyAgentReply.ts: reutiliza la tubería de
 * avisos de SynerLink (campanita + push), el service worker omite el aviso si
 * la persona ya tiene esa conversación a la vista, y NUNCA lanza — el mensaje
 * ya quedó escrito y un aviso fallido no puede tumbar la respuesta —. Se llama
 * sin `await` desde el endpoint (`void notify…`), para no demorar el envío.
 */
import { prisma } from '../prisma';
import { createAndSendNotifications, getLastNotificationAt } from '../notifications.js';
import { summarizeReply } from './notifyAgentReply';
import { NUDGE_VIBRATE_PATTERN, debeNotificarDirecto } from './people-rules';

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

/**
 * ¿Toca avisar este mensaje directo o ya hubo aviso de ESTE hilo a ESTE
 * receptor en los últimos 60 s? La notificación de mensaje se reconoce por la
 * url del hilo y el título (el nombre del remitente); la del zumbido lleva
 * otro título, así que no cuenta. Si la consulta falla se avisa igual: el
 * push de los directos es obligatorio (D7) y el límite es solo un freno.
 */
async function tocaAvisarDirecto(correo: string, url: string, titulo: string): Promise<boolean> {
  try {
    const { ultima, ahora } = await getLastNotificationAt(correo, url, titulo);
    return debeNotificarDirecto(ultima, ahora);
  } catch (error) {
    console.error('[chat/notify-people] no se pudo revisar el límite del aviso:', error);
    return true;
  }
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
    const url = urlDelHilo(input.idConversation);
    if (!(await tocaAvisarDirecto(datos.correo, url, datos.nombre))) return;
    await createAndSendNotifications([datos.correo], {
      title: datos.nombre,
      body: summarizeReply(input.body, input.attachmentCount),
      url,
      tag: `chat-dm-${input.idConversation}`,
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
      title: `📳 ${datos.nombre} le envió un zumbido`,
      body: 'Toque para abrir la conversación.',
      url: urlDelHilo(input.idConversation),
      tag: `chat-nudge-${input.idConversation}`,
      icon: datos.icono,
      vibrate: NUDGE_VIBRATE_PATTERN,
    });
  } catch (error) {
    console.error('[chat/notify-people] no se pudo avisar el zumbido:', error);
  }
}
