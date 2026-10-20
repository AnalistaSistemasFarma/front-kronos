import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { CHAT_MODULE_URL } from '../../../../lib/chat/access';
import { visiblePeopleConversationIds } from '../../../../lib/chat/people';
import { projectModuleCompanies } from '../../../../lib/chat/projects';
import { whereConversacionesVisibles, whereMensajesQueCuentan } from '../../../../lib/proyectos/no-leidos';
import { tablaAusente } from '../../../../lib/chat/message-extras';
import {
  NUDGE_EVENT_TYPE,
  PULSE_MAX_EVENTS,
  PULSE_TICK_MS,
  PULSE_WAIT_SECONDS,
  type ChatPulseEvent,
} from '../../../../lib/chat/people-rules';
import {
  forbidden,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../lib/chat/http';

// El long-poll obliga a que la ruta sea dinámica: nada de esto se cachea.
export const dynamic = 'force-dynamic';

/**
 * PULSO GLOBAL del chat entre personas — "¿me escribieron o me zumbaron?".
 *
 *   GET /api/chat/pulse?since=<id del último mensaje visto>
 *
 * Lo pide <ChatPulse/> desde la cabecera de TODA la aplicación, para que un
 * mensaje directo o un zumbido llegue en ~1 s aunque la persona esté en otra
 * pantalla. Decisión D9: long-poll respaldado en SQL con el mismo patrón que
 * la bandeja del agente (app/api/chat/agent/inbox), NO SSE — con PM2 en
 * cluster un registro de suscriptores en memoria fallaría a medias (ver
 * lib/chat/polling.ts).
 *
 * Cómo funciona:
 *   - `since=0` (primera vuelta) responde YA con el cursor actual y sin
 *     eventos: el pulso avisa de lo NUEVO, no repite el historial.
 *   - Si no, revisa la base cada segundo hasta 20 s y responde en cuanto haya
 *     algo. Cada revisión son dos consultas baratas: el MAX(id) de la clave
 *     primaria y un seek de los mensajes posteriores al cursor en hilos
 *     'people' donde la persona participa y que no escribió ella.
 *   - El cursor avanza hasta el MAX(id) revisado aunque no hubiera nada suyo:
 *     así la siguiente vuelta no vuelve a recorrer lo mismo.
 *   - Se corta en cuanto el navegador cuelga (request.signal).
 *
 * Es una PISTA, no la fuente de verdad: el hilo abierto sigue teniendo su
 * propio sondeo. Si el pulso se perdiera un evento, el mensaje igual aparece.
 *
 * Seguridad: el usuario sale de la sesión; los eventos se filtran por
 * participación y, antes de responder, por la regla de acceso vigente
 * (visiblePeopleConversationIds). Sin el módulo de Chat NI el de Proyectos
 * responde 403 y el cliente deja de preguntar.
 *
 * PROYECTOS (2026-10-19, icono «Proyectos» de la cabecera): el mismo pulso
 * avisa también de mensajes NUEVOS —de personas o de agentes— en conversaciones
 * de proyecto, con `type: 'project'`, para que el icono vuelva a contar sin un
 * sondeo propio. Solo de proyectos NO archivados donde la persona es MIEMBRO y
 * conserva el módulo en la empresa del proyecto (la misma puerta de
 * resolveProjectForUser, ver lib/proyectos/no-leidos.ts). El evento no lleva
 * el texto del mensaje: solo el id de la conversación y quién escribió.
 *
 * REACCIONES (2026-10-20): con `rsince=<cursor>` el MISMO pulso avisa también
 * que alguien reaccionó en un hilo entre personas, un grupo o un proyecto
 * donde la persona participa (`type: 'reaction'`), para que el hilo abierto
 * pregunte ya. No es un sondeo nuevo: es una consulta más en la vuelta que ya
 * existe (MAX(id) de la clave primaria de chat_message_reaction) y solo si el
 * cliente manda `rsince`. El evento solo lleva el id de la conversación y del
 * mensaje; las reacciones en sí las trae el sondeo del hilo, que vuelve a
 * validar el acceso. Lo que reacciona uno mismo no se avisa.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const conChat = await prisma.subprocessUserCompany.findFirst({
      where: {
        companyUser: { id_user: user.id },
        subprocess: { subprocess_url: CHAT_MODULE_URL },
      },
      select: { id_subprocess_user_company: true },
    });
    // Empresas con el módulo «Proyectos»: la puerta de los eventos de proyecto.
    const empresasProyectos = (await projectModuleCompanies(user.id)).map((e) => e.idCompany);
    if (!conChat && empresasProyectos.length === 0) {
      return forbidden('No tiene habilitado el módulo de Chat.');
    }

    const maxActual = async () => {
      const fila = await prisma.chatMessage.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      return fila?.id ?? 0;
    };

    const rawSince = Number.parseInt(request.nextUrl.searchParams.get('since') ?? '0', 10);
    const since = Number.isInteger(rawSince) && rawSince > 0 ? rawSince : 0;

    // Cursor de reacciones: null = el cliente no pregunta por ellas (cliente
    // viejo) y no se consulta nada de más. También queda en null si la tabla
    // todavía no existe en esta base.
    const rawRsince = request.nextUrl.searchParams.get('rsince');
    const rsinceNum = rawRsince === null ? NaN : Number.parseInt(rawRsince, 10);
    let rcursor: number | null = Number.isInteger(rsinceNum) && rsinceNum >= 0 ? rsinceNum : null;
    const maxReaccion = async (): Promise<number | null> => {
      try {
        const fila = await prisma.chatMessageReaction.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
        return fila?.id ?? 0;
      } catch (error) {
        if (tablaAusente(error)) return null;
        throw error;
      }
    };
    if (rcursor === 0) rcursor = await maxReaccion();

    if (since === 0) {
      return jsonNoStore({ cursor: await maxActual(), events: [], ...(rcursor !== null ? { rcursor } : {}) });
    }

    // Cada rama trae SU puerta: hilos 'people' donde participa (si tiene Chat) y
    // conversaciones de proyecto visibles (si tiene Proyectos).
    const ramas = [
      ...(conChat
        ? [
            {
              id_user_author: { not: null },
              NOT: { id_user_author: user.id },
              conversation: { kind: 'people', participants: { some: { id_user: user.id } } },
              OR: [{ role: 'user' }, { event_type: NUDGE_EVENT_TYPE }],
            },
          ]
        : []),
      ...(empresasProyectos.length > 0
        ? [{ ...whereMensajesQueCuentan(user.id), conversation: whereConversacionesVisibles(user.id, empresasProyectos) }]
        : []),
    ];

    const buscar = (desde: number, hasta: number) =>
      prisma.chatMessage.findMany({
        where: { id: { gt: desde, lte: hasta }, OR: ramas },
        orderBy: { id: 'asc' },
        take: PULSE_MAX_EVENTS,
        select: {
          id: true,
          id_conversation: true,
          event_type: true,
          created_at: true,
          role: true,
          conversation: { select: { kind: true } },
          userAuthor: { select: { name: true, email: true } },
          agentAuthor: { select: { display_name: true } },
        },
      });

    // Reacciones de OTROS en conversaciones donde participo (personas y grupos
    // por chat_participant; proyectos con la misma puerta de los mensajes).
    const ramasReaccion = [
      ...(conChat
        ? [{ conversation: { kind: { in: ['people', 'group'] }, participants: { some: { id_user: user.id } } } }]
        : []),
      ...(empresasProyectos.length > 0
        ? [{ conversation: whereConversacionesVisibles(user.id, empresasProyectos) }]
        : []),
    ];
    const buscarReacciones = (desde: number, hasta: number) =>
      prisma.chatMessageReaction.findMany({
        where: { id: { gt: desde, lte: hasta }, NOT: { id_user: user.id }, message: { OR: ramasReaccion } },
        orderBy: { id: 'asc' },
        take: PULSE_MAX_EVENTS,
        select: { id: true, id_conversation: true, id_message: true, created_at: true },
      });

    const deadline = Date.now() + PULSE_WAIT_SECONDS * 1000;
    let cursor = since;
    let filas: Awaited<ReturnType<typeof buscar>> = [];
    let reacciones: Awaited<ReturnType<typeof buscarReacciones>> = [];

    for (;;) {
      const hasta = await maxActual();
      if (hasta > cursor) {
        filas = await buscar(cursor, hasta);
        // Si se llenó el tope, el cursor queda en el último devuelto para no
        // saltarse lo que no cupo; si no, avanza hasta lo revisado.
        cursor = filas.length >= PULSE_MAX_EVENTS ? filas[filas.length - 1].id : hasta;
      }
      if (rcursor !== null && ramasReaccion.length > 0) {
        const rhasta = await maxReaccion();
        if (rhasta === null) {
          rcursor = null;
        } else if (rhasta > rcursor) {
          reacciones = await buscarReacciones(rcursor, rhasta);
          rcursor = reacciones.length >= PULSE_MAX_EVENTS ? reacciones[reacciones.length - 1].id : rhasta;
        }
      }
      if (filas.length > 0 || reacciones.length > 0) break;
      if (Date.now() >= deadline || request.signal.aborted) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(PULSE_TICK_MS, Math.max(0, deadline - Date.now())))
      );
      if (request.signal.aborted) break;
    }

    const rextra = rcursor !== null ? { rcursor } : {};
    const eventosReaccion: ChatPulseEvent[] = reacciones.map((r) => ({
      type: 'reaction' as const,
      idConversation: r.id_conversation,
      idMessage: r.id_message,
      authorName: '',
      createdAt: r.created_at.toISOString(),
      muted: false,
    }));

    if (filas.length === 0) return jsonNoStore({ cursor, events: eventosReaccion, ...rextra });

    // Proyecto: la puerta ya va en la consulta (miembro + módulo de hoy).
    const deProyecto = filas.filter((f) => f.conversation.kind === 'project');
    const dePersonas = filas.filter((f) => f.conversation.kind === 'people');

    // La regla de acceso de HOY, y la preferencia de silencio de cada hilo.
    const visibles = new Set(dePersonas.length ? await visiblePeopleConversationIds(user.id) : []);
    const hilos = [...new Set(dePersonas.map((f) => f.id_conversation))].filter((id) => visibles.has(id));
    const silencios = hilos.length
      ? await prisma.chatParticipant.findMany({
          where: { id_conversation: { in: hilos }, id_user: user.id },
          select: { id_conversation: true, nudges_muted: true },
        })
      : [];
    const silenciado = new Map(silencios.map((s) => [s.id_conversation, s.nudges_muted]));

    const eventosProyecto: ChatPulseEvent[] = deProyecto.map((f) => ({
      type: 'project' as const,
      idConversation: f.id_conversation,
      idMessage: f.id,
      authorName:
        f.role === 'agent'
          ? f.agentAuthor?.display_name?.trim() || 'El asistente'
          : f.userAuthor?.name?.trim() || f.userAuthor?.email || 'Alguien',
      createdAt: f.created_at.toISOString(),
      muted: false,
    }));

    const events: ChatPulseEvent[] = dePersonas
      .filter((f) => visibles.has(f.id_conversation))
      .map((f) => {
        const esZumbido = f.event_type === NUDGE_EVENT_TYPE;
        return {
          type: esZumbido ? ('nudge' as const) : ('message' as const),
          idConversation: f.id_conversation,
          idMessage: f.id,
          authorName: f.userAuthor?.name?.trim() || f.userAuthor?.email || 'Alguien',
          createdAt: f.created_at.toISOString(),
          muted: esZumbido && Boolean(silenciado.get(f.id_conversation)),
        };
      });
    events.push(...eventosProyecto);
    events.sort((a, b) => a.idMessage - b.idMessage);
    // Las reacciones van al final: solo le piden al hilo que pregunte.
    events.push(...eventosReaccion);

    return jsonNoStore({ cursor, events, ...rextra });
  } catch (error) {
    return serverError('GET /api/chat/pulse', error);
  }
}
