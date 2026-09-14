import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { canAuditAgents } from '../../../../lib/chat/audit-access';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * AUDITORÍA DEL CHAT DE AGENTES — consulta del módulo de administración.
 *
 *   GET /api/chat/auditoria?desde=&hasta=&agente=&usuario=&conversacion=&q=&page=&porPagina=
 *
 * Pedido de Nicolás (2026-09-10, auditoría de permisos): saber quién le
 * escribió a cada agente, desde qué IP, a qué hora, qué le dijo, qué respondió
 * el agente y cuánto costó en tokens.
 *
 * DE DÓNDE SALE CADA COSA:
 *   - la conversación, el texto y la hora: `chat_message`, que ya los guardaba;
 *   - la IP y el navegador: `chat_message.client_ip` / `.user_agent`, que se
 *     llenan desde la petición del usuario (ver lib/chat/client-origin.ts);
 *   - el consumo: `chat_agent_turn_usage`, que reporta cada conector
 *     (ver app/api/chat/agent/usage/route.ts).
 *
 * SE DEVUELVE EL MENSAJE, NO EL "TURNO". La unidad es el mensaje porque es lo
 * único que existe de verdad en la base; el consumo se adjunta a la conversación
 * y se entrega aparte, sumado por el rango consultado. Amarrar cada reporte de
 * consumo a un mensaje concreto sería inventar una correspondencia que nadie
 * registró: un turno puede publicar varias respuestas, o ninguna.
 *
 * PAGINADO SIEMPRE. Sin tope, la primera consulta sobre un mes de conversación
 * traería decenas de miles de filas con su texto completo — el navegador y el
 * servidor se caen antes de pintar nada.
 *
 * Reservado a administración: ver la nota de lib/chat/audit-access.ts.
 */

const POR_PAGINA_POR_DEFECTO = 50;
const POR_PAGINA_MAXIMO = 200;

