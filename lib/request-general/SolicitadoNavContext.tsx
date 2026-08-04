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
import {
  DASHBOARD_SOLICITANTE_URL,
  DASHBOARD_SOLICITADO_URL,
} from './dashboardAccess';

export interface RequestRoleNavContextValue {
  hasSolicitanteAccess: boolean;
  hasSolicitadoAccess: boolean;
  loadingRoleNav: boolean;
  /** @deprecated usar loadingRoleNav */
  loadingSolicitadoAccess: boolean;
  solicitanteUrl: string;
  solicitadoUrl: string;
}

const RequestRoleNavContext = createContext<RequestRoleNavContextValue | null>(null);

async function fetchRoleAccess(kind: 'solicitante' | 'solicitado'): Promise<boolean> {
  const res = await fetch(`/api/requests-general/dashboard-access?kind=${kind}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 401) return false;
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data.allowed);
}

export function RequestRoleNavProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [hasSolicitanteAccess, setHasSolicitanteAccess] = useState(false);
  const [hasSolicitadoAccess, setHasSolicitadoAccess] = useState(false);
  const [loadingRoleNav, setLoadingRoleNav] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;

    if (status !== 'authenticated' || !session?.user?.email) {
      setHasSolicitanteAccess(false);
      setHasSolicitadoAccess(false);
      setLoadingRoleNav(false);
      return;
    }

    let cancelled = false;
    setLoadingRoleNav(true);

    void Promise.all([fetchRoleAccess('solicitante'), fetchRoleAccess('solicitado')]).then(
      ([solicitante, solicitado]) => {
        if (cancelled) return;
        setHasSolicitanteAccess(solicitante);
        setHasSolicitadoAccess(solicitado);
        setLoadingRoleNav(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, status]);

  const value = useMemo(
    () => ({
      hasSolicitanteAccess,
      hasSolicitadoAccess,
      loadingRoleNav,
      loadingSolicitadoAccess: loadingRoleNav,
      solicitanteUrl: DASHBOARD_SOLICITANTE_URL,
      solicitadoUrl: DASHBOARD_SOLICITADO_URL,
    }),
    [hasSolicitanteAccess, hasSolicitadoAccess, loadingRoleNav]
  );

  return (
    <RequestRoleNavContext.Provider value={value}>{children}</RequestRoleNavContext.Provider>
  );
}

/** Alias del provider unificado. */
export const SolicitadoNavProvider = RequestRoleNavProvider;

export function useRequestRoleNav(): RequestRoleNavContextValue {
  const ctx = useContext(RequestRoleNavContext);
  if (!ctx) {
    throw new Error('useRequestRoleNav debe usarse dentro de RequestRoleNavProvider');
  }
  return ctx;
}

export function useRequestRoleNavOptional(): RequestRoleNavContextValue | null {
  return useContext(RequestRoleNavContext);
}

export function useSolicitadoNavOptional(): RequestRoleNavContextValue | null {
  return useContext(RequestRoleNavContext);
}
