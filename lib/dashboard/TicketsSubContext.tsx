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

export type TicketsSubView = 'operativo' | 'categorias';

export const TICKETS_SUB_URL: Record<TicketsSubView, string> = {
  operativo: '/dashboard/tickets',
  categorias: '/dashboard/tickets/categorias',
};

export function pathnameToTicketsSub(pathname: string): TicketsSubView {
  if (pathname.includes('/tickets/categorias')) return 'categorias';
  return 'operativo';
}

interface TicketsSubContextValue {
  subView: TicketsSubView;
  setSubView: (view: TicketsSubView) => void;
}

const TicketsSubContext = createContext<TicketsSubContextValue | null>(null);

export function TicketsSubProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [subView, setSubViewState] = useState<TicketsSubView>(() =>
    pathnameToTicketsSub(pathname)
  );

  useEffect(() => {
    setSubViewState(pathnameToTicketsSub(pathname));
  }, [pathname]);

  const setSubView = useCallback((view: TicketsSubView) => {
    setSubViewState(view);
    const url = TICKETS_SUB_URL[view];
    if (window.location.pathname !== url) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setSubViewState(pathnameToTicketsSub(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const value = useMemo(() => ({ subView, setSubView }), [subView, setSubView]);

  return <TicketsSubContext.Provider value={value}>{children}</TicketsSubContext.Provider>;
}

export function useTicketsSub(): TicketsSubContextValue {
  const ctx = useContext(TicketsSubContext);
  if (!ctx) {
    throw new Error('useTicketsSub debe usarse dentro de TicketsSubProvider');
  }
  return ctx;
}
