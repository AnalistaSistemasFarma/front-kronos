'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface Process {
  id_process: number;
  process: string;
  subprocesses: Array<{
    id_subprocess: number;
    subprocess: string;
    subprocessUserCompanies?: Array<{
      id_subprocess_user_company: number;
      companyUser: {
        company: {
          company: string;
        };
      };
    }>;
  }>;
}

export const useHelpDeskAccess = () => {
  const { data: session, status } = useSession();
  const [hasAccess, setHasAccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAccess = async () => {
      if (status === 'loading') return;
      if (!session?.user?.email) {
        setHasAccess(false);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/processes');
        if (!response.ok) {
          throw new Error('Failed to fetch user processes');
        }

        const processes: Process[] = await response.json();

        // Check if user has access to help-desk process
        const hasHelpDeskAccess = processes.some(
          (process) =>
            process.process.toLowerCase().includes('help') &&
            process.process.toLowerCase().includes('desk') &&
            process.subprocesses.length > 0
        );

        setHasAccess(hasHelpDeskAccess);
      } catch (err) {
        console.error('Error checking help desk access:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setHasAccess(false);
      } finally {
        setLoading(false);
      }
    };

    checkAccess();
  }, [session, status]);

  return {
    hasAccess,
    loading,
    error,
    isAuthenticated: status === 'authenticated',
  };
};
