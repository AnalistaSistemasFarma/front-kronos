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
import { usePathname } from 'next/navigation';

export type DashboardTab = 'solicitudes' | 'actividades' | 'tickets';

export const DASHBOARD_TAB_URL: Record<DashboardTab, string> = {
  solicitudes: '/dashboard/solicitudes',
  actividades: '/dashboard/actividades',
  tickets: '/dashboard/tickets',
};

export function pathnameToTab(pathname: string): DashboardTab {
  if (pathname.includes('/actividades')) return 'actividades';
  if (pathname.includes('/tickets')) return 'tickets';
  return 'solicitudes';
}

interface DashboardTabContextValue {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
}

const DashboardTabContext = createContext<DashboardTabContextValue | null>(null);

export function DashboardTabProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [activeTab, setActiveTabState] = useState<DashboardTab>(() => pathnameToTab(pathname));

  useEffect(() => {
    setActiveTabState(pathnameToTab(pathname));
  }, [pathname]);

  const setActiveTab = useCallback((tab: DashboardTab) => {
    setActiveTabState(tab);
    const url = DASHBOARD_TAB_URL[tab];
    if (window.location.pathname !== url) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveTabState(pathnameToTab(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const value = useMemo(() => ({ activeTab, setActiveTab }), [activeTab, setActiveTab]);

  return <DashboardTabContext.Provider value={value}>{children}</DashboardTabContext.Provider>;
}

export function useDashboardTab(): DashboardTabContextValue {
  const ctx = useContext(DashboardTabContext);
  if (!ctx) {
    throw new Error('useDashboardTab debe usarse dentro de DashboardTabProvider');
  }
  return ctx;
}
