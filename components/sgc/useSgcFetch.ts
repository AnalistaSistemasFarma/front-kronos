'use client';

import { useCallback, useEffect, useState } from 'react';

/** GET de JSON sin caché para las páginas del SGC, con recarga manual. */
export function useSgcFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let activo = true;
    setLoading(true);
    setError(null);
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error || `Error ${res.status}`);
        return body as T;
      })
      .then((body) => activo && setData(body))
      .catch((err: unknown) => activo && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => activo && setLoading(false));
    return () => {
      activo = false;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** POST/PATCH JSON; devuelve el cuerpo o lanza con el mensaje de la API. */
export async function sgcSend<T = unknown>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
}
