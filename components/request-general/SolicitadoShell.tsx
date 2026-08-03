'use client';

import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Center, Loader } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type {
  DashboardActivityRow,
  DashboardCounts,
  DashboardRequestRow,
} from './RequestRoleDashboard';
import { PROCESS_HUB_URL } from '../../lib/navigation/AppSectionContext';
import { SolicitadoTabProvider } from '../../lib/request-general/SolicitadoTabContext';
import SolicitadoNav from './SolicitadoNav';
import SolicitadoPeriodLabel from './SolicitadoPageHeading';
import DashboardDateToolbar from '../dashboard/DashboardDateToolbar';
import {
  getDashboardDateRange,
  getPeriodRangeLabel,
  parseCalendarDate,
  type DashboardDateFilter,
} from '../../lib/dashboard/dateRange';

const EMPTY_COUNTS: DashboardCounts = {
  total: 0,
  abierto: 0,
  enProgreso: 0,
  resuelto: 0,
  cancelado: 0,
  otros: 0,
};

function countByStatus(statuses: Array<string | null | undefined>): DashboardCounts {
  const counts: DashboardCounts = {
    total: statuses.length,
    abierto: 0,
    enProgreso: 0,
    resuelto: 0,
    cancelado: 0,
    otros: 0,
  };

  for (const raw of statuses) {
    const s = String(raw ?? '').toLowerCase();
    if (s.includes('abiert') || s.includes('sin empezar')) counts.abierto += 1;
    else if (s.includes('progreso') || s.includes('proceso')) counts.enProgreso += 1;
    else if (s.includes('resuelt') || s.includes('complet')) counts.resuelto += 1;
    else if (s.includes('cancel')) counts.cancelado += 1;
    else counts.otros += 1;
  }

  return counts;
}

function isDateInRange(
  value: string | null | undefined,
  range: { startDate: string; endDate: string } | null
): boolean {
  if (!range) return true;
  const d = parseCalendarDate(value);
  if (!d) return false;
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return key >= range.startDate && key <= range.endDate;
}

export interface SolicitadoDataContextValue {
  requests: DashboardRequestRow[];
  activities: DashboardActivityRow[];
  requestCounts: DashboardCounts;
  activityCounts: DashboardCounts;
  dateFilter: DashboardDateFilter;
  setDateFilter: (value: DashboardDateFilter) => void;
  selectedMonthDate: Date;
  setSelectedMonthDate: (date: Date) => void;
  appliedRange: string;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

const SolicitadoDataContext = createContext<SolicitadoDataContextValue | null>(null);

export function useSolicitadoData(): SolicitadoDataContextValue {
  const ctx = useContext(SolicitadoDataContext);
  if (!ctx) {
    throw new Error('useSolicitadoData debe usarse dentro de SolicitadoShell');
  }
  return ctx;
}

export function SolicitadoShell({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allRequests, setAllRequests] = useState<DashboardRequestRow[]>([]);
  const [allActivities, setAllActivities] = useState<DashboardActivityRow[]>([]);
  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>('month');
  const [selectedMonthDate, setSelectedMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const loadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      try {
        if (silent) setRefreshing(true);
        else {
          setLoading(true);
          setError(null);
        }

        const accessRes = await fetch(
          '/api/requests-general/dashboard-access?kind=solicitado',
          { credentials: 'same-origin', cache: 'no-store' }
        );
        const accessData = await accessRes.json().catch(() => ({}));
        if (!accessRes.ok || !accessData.allowed) {
          router.replace(PROCESS_HUB_URL);
          return;
        }

        const res = await fetch('/api/requests-general/dashboard-solicitado', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo cargar el dashboard');
        }

        setAllRequests(Array.isArray(data.requests) ? data.requests : []);
        setAllActivities(Array.isArray(data.activities) ? data.activities : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }

    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadData();
    })();

    return () => {
      cancelled = true;
    };
  }, [session, status, router, loadData]);

  const dateRange = useMemo(
    () => getDashboardDateRange(dateFilter, selectedMonthDate),
    [dateFilter, selectedMonthDate]
  );

  const requests = useMemo(
    () => allRequests.filter((r) => isDateInRange(r.created_at, dateRange)),
    [allRequests, dateRange]
  );

  const activities = useMemo(
    () =>
      allActivities.filter((a) =>
        isDateInRange(a.start_date ?? a.date_resolution, dateRange)
      ),
    [allActivities, dateRange]
  );

  const requestCounts = useMemo(
    () => countByStatus(requests.map((r) => r.status)),
    [requests]
  );

  const activityCounts = useMemo(
    () => countByStatus(activities.map((a) => a.status_task)),
    [activities]
  );

  const appliedRange = useMemo(
    () => getPeriodRangeLabel(dateFilter, selectedMonthDate),
    [dateFilter, selectedMonthDate]
  );

  const refresh = useCallback(async () => {
    await loadData({ silent: true });
  }, [loadData]);

  const value = useMemo(
    () => ({
      requests,
      activities,
      requestCounts,
      activityCounts,
      dateFilter,
      setDateFilter,
      selectedMonthDate,
      setSelectedMonthDate,
      appliedRange,
      refreshing,
      refresh,
    }),
    [
      requests,
      activities,
      requestCounts,
      activityCounts,
      dateFilter,
      selectedMonthDate,
      appliedRange,
      refreshing,
      refresh,
    ]
  );

  if (status === 'loading' || loading) {
    return (
      <Center mih='50vh'>
        <Loader />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title='Mis procesos' color='red' m='md'>
        {error}
      </Alert>
    );
  }

  return (
    <SolicitadoDataContext.Provider value={value}>
      <SolicitadoTabProvider>
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
          <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
            <SolicitadoPeriodLabel />
            <div className='mb-md' style={{ marginBottom: 12 }}>
              <DashboardDateToolbar
                dateFilter={dateFilter}
                onDateFilterChange={setDateFilter}
                selectedMonthDate={selectedMonthDate}
                onSelectedMonthDateChange={setSelectedMonthDate}
                onRefresh={() => void refresh()}
                loading={refreshing}
                showExport={false}
              />
            </div>
            <div className='dashboard-sticky-chrome min-w-0 mb-2'>
              <SolicitadoNav />
            </div>
            <div className='solicitado-shell-content min-w-0'>{Children.toArray(children)}</div>
          </div>
        </div>
      </SolicitadoTabProvider>
    </SolicitadoDataContext.Provider>
  );
}
