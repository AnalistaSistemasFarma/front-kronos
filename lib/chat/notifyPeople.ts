/**
 * AVISOS de los hilos ENTRE PERSONAS (decisión D7, OBLIGATORIA según Nicolás,
 * 2026-09-29): push por cada mensaje directo y por CADA zumbido, con un `tag`
 * por conversación y por clase (`chat-dm-<id>`, `chat-nudge-<id>`): varios
 * mensajes seguidos reemplazan la notificación en vez de apilarse, y un
 * zumbido no pisa el aviso de un mensaje ni al revés.
 *
 * Límite de los MENSAJES: ver "FRENO DE LOS MENSAJES" abajo. El zumbido no se
 * limita aquí: ya tiene los suyos (D4).
 *
 * Desde el 2026-10-01 es SOLO PUSH (`skipBell`): ya no crea fila en la campana
 * de SynerLink, que era redundante con el contador del propio chat.
 *
 * Mismo criterio que lib/chat/notifyAgentReply.ts: reutiliza la tubería de
 * avisos de SynerLink (push), el service worker omite el aviso si
 * la persona ya tiene esa conversación a la vista, y NUNCA lanza — el mensaje
 * ya quedó escrito y un aviso fallido no puede tumbar la respuesta —. Se llama
 * sin `await` desde el endpoint (`void notify…`), para no demorar el envío.
 */
import { prisma } from '../prisma';
import { createAndSendNotifications } from '../notifications.js';
import { summarizeReply } from './notifyAgentReply';
import { DM_PUSH_COOLDOWN_MS, NUDGE_VIBRATE_PATTERN, debeNotificarDirecto } from './people-rules';

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

/*
 * FRENO DE LOS MENSAJES (60 s por conversación y receptor).
 *
 * Hasta el 2026-10-01 se leía la última fila de la campana (`notifications`).
 * Desde que los avisos del chat ya NO crean fila (solo push: el chat tiene su
 * propio contador), el freno sale de dos fuentes, sin migraciones:
 *
 *   1. La BASE: si el remitente no había escrito en este hilo en los 60 s
 *      anteriores, es el primer mensaje de la tanda y SIEMPRE se avisa. Vale
 *      igual en las dos instancias de GSS-Front (prod corre 2).
 *   2. La MEMORIA del proceso: en una tanda seguida, como mucho un push cada
 *      60 s por instancia (con 2 instancias, a lo sumo 2 por minuto).
 *
 * Si la consulta falla se avisa igual: el push de los directos es obligatorio
 * (D7) y el límite es solo un freno.
 */
const ultimoPushPorHilo = new Map<string, number>();

function frenoEnMemoria(clave: string, ahora: number): boolean {
  const ultima = ultimoPushPorHilo.get(clave);
  if (!debeNotificarDirecto(ultima !== undefined ? new Date(ultima) : null, new Date(ahora))) {
    return false;
  }
  ultimoPushPorHilo.set(clave, ahora);
  // Que no crezca sin límite en un proceso que vive semanas.
  if (ultimoPushPorHilo.size > 2000) {
    for (const [k, t] of ultimoPushPorHilo) {
      if (ahora - t > DM_PUSH_COOLDOWN_MS) ultimoPushPorHilo.delete(k);
    }
  }
  return true;
}

async function tocaAvisarDirecto(input: {
  idConversation: number;
  idRemitente: string;
  idDestino: string;
  idMessage?: number;
  createdAt?: Date;
}): Promise<boolean> {
  const clave = `${input.idConversation}:${input.idDestino}`;
  try {
    if (input.idMessage && input.createdAt) {
      const previo = await prisma.chatMessage.findFirst({
        where: {
          id_conversation: input.idConversation,
          id_user_author: input.idRemitente,
          id: { lt: input.idMessage },
          created_at: { gt: new Date(input.createdAt.getTime() - DM_PUSH_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      // Primer mensaje de la tanda: se avisa y se arranca el reloj en memoria.
      if (!previo) {
        ultimoPushPorHilo.set(clave, Date.now());
        return true;
      }
    }
  } catch (error) {
    console.error('[chat/notify-people] no se pudo revisar el límite del aviso:', error);
    return true;
  }
  return frenoEnMemoria(clave, Date.now());
}

/** Push del MENSAJE de una persona a la otra. */
export async function notifyPeopleMessage(input: {
  idConversation: number;
  idRemitente: string;
  idDestino: string;
  body: string;
  attachmentCount: number;
  /** El mensaje recién creado: con él se reconoce el primero de una tanda. */
  idMessage?: number;
  createdAt?: Date;
}): Promise<void> {
  try {
    const datos = await datosDeAviso(input.idConversation, input.idRemitente, input.idDestino);
    if (!datos.correo) return;
    const url = urlDelHilo(input.idConversation);
    if (!(await tocaAvisarDirecto(input))) return;
    await createAndSendNotifications(
      [datos.correo],
      {
        title: datos.nombre,
        body: summarizeReply(input.body, input.attachmentCount),
        url,
        tag: `chat-dm-${input.idConversation}`,
        icon: datos.icono,
      },
      // Solo push: el chat ya tiene su contador; en la campana era redundante.
      { skipBell: true }
    );
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
    }, { skipBell: true });
  } catch (error) {
    console.error('[chat/notify-people] no se pudo avisar el zumbido:', error);
  }
}
