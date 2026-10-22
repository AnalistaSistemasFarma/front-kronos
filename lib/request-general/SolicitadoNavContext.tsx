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
} from './dashboardRoutes';
import { SUBPROCESS_ASSIGNMENTS_CHANGED } from '../process/subprocessAssignmentsEvents';
import { fetchNavAccess } from '../navigation/navAccess';

export interface RequestRoleNavContextValue {
  hasSolicitanteAccess: boolean;
  hasSolicitadoAccess: boolean;
  /** Líder de proceso: ve la pestaña «Mi equipo» del Dashboard personal. */
  hasEquipoAccess: boolean;
  loadingRoleNav: boolean;
  /** @deprecated usar loadingRoleNav */
  loadingSolicitadoAccess: boolean;
  solicitanteUrl: string;
  solicitadoUrl: string;
  refreshRoleNav: () => Promise<void>;
}

const RequestRoleNavContext = createContext<RequestRoleNavContextValue | null>(null);

export function RequestRoleNavProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [hasSolicitanteAccess, setHasSolicitanteAccess] = useState(false);
  const [hasSolicitadoAccess, setHasSolicitadoAccess] = useState(false);
  const [hasEquipoAccess, setHasEquipoAccess] = useState(false);
  const [loadingRoleNav, setLoadingRoleNav] = useState(true);

  const loadRoleNav = useCallback(async (fresh: boolean) => {
    if (status === 'loading') return;

    if (status !== 'authenticated' || !session?.user?.email) {
      setHasSolicitanteAccess(false);
      setHasSolicitadoAccess(false);
      setHasEquipoAccess(false);
      setLoadingRoleNav(false);
      return;
    }

    setLoadingRoleNav(true);
    try {
      // Una sola llamada compartida con DashboardAdminContext (lib/navigation/navAccess.ts).
      const result = await fetchNavAccess(session.user.email, { fresh });
      const access = result.ok ? result.access : null;
      setHasSolicitanteAccess(Boolean(access?.solicitante));
      setHasSolicitadoAccess(Boolean(access?.solicitado));
      setHasEquipoAccess(Boolean(access?.equipo));
    } finally {
      setLoadingRoleNav(false);
    }
  }, [session?.user?.email, status]);

  const refreshRoleNav = useCallback(() => loadRoleNav(true), [loadRoleNav]);

  useEffect(() => {
    void loadRoleNav(false);
  }, [loadRoleNav]);

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
      hasEquipoAccess,
      loadingRoleNav,
      loadingSolicitadoAccess: loadingRoleNav,
      solicitanteUrl: DASHBOARD_SOLICITANTE_URL,
      solicitadoUrl: DASHBOARD_SOLICITADO_URL,
      refreshRoleNav,
    }),
    [hasSolicitanteAccess, hasSolicitadoAccess, hasEquipoAccess, loadingRoleNav, refreshRoleNav]
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
