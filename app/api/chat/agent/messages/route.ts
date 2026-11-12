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
  rejectOversizedBody,
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
import { alPublicarAgenteEnMesa } from '../../../../../lib/proyectos/mesas';
import { mencionablesParaAgente } from '../../../../../lib/chat/projects';
import type { AgenteMencionable } from '../../../../../lib/chat/groups';
import {
  AVISO_BUCLE_ASISTENTES,
  MENSAJES_PARA_CONTEO,
  VENTANA_RITMO_MS,
  entregasDeAgenteEnHilo,
  saltosDesdeUltimaPersona,
} from '../../../../../lib/proyectos/menciones-agentes';

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
 * EN UN HILO DE PROYECTO (2026-11-12): el asistente puede mencionar con @ a
 * otro asistente del proyecto (el que la última persona del hilo podría
 * mencionar), con frenos de profundidad, ritmo e ida y vuelta; al cortarse
 * queda AVISO_BUCLE_ASISTENTES en el hilo. En las mesas no aplica. Ver
 * lib/proyectos/menciones-agentes.ts.
 *
 * El conteo de turnos se hace DENTRO de la transacción, sobre los últimos
 * mensajes del grupo. Si se hiciera antes, dos agentes contestando a la vez
 * podrían leer el mismo conteo y colarse los dos.
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const oversized = rejectOversizedBody(request);
    if (oversized) return oversized;

    const payload = await readMessageRequest(request);
    if (!payload) {
      return badRequest('El cuerpo debe ser un objeto JSON o un formulario multipart/form-data.');
    }
    const fields = payload.fields;

    // El alcance de la llave decide la puerta: la del bot vivo nunca escribe en
    // un proyecto, y la del puente de hilos solo escribe en proyectos.
    const conversation = await resolveAgentConversation(
      agent.idAgent,
      Number(fields.idConversation),
      agent.scope
    );
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
    // PROYECTO (2026-11-12, menciones entre asistentes): a quién podría
    // despertar este asistente con @. Sale de la PERSONA que escribió por
    // última vez en el hilo (lib/proyectos/menciones-agentes.ts). Se resuelve
    // fuera de la transacción (consulta configuración y asignaciones); los
    // FRENOS se cuentan dentro, como en los grupos.
    let candidatosProyecto: AgenteMencionable[] = [];
    if (
      conversation.kind === 'project' &&
      !conversation.esMesa &&
      body.includes('@') &&
      !body.trimStart().startsWith('/')
    ) {
      const ultimaPersona = await prisma.chatMessage.findFirst({
        where: { id_conversation: conversation.id, role: 'user' },
        orderBy: { id: 'desc' },
        select: { id_user_author: true },
      });
      candidatosProyecto = await mencionablesParaAgente({
        idProject: conversation.idProject,
        idAgentPrincipal: conversation.idAgentPrincipal,
        idAgentAutor: agent.idAgent,
        idUserOrigen: ultimaPersona?.id_user_author ?? null,
      });
    }

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

      // PROYECTO: menciones entre asistentes con frenos (profundidad, ritmo,
      // ida y vuelta). El conteo va DENTRO de la transacción por la misma
      // razón que en los grupos.
      let avisoProyecto: string | null = null;
      if (conversation.kind === 'project' && candidatosProyecto.length > 0) {
        const recientes = await tx.chatMessage.findMany({
          where: { id_conversation: conversation.id },
          orderBy: { id: 'desc' },
          take: MENSAJES_PARA_CONTEO,
          select: {
            role: true,
            body: true,
            id_agent_author: true,
            id_user_author: true,
            deliveries: { select: { id_agent: true } },
          },
        });
        const { saltos } = saltosDesdeUltimaPersona([...recientes].reverse());
        const saltosUltimaHora = await tx.chatMessage.count({
          where: {
            id_conversation: conversation.id,
            role: 'agent',
            created_at: { gte: new Date(now.getTime() - VENTANA_RITMO_MS) },
            deliveries: { some: {} },
          },
        });
        const r = entregasDeAgenteEnHilo({
          body,
          idAgentAutor: agent.idAgent,
          candidatos: candidatosProyecto,
          esMesa: conversation.esMesa,
          saltosDesdePersona: saltos,
          saltosUltimaHora,
        });
        entregas = { idAgents: r.idAgents, cadenaCortada: r.freno !== null };
        if (r.freno !== null) {
          console.warn(`[proyectos] menciones entre asistentes frenadas (${r.freno}) en la conversación ${conversation.id}`);
          avisoYaEstaba =
            recientes.length > 0 && recientes[0].role === 'system' && recientes[0].body === AVISO_BUCLE_ASISTENTES;
          avisoProyecto = AVISO_BUCLE_ASISTENTES;
        }
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
            body: avisoProyecto ?? AVISO_CADENA_CORTADA,
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
    // MESA DE DISCUSIÓN (2026-11-04): si era el turno de este agente, la mesa
    // pasa el turno al siguiente. En una mesa no se manda push a los miembros
    // en cada turno (serían decenas al día): solo con la síntesis.
    let mesaSinPush = false;
    if (conversation.kind === 'project') {
      try {
        const r = await alPublicarAgenteEnMesa({ idConversation: conversation.id, idAgent: agent.idAgent, idMessage: message.id, body });
        mesaSinPush = r.esMesa && !r.esSintesis;
      } catch (error) {
        console.error('[mesas] al publicar', error);
      }
    }

    if (conversation.kind === 'project' && mesaSinPush) {
      // Mesa de discusión: sin push en cada turno (ver arriba).
    } else if (conversation.kind === 'project') {
      // En un PROYECTO se le avisa a sus miembros (la pertenencia sale de
      // chat_project_member, nunca de chat_participant).
      const miembros = await prisma.chatProjectMember.findMany({
        where: { id_project: conversation.idProject },
        select: { user: { select: { email: true, isActive: true } } },
      });
      void notifyAgentReply({
        idConversation: conversation.id,
        idUser: null,
        groupEmails: miembros
          .filter((m) => m.user.isActive)
          .map((m) => m.user.email)
          .filter((e) => e.length > 0),
        groupTitle: conversation.projectName,
        url: `/process/proyectos/${conversation.idProject}?conversacion=${conversation.id}`,
        agentCode: agent.code,
        agentName: agent.displayName,
        agentAvatarUrl: agent.avatarUrl,
        body,
        attachmentCount: uploaded.length,
      });
    } else if (conversation.kind === 'group') {
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
