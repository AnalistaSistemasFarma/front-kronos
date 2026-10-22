'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import { fetchNavAccess } from '../navigation/navAccess';

export interface DashboardAdminContextValue {
  isDashboardAdmin: boolean;
  loadingDashboardAdmin: boolean;
}

const DashboardAdminContext = createContext<DashboardAdminContextValue | null>(null);

async function fetchDashboardAccess(email: string): Promise<boolean> {
  // Misma llamada que el menú (lib/navigation/navAccess.ts), con reintento: una falla
  // temporal al entrar se tomaba como "no es admin" y mandaba a Procesos.
  const result = await fetchNavAccess(email);
  return result.ok && result.access.dashboardAdmin;
}

export function DashboardAdminProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [isDashboardAdmin, setIsDashboardAdmin] = useState(false);
  const [loadingDashboardAdmin, setLoadingDashboardAdmin] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;

    if (status !== 'authenticated' || !session?.user?.email) {
      setIsDashboardAdmin(false);
      setLoadingDashboardAdmin(false);
      return;
    }

    let cancelled = false;
    setLoadingDashboardAdmin(true);

    void fetchDashboardAccess(session.user.email).then((allowed) => {
      if (cancelled) return;
      setIsDashboardAdmin(allowed);
      setLoadingDashboardAdmin(false);
    });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, status]);

  const value = useMemo(
    () => ({ isDashboardAdmin, loadingDashboardAdmin }),
    [isDashboardAdmin, loadingDashboardAdmin]
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
