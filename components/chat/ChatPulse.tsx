'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  chatFetch,
  isAbortError,
  notificarActividad,
  notifyChatRefresh,
  pedirSondeoDelHilo,
} from '../../lib/chat/client';
import type { ChatPulseEvent } from '../../lib/chat/people-rules';
import {
  efectoZumbido,
  hiloEstaALaVista,
  marcarZumbidoMostrado,
  parpadearTitulo,
  prepararAudioZumbido,
  zumbidoFresco,
} from '../../lib/chat/nudge-fx';
import { avisarMensajeEntrante, mensajeFresco, threadOnScreen } from '../../lib/chat/message-sound';
import { toastFromNudge, toastFromProjectEvent } from '../../lib/notifications/inAppToast';
import { showInAppToast } from '../../lib/notifications/inAppToastStore';
import { avisarActividadProyectos } from '../../lib/proyectos/iconoHeader';
import { avisarEstadoProyectos, type EstadoAgenteProyectoDto } from '../../lib/proyectos/estado-agente';

/**
 * PULSO GLOBAL del chat entre personas. No pinta nada: vive en la cabecera de
 * TODA la aplicación (components/Header.tsx, junto a ChatRail) y mantiene
 * abierto un long-poll contra /api/chat/pulse para enterarse en ~1 s de un
 * mensaje directo o de un zumbido, esté la persona en la pantalla que esté.
 *
 *   - Mensaje nuevo  -> refresca la bandeja (contadores) y, si ese hilo está
 *                       abierto, le pide al hilo que sondee YA.
 *   - Zumbido nuevo  -> si el hilo está a la vista, el hilo mismo se sacude
 *                       (ChatThread); si no, aviso flotante "📳 X le envió un
 *                       zumbido · Abrir", sonido, vibración y título
 *                       parpadeante si la pestaña está oculta.
 *
 *   - Mensaje en un PROYECTO (2026-10-19) -> avisa al icono «Proyectos» de la
 *                       cabecera para que vuelva a contar, le pide al hilo
 *                       abierto que sondee y suena el tono del chat si la
 *                       persona no lo está viendo (misma preferencia).
 *
 *   - Estado de un AGENTE en un proyecto (2026-10-20) -> «Orus está trabajando…»
 *                       en la lista de conversaciones, la de proyectos y el
 *                       panel del icono. Llega en el MISMO long-poll (`st`, ver
 *                       app/api/chat/pulse) y se reparte con
 *                       EVENTO_ESTADO_PROYECTOS. No abre ninguna conexión nueva.
 *
 *   - In-app notification cards (2026-11-24): project messages and nudges show a SynerLink card
 *                       (lib/notifications/inAppToast.ts). With `ag=1` the pulse also reports
 *                       agent replies and group messages (`type: 'agent'`): they only refresh the
 *                       inbox now, and the inbox turns them into cards (useChatOverview).
 *
 * Se PAUSA con la pestaña oculta (no se sostiene una conexión para nadie) y
 * retoma al volver con el mismo cursor, así que lo que llegó mientras tanto
 * se entrega al volver — los zumbidos viejos ya no hacen ruido (NUDGE_FRESH_MS).
 * Sin el módulo de Chat el servidor responde 403 y el pulso se apaga.
 */
type PulseDto = {
  cursor: number;
  events: ChatPulseEvent[];
  statusCursor?: string;
  statuses?: EstadoAgenteProyectoDto[];
  rcursor?: number;
};

