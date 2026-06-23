'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import type { HelpDeskUserRole } from '../../../lib/help-desk/access';
import { SUBPROCESS_ASSIGNMENTS_CHANGED } from '../../../lib/process/subprocessAssignmentsEvents';

const EMPTY_ROLE: HelpDeskUserRole = {
  hasModuleAccess: false,
  isOperator: false,
  isRequester: false,
};

export const useHelpDeskAccess = () => {
  const { data: session, status } = useSession();
  const [role, setRole] = useState<HelpDeskUserRole>(EMPTY_ROLE);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshRole = useCallback(async (opts?: { silent?: boolean }) => {
    if (status === 'loading') return;
    if (!session?.user?.email) {
      setRole(EMPTY_ROLE);
      setLoading(false);
      return;
    }

    try {
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);

      const response = await fetch('/api/help-desk/role', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 401) {
        setRole(EMPTY_ROLE);
        return;
      }
      if (!response.ok) {
        throw new Error('No se pudo verificar el rol en mesa de ayuda');
      }

      const data = (await response.json()) as HelpDeskUserRole;
      setRole({
        hasModuleAccess: Boolean(data.hasModuleAccess),
        isOperator: Boolean(data.isOperator),
        isRequester: Boolean(data.isRequester),
      });
    } catch (err) {
      console.error('Error checking help desk access:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      if (!opts?.silent) {
        setRole(EMPTY_ROLE);
      }
    } finally {
      setLoading(false);
    }
  }, [session, status]);

  useEffect(() => {
    void refreshRole();
  }, [refreshRole]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const onAssignmentsChanged = () => void refreshRole();

    window.addEventListener(SUBPROCESS_ASSIGNMENTS_CHANGED, onAssignmentsChanged);

    return () => {
      window.removeEventListener(SUBPROCESS_ASSIGNMENTS_CHANGED, onAssignmentsChanged);
    };
  }, [status, refreshRole]);

  return {
    hasAccess: role.hasModuleAccess,
    isOperator: role.isOperator,
    isTechnician: role.isOperator,
    isRequester: role.isRequester,
    loading,
    error,
    isAuthenticated: status === 'authenticated',
    refreshRole,
  };
};
