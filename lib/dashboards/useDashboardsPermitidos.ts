'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { DashboardKey } from './registro';

/**
 * Claves de los dashboards con permiso para la sesión (menú «Dashboard»).
 * Una sola consulta a /api/dashboards/acceso por usuario mientras viva la pestaña.
 */
let cache: { email: string; promesa: Promise<DashboardKey[]> } | null = null;

function cargar(email: string): Promise<DashboardKey[]> {
  if (!cache || cache.email !== email) {
    const promesa = fetch('/api/dashboards/acceso', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { dashboards: [] }))
      .then((d) => (Array.isArray(d?.dashboards) ? (d.dashboards as DashboardKey[]) : []))
      .catch(() => {
        cache = null; // reintenta en el próximo montaje
        return [] as DashboardKey[];
      });
    cache = { email, promesa };
  }
  return cache.promesa;
}

export function useDashboardsPermitidos(): DashboardKey[] {
  const { data: session, status } = useSession();
  const email = session?.user?.email ?? null;
  const [keys, setKeys] = useState<DashboardKey[]>([]);

  useEffect(() => {
    if (status !== 'authenticated' || !email) {
      setKeys([]);
      return;
    }
    let vivo = true;
    void cargar(email).then((k) => {
      if (vivo) setKeys(k);
    });
    return () => {
      vivo = false;
    };
  }, [status, email]);

  return keys;
}