export default function ChatPulse() {
  const { status } = useSession();
  const autenticado = status === 'authenticated';

  useEffect(() => {
    if (!autenticado) return;
    prepararAudioZumbido();

    let vivo = true;
    let cursor = 0;
    // Cursor de los estados de agentes en proyectos: '0' = pedir el actual.
    // null = el servidor no los entrega (sin el módulo o versión anterior).
    let cursorEstados: string | null = '0';
    // Cursor de REACCIONES (2026-10-20). 0 = «deme el actual»; si el servidor
    // no lo devuelve (tabla aún sin crear), se deja de preguntar por ellas.
    let rcursor: number | null = 0;
    let control: AbortController | null = null;
    let reintento: number | null = null;
    let espera = 0;
    let corriendo = false;

    const avisarZumbido = (evento: ChatPulseEvent) => {
      // Una tarjeta por conversación: tres zumbidos seguidos no apilan tres.
      showInAppToast(toastFromNudge(evento));
      parpadearTitulo(`📳 ${evento.authorName} le envió un zumbido`);
      efectoZumbido();
    };

    const procesarProyectos = (eventos: ChatPulseEvent[]) => {
      if (eventos.length === 0) return;
      const hilos = [...new Set(eventos.map((e) => e.idConversation))];
      for (const id of hilos) pedirSondeoDelHilo(id);
      avisarActividadProyectos(hilos);
      // El antirrebote de message-sound deja sonar una sola vez por ráfaga.
      // A muted project (2026-11-23) refreshes silently: no sound.
      for (const e of eventos) if (!e.muted && mensajeFresco(e.createdAt)) avisarMensajeEntrante(e.idConversation);
      // In-app card: the latest message per conversation, unless muted (#1095) or already on screen.
      const latest = new Map<number, ChatPulseEvent>();
      for (const e of eventos) latest.set(e.idConversation, e);
      for (const e of latest.values()) {
        if (e.muted || !mensajeFresco(e.createdAt) || threadOnScreen(e.idConversation)) continue;
        showInAppToast(toastFromProjectEvent(e));
      }
    };

    const procesar = (todos: ChatPulseEvent[]) => {
      // Reacción de otra persona: solo que el hilo abierto (si es ese)
      // pregunte ya. Sin sonido, sin aviso y sin reordenar la bandeja.
      for (const id of new Set(todos.filter((e) => e.type === 'reaction').map((e) => e.idConversation))) {
        pedirSondeoDelHilo(id);
      }
      procesarProyectos(todos.filter((e) => e.type === 'project'));
      const eventos = todos.filter((e) => e.type !== 'project' && e.type !== 'reaction');
      if (eventos.length === 0) return;
      const hilos = new Set<number>();
      for (const e of eventos) {
        hilos.add(e.idConversation);
        // Me escribieron: la conversación sube de primera ya, antes de que la
        // bandeja vuelva con los contadores.
        notificarActividad(e.idConversation, e.createdAt);
      }
      // Que el hilo abierto (si es uno de estos) pregunte ya, y que la bandeja
      // actualice sus contadores.
      for (const id of hilos) pedirSondeoDelHilo(id);
      notifyChatRefresh();

      for (const e of eventos) {
        if (e.type !== 'nudge' || e.muted || !zumbidoFresco(e.createdAt)) continue;
        // Con el hilo a la vista, el efecto lo hace el propio hilo al recibir
        // el mensaje por su sondeo (y marca el zumbido como mostrado).
        if (hiloEstaALaVista(e.idConversation)) continue;
        if (!marcarZumbidoMostrado(e.idMessage)) continue;
        avisarZumbido(e);
      }
    };

    const ciclo = async () => {
      if (corriendo) return;
      corriendo = true;
      try {
        while (vivo && document.visibilityState === 'visible') {
          control = new AbortController();
          try {
            const st = cursorEstados !== null ? `&st=${encodeURIComponent(cursorEstados)}` : '';
            const rq = rcursor !== null ? `&rsince=${rcursor}` : '';
            // ag=1: agent replies and group messages too (in-app notification cards).
            const res = await chatFetch(`/api/chat/pulse?since=${cursor}${st}${rq}&ag=1`, {
              signal: control.signal,
            });
            if (!vivo) return;
            // Sin sesión o sin el módulo de Chat: el pulso no tiene nada que
            // hacer en esta pestaña. Se apaga hasta que se recargue.
            if (res.status === 401 || res.status === 403) {
              vivo = false;
              return;
            }
            const data = res.ok ? ((await res.json()) as PulseDto) : null;
            if (!data) {
              // Falla del servidor: se reintenta despacio, hasta un minuto.
              espera = Math.min(60_000, espera ? espera * 2 : 5_000);
              await new Promise<void>((resolve) => {
                reintento = window.setTimeout(resolve, espera);
              });
              continue;
            }
            espera = 0;
            // La primera vuelta solo trae el cursor: no se repite el historial.
            if (cursor > 0) procesar(data.events ?? []);
            cursor = Math.max(cursor, data.cursor ?? 0);
            // Estados de agentes en proyectos: se reparten siempre (también los
            // de reposo, para que la pantalla deje de decir «trabajando»).
            if (typeof data.statusCursor === 'string') {
              if (Array.isArray(data.statuses) && data.statuses.length > 0) avisarEstadoProyectos(data.statuses);
              cursorEstados = data.statusCursor;
            } else if (cursorEstados === '0') {
              cursorEstados = null;
            }
            rcursor = typeof data.rcursor === 'number' ? Math.max(rcursor ?? 0, data.rcursor) : null;
            // Base sin ningún mensaje todavía: la vuelta con since=0 responde
            // al instante, así que se espera el tiempo de una vuelta normal
            // para no girar en vacío.
            if (cursor === 0) {
              await new Promise<void>((resolve) => {
                reintento = window.setTimeout(resolve, 20_000);
              });
            }
          } catch (err) {
            if (isAbortError(err)) return;
            espera = Math.min(60_000, espera ? espera * 2 : 5_000);
            await new Promise<void>((resolve) => {
              reintento = window.setTimeout(resolve, espera);
            });
          }
        }
      } finally {
        corriendo = false;
      }
    };

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') {
        void ciclo();
      } else {
        // Pausa: se corta la conexión abierta. El cursor se conserva.
        control?.abort();
      }
    };

    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    void ciclo();

    return () => {
      vivo = false;
      control?.abort();
      if (reintento !== null) window.clearTimeout(reintento);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [autenticado]);

  return null;
}