/** Fecha del filtro, o null si no vino o no es válida. */
function fecha(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        { error: 'La auditoría de agentes está reservada a la administración.' },
        { status: 403 }
      );
    }

    const sp = request.nextUrl.searchParams;
    const desde = fecha(sp.get('desde'));
    const hasta = fecha(sp.get('hasta'));
    const idAgent = Number(sp.get('agente')) || null;
    const idConversation = Number(sp.get('conversacion')) || null;
    const usuario = (sp.get('usuario') ?? '').trim();
    const texto = (sp.get('q') ?? '').trim();
    const soloConIp = sp.get('conIp') === '1';

    const page = Math.max(1, Number(sp.get('page')) || 1);
    const porPagina = Math.min(
      Math.max(1, Number(sp.get('porPagina')) || POR_PAGINA_POR_DEFECTO),
      POR_PAGINA_MAXIMO
    );

    // `hasta` llega como día (YYYY-MM-DD) desde la interfaz: se toma el día
    // completo. Sin esto, filtrar "hasta hoy" no devolvería nada de hoy.
    if (hasta && hasta.getUTCHours() === 0 && hasta.getUTCMinutes() === 0) {
      hasta.setUTCHours(23, 59, 59, 999);
    }

    const where = {
      ...(desde || hasta
        ? { created_at: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
      ...(idConversation ? { id_conversation: idConversation } : {}),
      ...(texto ? { body: { contains: texto } } : {}),
      ...(soloConIp ? { client_ip: { not: null } } : {}),
      // El filtro por agente y por usuario mira la CONVERSACIÓN, no el autor
      // del mensaje: quien audita quiere el hilo completo —lo que preguntó la
      // persona y lo que respondió el agente—, no solo la mitad que escribió
      // uno de los dos.
      ...(idAgent || usuario
        ? {
            conversation: {
              ...(idAgent ? { id_agent: idAgent } : {}),
              ...(usuario
                ? {
                    user: {
                      OR: [
                        { email: { contains: usuario } },
                        { name: { contains: usuario } },
                      ],
                    },
                  }
                : {}),
            },
          }
        : {}),
    };

    const [total, mensajes] = await Promise.all([
      prisma.chatMessage.count({ where }),
      prisma.chatMessage.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          id_conversation: true,
          role: true,
          body: true,
          created_at: true,
          client_ip: true,
          user_agent: true,
          userAuthor: { select: { name: true, email: true } },
          agentAuthor: { select: { code: true, display_name: true } },
          conversation: {
            select: {
              id: true,
              kind: true,
              title: true,
              agent: { select: { id_agent: true, code: true, display_name: true } },
              user: { select: { name: true, email: true } },
              company: { select: { company: true } },
            },
          },
          attachments: { select: { file_name: true } },
        },
      }),
    ]);

    // Consumo del mismo rango. Se entrega sumado y aparte: no hay forma de
    // amarrar un reporte de consumo a un mensaje concreto (ver la nota de
    // arriba), pero sí de decir cuánto costó cada conversación en el período.
    const consumoWhere = {
      ...(desde || hasta
        ? { created_at: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
      ...(idConversation ? { id_conversation: idConversation } : {}),
      ...(idAgent ? { id_agent: idAgent } : {}),
    };

    // Catálogo para el selector de agentes de la pantalla. Va en la misma
    // respuesta y no en un endpoint aparte: es una lista corta y así la
    // pantalla se arma con una sola llamada.
    const agentes = await prisma.agent.findMany({
      where: { is_active: true },
      select: { id_agent: true, code: true, display_name: true },
      orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
    });

    const consumoPorConversacion = await prisma.chatAgentTurnUsage.groupBy({
      by: ['id_conversation'],
      where: consumoWhere,
      _sum: {
        total_tokens: true,
        input_tokens: true,
        cache_creation_tokens: true,
        cache_read_tokens: true,
        output_tokens: true,
        thinking_tokens: true,
      },
      _count: { id: true },
    });

    return jsonNoStore({
      page,
      porPagina,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
      agentes: agentes.map((a) => ({
        idAgent: a.id_agent,
        code: a.code,
        displayName: a.display_name,
      })),
      mensajes: mensajes.map((m) => ({
        id: m.id,
        idConversation: m.id_conversation,
        role: m.role,
        body: m.body,
        createdAt: m.created_at.toISOString(),
        clientIp: m.client_ip,
        userAgent: m.user_agent,
        autor:
          m.role === 'agent'
            ? m.agentAuthor?.display_name ?? m.conversation.agent.display_name
            : m.userAuthor?.name?.trim() ||
              m.userAuthor?.email ||
              m.conversation.user.name?.trim() ||
              m.conversation.user.email,
        autorEmail: m.role === 'agent' ? null : m.userAuthor?.email ?? m.conversation.user.email,
        adjuntos: m.attachments.map((a) => a.file_name),
        conversacion: {
          id: m.conversation.id,
          kind: m.conversation.kind,
          title: m.conversation.title,
          agente: {
            idAgent: m.conversation.agent.id_agent,
            code: m.conversation.agent.code,
            displayName: m.conversation.agent.display_name,
          },
          usuario: {
            name: m.conversation.user.name,
            email: m.conversation.user.email,
          },
          empresa: m.conversation.company?.company ?? null,
        },
      })),
      consumo: consumoPorConversacion.map((c) => ({
        idConversation: c.id_conversation,
        turnos: c._count.id,
        totalTokens: c._sum.total_tokens ?? 0,
        inputTokens: c._sum.input_tokens ?? 0,
        cacheCreationTokens: c._sum.cache_creation_tokens ?? 0,
        cacheReadTokens: c._sum.cache_read_tokens ?? 0,
        outputTokens: c._sum.output_tokens ?? 0,
        thinkingTokens: c._sum.thinking_tokens ?? 0,
      })),
    });
  } catch (error) {
    return serverError('GET /api/chat/auditoria', error);
  }
}
