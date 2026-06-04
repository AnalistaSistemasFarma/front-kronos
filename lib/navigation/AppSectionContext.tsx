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
import { DASHBOARD_TAB_URL } from '../dashboard/DashboardTabContext';

export type AppSection = 'dashboard' | 'process';

export const PROCESS_HUB_URL = '/process';

export function pathnameToAppSection(pathname: string): AppSection {
  if (pathname === PROCESS_HUB_URL) return 'process';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  return 'dashboard';
}

export function isHubInstantSwapRoute(pathname: string): boolean {
  return pathname === PROCESS_HUB_URL || pathname.startsWith('/dashboard');
}

export interface AppSectionContextValue {
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
}

export const AppSectionContext = createContext<AppSectionContextValue | null>(null);

export function AppSectionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [activeSection, setActiveSectionState] = useState<AppSection>(() =>
    pathnameToAppSection(pathname)
  );

  useEffect(() => {
    if (isHubInstantSwapRoute(pathname)) {
      setActiveSectionState(pathnameToAppSection(pathname));
    }
  }, [pathname]);

  const setActiveSection = useCallback((section: AppSection) => {
    setActiveSectionState(section);
    const url = section === 'dashboard' ? DASHBOARD_TAB_URL.solicitudes : PROCESS_HUB_URL;
    if (window.location.pathname !== url) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveSectionState(pathnameToAppSection(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const value = useMemo(
    () => ({ activeSection, setActiveSection }),
    [activeSection, setActiveSection]
  );

  return <AppSectionContext.Provider value={value}>{children}</AppSectionContext.Provider>;
}

export function useAppSection(): AppSectionContextValue {
  const ctx = useContext(AppSectionContext);
  if (!ctx) {
    throw new Error('useAppSection debe usarse dentro de AppSectionProvider');
  }
  return ctx;
}
