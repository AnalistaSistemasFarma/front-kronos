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

export type SolicitudesSubView = 'solicitudes' | 'procesos';

export const SOLICITUDES_SUB_URL: Record<SolicitudesSubView, string> = {
  solicitudes: '/dashboard/solicitudes',
  procesos: '/dashboard/solicitudes/procesos',
};

export function pathnameToSolicitudesSub(pathname: string): SolicitudesSubView {
  if (pathname.includes('/solicitudes/procesos')) return 'procesos';
  return 'solicitudes';
}

interface SolicitudesSubContextValue {
  subView: SolicitudesSubView;
  setSubView: (view: SolicitudesSubView) => void;
}

const SolicitudesSubContext = createContext<SolicitudesSubContextValue | null>(null);

export function SolicitudesSubProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [subView, setSubViewState] = useState<SolicitudesSubView>(() =>
    pathnameToSolicitudesSub(pathname)
  );

  useEffect(() => {
    setSubViewState(pathnameToSolicitudesSub(pathname));
  }, [pathname]);

  const setSubView = useCallback((view: SolicitudesSubView) => {
    setSubViewState(view);
    const url = SOLICITUDES_SUB_URL[view];
    if (window.location.pathname !== url) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setSubViewState(pathnameToSolicitudesSub(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const value = useMemo(() => ({ subView, setSubView }), [subView, setSubView]);

  return (
    <SolicitudesSubContext.Provider value={value}>{children}</SolicitudesSubContext.Provider>
  );
}

export function useSolicitudesSub(): SolicitudesSubContextValue {
  const ctx = useContext(SolicitudesSubContext);
  if (!ctx) {
    throw new Error('useSolicitudesSub debe usarse dentro de SolicitudesSubProvider');
  }
  return ctx;
}
