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
import { DASHBOARD_SOLICITADO_URL } from './dashboardAccess';

export type SolicitadoTab = 'procesos' | 'actividades';

export const SOLICITADO_TAB_URL: Record<SolicitadoTab, string> = {
  procesos: DASHBOARD_SOLICITADO_URL,
  actividades: `${DASHBOARD_SOLICITADO_URL}/actividades`,
};

export function pathnameToSolicitadoTab(pathname: string): SolicitadoTab {
  if (pathname.includes('/actividades')) return 'actividades';
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
