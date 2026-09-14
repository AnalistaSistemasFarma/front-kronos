/**
 * AVISO DE RESPUESTA DEL AGENTE — notificación en la app + push al dispositivo.
 *
 * Cuando un agente contesta en el chat de "Asistentes IA", la persona solo se
 * enteraba si tenía el chat abierto: el endpoint del agente publicaba el
 * mensaje y ahí terminaba. Este módulo cierra ese hueco reusando la misma
 * tubería de avisos del resto de SynerLink (`lib/notifications.js`): guarda la
 * notificación en la tabla `notifications` —la campanita— y manda el push a
 * los dispositivos suscritos.
 *
 * Decisiones de diseño:
 *
 *  - **El icono del push es la foto del agente** (`agent.avatar_url`, p. ej.
 *    `/agents/orus.jpg`). Ver quién responde es más diciente que el logo
 *    genérico. Si el agente no tiene foto, el service worker cae al icono de
 *    SynerLink; nunca se manda una URL externa.
 *  - **No se notifica lo que la persona ya está mirando.** Esa decisión NO
 *    vive aquí sino en el service worker (`public/sw.js`), que omite mostrar
 *    la notificación si hay una pestaña visible parada en esa conversación.
 *    Se hizo allá a propósito: el servidor no puede saber qué tiene abierto el
 *    navegador, y la notificación de la campanita sí debe quedar registrada
 *    igual para que aparezca en el historial.
 *  - **Nunca lanza.** Un fallo de aviso no puede tumbar la respuesta del
 *    agente, que ya está escrita en la base. Todo error se registra y se
 *    traga.
 */
import { prisma } from '../prisma';
// notifications.js es JavaScript, tipado por su JSDoc (igual que el resto de
// los llamadores: view-request, view-ticket, workflowEngine).
import { createAndSendNotifications } from '../notifications.js';

/** Tope del cuerpo del aviso. Las respuestas del agente pueden ser largas. */
const MAX_BODY_CHARS = 140;

export interface NotifyAgentReplyInput {
  idConversation: number;
  /**
   * Dueño del hilo DIRECTO (chat_conversation.id_user). En un grupo va en
   * null: allí los destinatarios son varios y llegan en `groupEmails`.
   */
  idUser: string | null;
  agentCode: string;
  agentName: string;
  agentAvatarUrl: string | null;
  /** Cuerpo en Markdown de la respuesta. Puede venir vacío si solo van archivos. */
  body: string;
  attachmentCount: number;
  /**
   * GRUPO: correos de las personas del grupo. Se avisa a todas porque en un
   * grupo la respuesta es para el grupo, no para quien preguntó — y quien
   * tenga el grupo abierto no verá la notificación de todas formas (lo filtra
   * el service worker, ver la nota de arriba).
   */
  groupEmails?: string[];
  /** GRUPO: el nombre del grupo, para que el aviso diga en cuál fue. */
  groupTitle?: string | null;
}

/**
 * Resumen legible de una respuesta en Markdown para el cuerpo de la
 * notificación: primera línea con contenido, sin adornos de Markdown y
 * recortada. Un `##` o un `**` en una notificación del sistema se ve como un
 * error, no como formato.
 */
export function summarizeReply(body: string, attachmentCount: number): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    if (attachmentCount === 1) return 'Le envió un archivo.';
    if (attachmentCount > 1) return `Le envió ${attachmentCount} archivos.`;
    return 'Le respondió en el chat.';
  }

  const plain = firstLine
    .replace(/^#{1,6}\s+/, '') // títulos
    .replace(/^[-*+]\s+/, '') // viñetas
    .replace(/^>\s+/, '') // citas
    .replace(/\*\*(.+?)\*\*/g, '$1') // negrita
    .replace(/(?<!\w)[*_](.+?)[*_](?!\w)/g, '$1') // cursiva
    .replace(/`(.+?)`/g, '$1') // código
    .replace(/\[(.+?)\]\((?:[^)]+)\)/g, '$1') // enlaces: se queda el texto
    .trim();

  const summary = plain.length > MAX_BODY_CHARS ? `${plain.slice(0, MAX_BODY_CHARS - 1)}…` : plain;

  if (attachmentCount > 0) {
    const sufijo = attachmentCount === 1 ? ' (+1 archivo)' : ` (+${attachmentCount} archivos)`;
    return `${summary}${sufijo}`;
  }
  return summary;
}

export async function notifyAgentReply(input: NotifyAgentReplyInput): Promise<void> {
  try {
    const esGrupo = Array.isArray(input.groupEmails);

    let destinatarios: string[] = [];
    if (esGrupo) {
      destinatarios = (input.groupEmails ?? [])
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
    } else if (input.idUser) {
      const user = await prisma.user.findUnique({
        where: { id: input.idUser },
        select: { email: true },
      });
      const email = user?.email?.trim();
      if (email) destinatarios = [email];
    }

    if (destinatarios.length === 0) {
      console.warn(
        `[chat/notify] la conversación ${input.idConversation} no tiene a quién avisarle.`
      );
      return;
    }

    await createAndSendNotifications(destinatarios, {
      title: esGrupo
        ? `${input.agentName} · ${input.groupTitle?.trim() || 'Grupo'}`
        : input.agentName,
      body: summarizeReply(input.body, input.attachmentCount),
      // Enlace profundo al hilo. Se usa la RUTA DEDICADA del agente
      // (/process/chat/<code>) y no el parámetro ?agent=, porque esa página
      // llega con el agente ya seleccionado desde el servidor
      // (initialAgentCode). El parámetro depende de un efecto en el navegador
      // y, al abrir la aplicación desde cero por una notificación, se veía la
      // lista de agentes en vez de la conversación.
      url: esGrupo
        ? `/process/chat/grupo/${input.idConversation}`
        : `/process/chat/${encodeURIComponent(input.agentCode)}`,
      // Un `tag` por conversación: si el agente manda varios mensajes, la
      // notificación se reemplaza en vez de apilarse.
      tag: `chat-agente-${input.idConversation}`,
      icon: input.agentAvatarUrl ?? undefined,
    });
  } catch (error) {
    console.error('[chat/notify] no se pudo avisar la respuesta del agente:', error);
  }
}
