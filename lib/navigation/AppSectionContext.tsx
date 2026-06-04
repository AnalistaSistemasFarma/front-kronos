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
import { DASHBOARD_TAB_URL } from '../dashboard/DashboardTabContext';
import { useDashboardAdmin } from '../dashboard/DashboardAdminContext';

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
  const router = useRouter();
  const { isDashboardAdmin, loadingDashboardAdmin } = useDashboardAdmin();
  const [activeSection, setActiveSectionState] = useState<AppSection>(() =>
    pathnameToAppSection(pathname)
  );

  useEffect(() => {
    if (isHubInstantSwapRoute(pathname)) {
      const next = pathnameToAppSection(pathname);
      if (next === 'dashboard' && !loadingDashboardAdmin && !isDashboardAdmin) {
        setActiveSectionState('process');
        if (pathname.startsWith('/dashboard')) {
          router.replace(PROCESS_HUB_URL);
        }
        return;
      }
      setActiveSectionState(next);
    }
  }, [pathname, loadingDashboardAdmin, isDashboardAdmin, router]);

  const setActiveSection = useCallback(
    (section: AppSection) => {
      const target =
        section === 'dashboard' && !isDashboardAdmin ? 'process' : section;
      setActiveSectionState(target);
      const url =
        target === 'dashboard' ? DASHBOARD_TAB_URL.solicitudes : PROCESS_HUB_URL;
      if (window.location.pathname !== url) {
        window.history.replaceState(window.history.state, '', url);
      }
    },
    [isDashboardAdmin]
  );

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
