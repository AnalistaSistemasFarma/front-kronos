import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { authenticateAgent, resolveAgentConversation } from '../../../../../lib/chat/agent-auth';
import { messageInclude, serializeMessage } from '../../../../../lib/chat/conversations';
import {
  AVISO_CADENA_CORTADA,
  calcularEntregas,
  contarTurnosDeAgenteAlFinal,
} from '../../../../../lib/chat/groups';
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
 *  - resolveAgentConversation() verifica que la conversación sea de ESTE agente
 *    —o que el agente sea integrante del grupo— antes de escribir nada
 *    (anti-IDOR del lado del bot). Si no lo es, 404: no se le confirma al bot
 *    que el hilo existe.
 *  - El body es Markdown crudo con tope de longitud; jamás HTML.
 *  - Los adjuntos se validan por EXTENSIÓN y TAMAÑO en el servidor
 *    (lib/chat/attachments.ts), sin confiar en el `Content-Type` declarado: un
 *    bot es un cliente HTTP más y puede mandar lo que quiera en esa cabecera.
 *
 * -------------------------------------------------------------------------
 * EN UN GRUPO: MENCIONES Y TOPE CONTRA EL BUCLE
 * -------------------------------------------------------------------------
 * Un agente puede mencionar a otro con `@` y así pasarle el turno. Las dos
 * reglas que evitan que eso se vuelva una fuga de consumo (decisiones de
 * Nicolás, 2026-09-08):
 *
 *   1. Solo se le entrega a los agentes MENCIONADOS, y nunca al propio autor.
 *   2. Tope de MAX_TURNOS_AGENTE_SEGUIDOS turnos encadenados entre agentes sin
 *      que escriba una persona. Al pasarse, las menciones NO se entregan y
 *      queda un mensaje de sistema en el grupo diciendo que se cortó. Se deja
 *      el aviso a propósito: un mensaje que desaparece en silencio es un
 *      misterio; uno que dice por qué se detuvo es información.
 *
 * El conteo de turnos se hace DENTRO de la transacción, sobre los últimos
 * mensajes del grupo. Si se hiciera antes, dos agentes contestando a la vez
 * podrían leer el mismo conteo y colarse los dos.
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

    const conversation = await resolveAgentConversation(agent.idAgent, Number(fields.idConversation));
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
    const { created: message, entregas } = await prisma.$transaction(async (tx) => {
      // A quién le pasa el turno este mensaje. Solo aplica en grupos; en un
      // hilo directo no hay nadie más a quien mencionar.
      let entregas = { idAgents: [] as number[], cadenaCortada: false };
      let avisoYaEstaba = false;

      if (conversation.kind === 'group') {
        // El conteo va DENTRO de la transacción: si se hiciera antes, dos
        // agentes contestando a la vez leerían el mismo número y los dos se
        // colarían por encima del tope.
        const ultimos = await tx.chatMessage.findMany({
          where: { id_conversation: conversation.id },
          orderBy: { id: 'desc' },
          // Alcanza con mirar unos pocos: la cuenta se corta en el primer
          // mensaje de una persona hacia atrás.
          take: 12,
          // El `body` es para no repetir el aviso de cadena cortada (abajo).
          select: { role: true, body: true },
        });
        const turnosPrevios = contarTurnosDeAgenteAlFinal([...ultimos].reverse());

        // ¿El último mensaje del grupo YA es el aviso de cadena cortada? Un
        // bot que insista vuelve a chocar con el tope en cada intento, y sin
        // esto el grupo se llena de avisos idénticos. Se detectó probando en
        // pruebas: cuatro intentos seguidos dejaban cuatro avisos iguales.
        avisoYaEstaba =
          ultimos.length > 0 &&
          ultimos[0].role === 'system' &&
          ultimos[0].body === AVISO_CADENA_CORTADA;

        entregas = calcularEntregas({
          body,
          agentesDelGrupo: conversation.agentes,
          idAgentAutor: agent.idAgent,
          turnosPrevios,
        });
      }

      const created = await tx.chatMessage.create({
        data: {
          id_conversation: conversation.id,
          role: 'agent',
          body,
          created_at: now,
          // El AUTOR sale de la llave, nunca del payload.
          id_agent_author: agent.idAgent,
          // El agente escribe: su propio mensaje nace ya entregado.
          delivered_at: now,
          // Mensaje y adjuntos, una sola escritura: o entran los dos o ninguno.
          ...(uploaded.length > 0 ? { attachments: { create: uploaded } } : {}),
          // Mensaje y entregas, también: un mensaje que menciona a alguien que
          // nunca se enteraría sería peor que no haberlo escrito.
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

      // El tope frenó una mención: queda dicho en el grupo. Sin autor, porque
      // no lo escribió nadie. Y una sola vez: si el aviso ya era el último
      // mensaje, no se repite.
      if (entregas.cadenaCortada && !avisoYaEstaba) {
        await tx.chatMessage.create({
          data: {
            id_conversation: conversation.id,
            role: 'system',
            body: AVISO_CADENA_CORTADA,
            created_at: new Date(now.getTime() + 1),
            delivered_at: now,
          },
        });
      }

      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { last_message_at: now },
      });

      await tx.chatAgentStatus.upsert({
        where: {
          id_conversation_id_agent: { id_conversation: conversation.id, id_agent: agent.idAgent },
        },
        create: { id_conversation: conversation.id, id_agent: agent.idAgent, state, label },
        update: { state, label },
      });

      return { created, entregas };
    });

    // AVISO A QUIEN CORRESPONDA. Va DESPUÉS de la transacción y sin `await`: la
    // respuesta del agente ya está publicada y no debe quedar en vilo porque
    // un endpoint de push esté lento o una suscripción esté vencida. Los
    // errores se registran adentro; nunca se propagan al bot.
    if (conversation.kind === 'group') {
      // En un grupo se le avisa a todas las personas del grupo. Se resuelven
      // los correos aquí y no dentro del aviso para no meter otra consulta en
      // el camino caliente de la transacción.
      const personas = await prisma.chatParticipant.findMany({
        where: { id_conversation: conversation.id, id_user: { not: null } },
        select: { user: { select: { email: true } } },
      });
      void notifyAgentReply({
        idConversation: conversation.id,
        idUser: null,
        groupEmails: personas.map((p) => p.user?.email ?? '').filter((e) => e.length > 0),
        groupTitle: conversation.title,
        agentCode: agent.code,
        agentName: agent.displayName,
        agentAvatarUrl: agent.avatarUrl,
        body,
        attachmentCount: uploaded.length,
      });
    } else {
      void notifyAgentReply({
        idConversation: conversation.id,
        idUser: conversation.idUser,
        agentCode: agent.code,
        agentName: agent.displayName,
        agentAvatarUrl: agent.avatarUrl,
        body,
        attachmentCount: uploaded.length,
      });
    }

    return jsonNoStore(
      {
        message: serializeMessage(message),
        // Para que el bot sepa a quién le pasó el turno, y cuándo el tope lo
        // frenó: si no se le dice, vuelve a intentarlo sin entender por qué
        // nadie contesta.
        notifiedAgents: entregas.idAgents,
        chainStopped: entregas.cadenaCortada,
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError('POST /api/chat/agent/messages', error);
  }
}
