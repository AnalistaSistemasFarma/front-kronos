'use client';

import { useEffect, useRef } from 'react';

/** Cada cuánto se refrescan solos los listados (solo con la pestaña visible). */
export const AUTO_REFRESH_MS = 30_000;

/**
 * Llama `refresh` cada `ms` y al volver a la pestaña; con la pestaña oculta no consulta nada.
 * Siempre usa la última versión de `refresh` (con los filtros vigentes).
 */
export function useAutoRefresh(refresh: () => void, ms: number = AUTO_REFRESH_MS) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) refreshRef.current();
    };
    const timer = window.setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}
