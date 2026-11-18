'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Preferencias de interfaz del usuario (servidor: /api/profile/ui-preferences), con una sola
 * carga compartida por pestaña y aviso entre componentes cuando cambian (p. ej. el interruptor
 * del perfil y las tablas abiertas).
 */
let cache: Record<string, unknown> | null = null;
let loading: Promise<Record<string, unknown>> | null = null;
const EVENT = 'ui-preference-change';

function loadAll(): Promise<Record<string, unknown>> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetch('/api/profile/ui-preferences', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { prefs: {} }))
      .then((d) => {
        cache = (d.prefs ?? {}) as Record<string, unknown>;
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      });
  }
  return loading;
}

export function useUiPreference<T>(key: string, fallback: T): [T, (value: T, opts?: { debounceMs?: number }) => void, boolean] {
  const [value, setValue] = useState<T>(() => (cache && key in cache ? (cache[key] as T) : fallback));
  const [ready, setReady] = useState(Boolean(cache));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadAll().then((c) => {
      if (!alive) return;
      if (key in c) setValue(c[key] as T);
      setReady(true);
    });
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      if (d?.key === key) setValue(d.value as T);
    };
    window.addEventListener(EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, [key]);

  const update = useCallback(
    (next: T, opts?: { debounceMs?: number }) => {
      setValue(next);
      cache = { ...(cache ?? {}), [key]: next };
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value: next } }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void fetch('/api/profile/ui-preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: next }),
        }).catch(() => undefined);
      }, opts?.debounceMs ?? 0);
    },
    [key]
  );

  return [value, update, ready];
}
