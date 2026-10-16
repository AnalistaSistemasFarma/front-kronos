import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { CHAT_MODULE_URL } from '../../../../lib/chat/access';
import { visiblePeopleConversationIds } from '../../../../lib/chat/people';
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
 * (visiblePeopleConversationIds). Sin el módulo de Chat responde 403 y el
 * cliente deja de preguntar.
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
    if (!conChat) return forbidden('No tiene habilitado el módulo de Chat.');

    const maxActual = async () => {
      const fila = await prisma.chatMessage.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      return fila?.id ?? 0;
    };

    const rawSince = Number.parseInt(request.nextUrl.searchParams.get('since') ?? '0', 10);
    const since = Number.isInteger(rawSince) && rawSince > 0 ? rawSince : 0;

    if (since === 0) {
      return jsonNoStore({ cursor: await maxActual(), events: [] });
    }

    const buscar = (desde: number, hasta: number) =>
      prisma.chatMessage.findMany({
        where: {
          id: { gt: desde, lte: hasta },
          id_user_author: { not: null },
          NOT: { id_user_author: user.id },
          conversation: { kind: 'people', participants: { some: { id_user: user.id } } },
          OR: [{ role: 'user' }, { event_type: NUDGE_EVENT_TYPE }],
        },
        orderBy: { id: 'asc' },
        take: PULSE_MAX_EVENTS,
        select: {
          id: true,
          id_conversation: true,
          event_type: true,
          created_at: true,
          userAuthor: { select: { name: true, email: true } },
        },
      });

    const deadline = Date.now() + PULSE_WAIT_SECONDS * 1000;
    let cursor = since;
    let filas: Awaited<ReturnType<typeof buscar>> = [];

    for (;;) {
      const hasta = await maxActual();
      if (hasta > cursor) {
        filas = await buscar(cursor, hasta);
        // Si se llenó el tope, el cursor queda en el último devuelto para no
        // saltarse lo que no cupo; si no, avanza hasta lo revisado.
        cursor = filas.length >= PULSE_MAX_EVENTS ? filas[filas.length - 1].id : hasta;
        if (filas.length > 0) break;
      }
      if (Date.now() >= deadline || request.signal.aborted) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(PULSE_TICK_MS, Math.max(0, deadline - Date.now())))
      );
      if (request.signal.aborted) break;
    }

    if (filas.length === 0) return jsonNoStore({ cursor, events: [] });

    // La regla de acceso de HOY, y la preferencia de silencio de cada hilo.
    const visibles = new Set(await visiblePeopleConversationIds(user.id));
    const hilos = [...new Set(filas.map((f) => f.id_conversation))].filter((id) => visibles.has(id));
    const silencios = hilos.length
      ? await prisma.chatParticipant.findMany({
          where: { id_conversation: { in: hilos }, id_user: user.id },
          select: { id_conversation: true, nudges_muted: true },
        })
      : [];
    const silenciado = new Map(silencios.map((s) => [s.id_conversation, s.nudges_muted]));

    const events: ChatPulseEvent[] = filas
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

    return jsonNoStore({ cursor, events });
  } catch (error) {
    return serverError('GET /api/chat/pulse', error);
  }
}
