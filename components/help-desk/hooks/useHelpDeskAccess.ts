'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import type { HelpDeskUserRole } from '../../../lib/help-desk/access';

export const useHelpDeskAccess = () => {
  const { data: session, status } = useSession();
  const [role, setRole] = useState<HelpDeskUserRole>({
    hasModuleAccess: false,
    isOperator: false,
    isRequester: false,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAccess = async () => {
      if (status === 'loading') return;
      if (!session?.user?.email) {
        setRole({ hasModuleAccess: false, isOperator: false, isRequester: false });
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/help-desk/role', { credentials: 'same-origin' });
        if (response.status === 401) {
          setRole({ hasModuleAccess: false, isOperator: false, isRequester: false });
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
        setRole({ hasModuleAccess: false, isOperator: false, isRequester: false });
      } finally {
        setLoading(false);
      }
    };

    void checkAccess();
  }, [session, status]);

  return {
    hasAccess: role.hasModuleAccess,
    isOperator: role.isOperator,
    isTechnician: role.isOperator,
    isRequester: role.isRequester,
    loading,
    error,
    isAuthenticated: status === 'authenticated',
  };
};
