'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { chatFetch, chatGetJson, isAbortError } from '../../lib/chat/client';
import { togglePin } from '../../lib/chat/rail';

/**
 * Chats ANCLADOS de la barra lateral, guardados POR PERSONA en la base
 * (/api/chat/pins → dbo.chat_pin). Así el ancla sigue a la persona a cualquier
 * equipo o celular, que es lo que pidió Nicolás ("no solo localStorage").
 *
 * - Se piden UNA vez por sesión (caché en memoria por correo, como
 *   useChatOverview): la barra se monta en cada pantalla y no tiene por qué
 *   volver a preguntar.
 * - Anclar es OPTIMISTA: la interfaz cambia al instante y, si el servidor lo
 *   rechaza, se devuelve al estado anterior y se deja un `error` visible.
 * - `available = false` cuando la base todavía no tiene la tabla: la barra
 *   esconde el botón de anclar en vez de ofrecer algo que va a fallar.
 */

let cache: { email: string; pins: string[]; available: boolean } | null = null;

export interface ChatPinsState {
  pins: string[];
  pinnedSet: ReadonlySet<string>;
  available: boolean;
  error: string | null;
  clearError: () => void;
  setPinned: (key: string, pinned: boolean) => void;
}

export function useChatPins(enabled: boolean): ChatPinsState {
  const { data: session, status } = useSession();
  const email = status === 'authenticated' ? session?.user?.email ?? null : null;
  const inicial = email && cache?.email === email ? cache : null;

  const [pins, setPins] = useState<string[]>(inicial?.pins ?? []);
  const [available, setAvailable] = useState(inicial?.available ?? false);
  const [error, setError] = useState<string | null>(null);
  const pinsRef = useRef(pins);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      // Se cerró la sesión: fuera las anclas de quien ya no está.
      cache = null;
      setPins([]);
      setAvailable(false);
      return;
    }
    if (!email || !enabled) return;
    if (cache?.email === email) {
      setPins(cache.pins);
      setAvailable(cache.available);
      return;
    }
    const controller = new AbortController();
    chatGetJson<{ pins: string[]; available: boolean }>('/api/chat/pins', controller.signal)
      .then((data) => {
        if (controller.signal.aborted || !data) return;
        cache = { email, pins: data.pins ?? [], available: Boolean(data.available) };
        setPins(cache.pins);
        setAvailable(cache.available);
      })
      .catch((err) => {
        if (!isAbortError(err)) {
          // Sin anclas si falla: la barra funciona igual, solo sin la sección.
        }
      });
    return () => controller.abort();
  }, [email, enabled, status]);

  const setPinned = useCallback(
    (key: string, pinned: boolean) => {
      if (!email) return;
      const antes = pinsRef.current;
      const despues = togglePin(antes, key, pinned);
      pinsRef.current = despues;
      setPins(despues);
      setError(null);
      if (cache?.email === email) cache.pins = despues;

      void (async () => {
        try {
          const res = await chatFetch('/api/chat/pins', {
            method: 'PUT',
            body: JSON.stringify({ key, pinned }),
          });
          const data = (await res.json().catch(() => null)) as
            | { pins?: string[]; error?: string }
            | null;
          if (!res.ok || !data?.pins) {
            throw new Error(data?.error || 'No se pudo guardar el cambio.');
          }
          setPins(data.pins);
          if (cache?.email === email) cache.pins = data.pins;
        } catch (err) {
          setPins(antes);
          if (cache?.email === email) cache.pins = antes;
          const detalle = err instanceof Error ? err.message : '';
          setError(
            `${pinned ? 'No se pudo anclar' : 'No se pudo desanclar'} el chat. ${detalle}`.trim()
          );
        }
      })();
    },
    [email]
  );

  const clearError = useCallback(() => setError(null), []);
  const pinnedSet = useMemo(() => new Set(pins), [pins]);

  return { pins, pinnedSet, available, error, clearError, setPinned };
}
