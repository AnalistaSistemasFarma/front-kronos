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
import { usePathname, useRouter } from 'next/navigation';
import { DASHBOARD_SOLICITADO_URL } from './dashboardRoutes';

export type SolicitadoTab = 'procesos' | 'equipo';

export const SOLICITADO_TAB_URL: Record<SolicitadoTab, string> = {
  procesos: DASHBOARD_SOLICITADO_URL,
  equipo: `${DASHBOARD_SOLICITADO_URL}/equipo`,
};

export function pathnameToSolicitadoTab(pathname: string): SolicitadoTab {
  if (pathname.endsWith('/equipo')) return 'equipo';
  return 'procesos';
}

interface SolicitadoTabContextValue {
  activeTab: SolicitadoTab;
  setActiveTab: (tab: SolicitadoTab) => void;
}

const SolicitadoTabContext = createContext<SolicitadoTabContextValue | null>(null);

export function SolicitadoTabProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTabState] = useState<SolicitadoTab>(() =>
    pathnameToSolicitadoTab(pathname)
  );

  useEffect(() => {
    setActiveTabState(pathnameToSolicitadoTab(pathname));
  }, [pathname]);

  const setActiveTab = useCallback(
    (tab: SolicitadoTab) => {
      setActiveTabState(tab);
      const url = SOLICITADO_TAB_URL[tab];
      if (pathname !== url) {
        router.push(url);
      }
    },
    [pathname, router]
  );

  const value = useMemo(() => ({ activeTab, setActiveTab }), [activeTab, setActiveTab]);

  return (
    <SolicitadoTabContext.Provider value={value}>{children}</SolicitadoTabContext.Provider>
  );
}

export function useSolicitadoTab(): SolicitadoTabContextValue {
  const ctx = useContext(SolicitadoTabContext);
  if (!ctx) {
    throw new Error('useSolicitadoTab debe usarse dentro de SolicitadoTabProvider');
  }
  return ctx;
}
