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
import { useSession } from 'next-auth/react';
import {
  DASHBOARD_SOLICITANTE_URL,
  DASHBOARD_SOLICITADO_URL,
} from './dashboardAccess';
import { SUBPROCESS_ASSIGNMENTS_CHANGED } from '../process/subprocessAssignmentsEvents';

export interface RequestRoleNavContextValue {
  hasSolicitanteAccess: boolean;
  hasSolicitadoAccess: boolean;
  loadingRoleNav: boolean;
  /** @deprecated usar loadingRoleNav */
  loadingSolicitadoAccess: boolean;
  solicitanteUrl: string;
  solicitadoUrl: string;
  refreshRoleNav: () => Promise<void>;
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

  const refreshRoleNav = useCallback(async () => {
    if (status === 'loading') return;

    if (status !== 'authenticated' || !session?.user?.email) {
      setHasSolicitanteAccess(false);
      setHasSolicitadoAccess(false);
      setLoadingRoleNav(false);
      return;
    }

    setLoadingRoleNav(true);
    try {
      const [solicitante, solicitado] = await Promise.all([
        fetchRoleAccess('solicitante'),
        fetchRoleAccess('solicitado'),
      ]);
      setHasSolicitanteAccess(solicitante);
      setHasSolicitadoAccess(solicitado);
    } finally {
      setLoadingRoleNav(false);
    }
  }, [session?.user?.email, status]);

  useEffect(() => {
    void refreshRoleNav();
  }, [refreshRoleNav]);

  // Si se asigna/quita el módulo en Administración → Usuarios, refrescar el menú
  useEffect(() => {
    if (status !== 'authenticated') return;

    const onAssignmentsChanged = () => void refreshRoleNav();
    window.addEventListener(SUBPROCESS_ASSIGNMENTS_CHANGED, onAssignmentsChanged);
    return () => {
      window.removeEventListener(SUBPROCESS_ASSIGNMENTS_CHANGED, onAssignmentsChanged);
    };
  }, [status, refreshRoleNav]);

  const value = useMemo(
    () => ({
      hasSolicitanteAccess,
      hasSolicitadoAccess,
      loadingRoleNav,
      loadingSolicitadoAccess: loadingRoleNav,
      solicitanteUrl: DASHBOARD_SOLICITANTE_URL,
      solicitadoUrl: DASHBOARD_SOLICITADO_URL,
      refreshRoleNav,
    }),
    [hasSolicitanteAccess, hasSolicitadoAccess, loadingRoleNav, refreshRoleNav]
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
