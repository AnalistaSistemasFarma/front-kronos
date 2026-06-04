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

export interface DashboardAdminContextValue {
  isDashboardAdmin: boolean;
  loadingDashboardAdmin: boolean;
}

const DashboardAdminContext = createContext<DashboardAdminContextValue | null>(null);

async function fetchDashboardAdminFlag(email: string): Promise<boolean> {
  const res = await fetch(
    `/api/requests-general/verify-permissions?email=${encodeURIComponent(email)}`
  );
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.user?.isAdmin);
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

    void fetchDashboardAdminFlag(session.user.email).then((allowed) => {
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
