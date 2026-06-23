'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { SUBPROCESS_ASSIGNMENTS_CHANGED } from './subprocessAssignmentsEvents';

export interface ProcessRecord {
  id_process: number;
  process: string;
  process_url?: string;
  subprocesses: {
    id_subprocess: number;
    subprocess: string;
    subprocess_url?: string;
    subprocessUserCompanies?: {
      id_subprocess_user_company: number;
      companyUser: {
        id_company_user: number;
        company: { id_company: number; company: string };
      };
    }[];
  }[];
}

interface ProcessDataContextValue {
  processes: ProcessRecord[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  fetchProcesses: (opts?: { silent?: boolean }) => Promise<void>;
}

const ProcessDataContext = createContext<ProcessDataContextValue | null>(null);

export function ProcessDataProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const [processes, setProcesses] = useState<ProcessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const fetchProcesses = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? loaded.current;

    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await fetch('/api/processes', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Error al obtener los procesos');
      }
      const data: ProcessRecord[] = await response.json();
      setProcesses(data);
      loaded.current = true;
    } catch (err) {
      setError('No se pueden cargar los procesos. Por favor, inténtalo de nuevo.');
      console.error('Error fetching processes:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void fetchProcesses();
    }
  }, [status, fetchProcesses]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (pathname !== '/process') return;
    void fetchProcesses({ silent: loaded.current });
  }, [pathname, status, fetchProcesses]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (pathname !== '/process') return;

    const refresh = () => void fetchProcesses({ silent: true });
    const onAssignmentsChanged = () => refresh();

    window.addEventListener(SUBPROCESS_ASSIGNMENTS_CHANGED, onAssignmentsChanged);

    return () => {
      window.removeEventListener(SUBPROCESS_ASSIGNMENTS_CHANGED, onAssignmentsChanged);
    };
  }, [pathname, status, fetchProcesses]);

  const value = useMemo(
    () => ({ processes, loading, refreshing, error, fetchProcesses }),
    [processes, loading, refreshing, error, fetchProcesses]
  );

  return <ProcessDataContext.Provider value={value}>{children}</ProcessDataContext.Provider>;
}

export function useProcessData(): ProcessDataContextValue {
  const ctx = useContext(ProcessDataContext);
  if (!ctx) {
    throw new Error('useProcessData debe usarse dentro de ProcessDataProvider');
  }
  return ctx;
}
