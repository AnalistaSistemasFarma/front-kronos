'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';

export interface DashboardAdminContextValue {
  isDashboardAdmin: boolean;
  loadingDashboardAdmin: boolean;
  /** Quita el flag local tras un 403 del API (evita reintentos). */
  revokeDashboardAdmin: () => void;
}

const DashboardAdminContext = createContext<DashboardAdminContextValue | null>(null);

async function fetchDashboardAccess(): Promise<boolean> {
  const res = await fetch('/api/dashboard/access', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 401) return false;
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as {
    allowed?: unknown;
  } | null;
  return data?.allowed === true;
}

export function DashboardAdminProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [isDashboardAdmin, setIsDashboardAdmin] = useState(false);
  const [loadingDashboardAdmin, setLoadingDashboardAdmin] = useState(true);

  const revokeDashboardAdmin = useCallback(() => {
    setIsDashboardAdmin(false);
  }, []);

  useEffect(() => {
    if (status === 'loading') return;

    if (status !== 'authenticated' || !session?.user?.email) {
      setIsDashboardAdmin(false);
      setLoadingDashboardAdmin(false);
      return;
    }

    let cancelled = false;
    // Evita montar el dashboard con el flag del usuario anterior.
    setIsDashboardAdmin(false);
    setLoadingDashboardAdmin(true);

    void fetchDashboardAccess()
      .then((allowed) => {
        if (cancelled) return;
        setIsDashboardAdmin(allowed);
        setLoadingDashboardAdmin(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsDashboardAdmin(false);
        setLoadingDashboardAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, status]);

  const value = useMemo(
    () => ({ isDashboardAdmin, loadingDashboardAdmin, revokeDashboardAdmin }),
    [isDashboardAdmin, loadingDashboardAdmin, revokeDashboardAdmin]
  );

  return (
    <DashboardAdminContext.Provider value={value}>{children}</DashboardAdminContext.Provider>
  );
}

export function useDashboardAdmin(): DashboardAdminContextValue {
  const ctx = useContext(DashboardAdminContext);
  if (!ctx) {
    throw new Error('useDashboardAdmin debe usarse dentro de DashboardAdminProvider');
  }
  return ctx;
}

export function useDashboardAdminOptional(): DashboardAdminContextValue | null {
  return useContext(DashboardAdminContext);
}
