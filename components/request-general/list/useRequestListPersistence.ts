'use client';

import { useEffect, useRef, useState } from 'react';
import {
  loadRequestListState,
  saveRequestListState,
  type RequestListOrigin,
  type RequestListViewState,
} from '../../../lib/requests-general/requestListNav';

/**
 * Conserva los filtros de una lista de solicitudes en sessionStorage (patrón de Tickets,
 * create-ticket): al montar restaura lo guardado, guarda cada cambio y, cuando la lista ya
 * cargó, vuelve al scroll donde estaba. Devuelve lo que había guardado al entrar.
 */
export function useRequestListPersistence(
  origin: RequestListOrigin,
  state: Omit<RequestListViewState, 'scrollY'>,
  restore: (saved: RequestListViewState) => void,
  ready: boolean
): { hydrated: boolean; saved: RequestListViewState | null } {
  const [hydrated, setHydrated] = useState(false);
  const savedRef = useRef<RequestListViewState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const scrollRestoredRef = useRef(false);

  useEffect(() => {
    const saved = loadRequestListState(origin);
    savedRef.current = saved;
    if (saved) restoreRef.current(saved);
    setHydrated(true);
  }, [origin]);

  const key = JSON.stringify(state);
  useEffect(() => {
    if (!hydrated) return;
    saveRequestListState(origin, { ...stateRef.current, scrollY: window.scrollY });
  }, [hydrated, key, origin]);

  useEffect(() => {
    if (!hydrated) return;
    let frame = 0;
    const persistScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        saveRequestListState(origin, { ...stateRef.current, scrollY: window.scrollY })
      );
    };
    window.addEventListener('scroll', persistScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', persistScroll);
    };
  }, [hydrated, origin]);

  useEffect(() => {
    if (!hydrated || !ready || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const y = savedRef.current?.scrollY;
    // Después de que la lista (y la página restaurada) se pinten.
    if (y && y > 0) window.setTimeout(() => window.scrollTo({ top: y, behavior: 'auto' }), 60);
  }, [hydrated, ready]);

  return { hydrated, saved: savedRef.current };
}
