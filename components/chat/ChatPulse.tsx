'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
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
 * Se PAUSA con la pestaña oculta (no se sostiene una conexión para nadie) y
 * retoma al volver con el mismo cursor, así que lo que llegó mientras tanto
 * se entrega al volver — los zumbidos viejos ya no hacen ruido (NUDGE_FRESH_MS).
 * Sin el módulo de Chat el servidor responde 403 y el pulso se apaga.
 */
type PulseDto = { cursor: number; events: ChatPulseEvent[] };

export default function ChatPulse() {
  const { status } = useSession();
  const router = useRouter();
  const autenticado = status === 'authenticated';

  useEffect(() => {
    if (!autenticado) return;
    prepararAudioZumbido();

    let vivo = true;
    let cursor = 0;
    let control: AbortController | null = null;
    let reintento: number | null = null;
    let espera = 0;
    let corriendo = false;

    const avisarZumbido = (evento: ChatPulseEvent) => {
      const url = `/process/chat/persona/${evento.idConversation}`;
      toast(
        (t) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>
              📳 <b>{evento.authorName}</b> le envió un zumbido
            </span>
            <button
              type='button'
              onClick={() => {
                toast.dismiss(t.id);
                router.push(url);
              }}
              style={{ fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Abrir
            </button>
          </span>
        ),
        // Un aviso por conversación: tres zumbidos seguidos no apilan tres.
        { id: `zumbido-${evento.idConversation}`, duration: 8000 }
      );
      parpadearTitulo(`📳 ${evento.authorName} le envió un zumbido`);
      efectoZumbido();
    };

    const procesar = (eventos: ChatPulseEvent[]) => {
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
            const res = await chatFetch(`/api/chat/pulse?since=${cursor}`, {
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
  }, [autenticado, router]);

  return null;
}
