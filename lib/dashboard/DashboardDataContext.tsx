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
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useDashboardAdmin } from './DashboardAdminContext';
import { registerCharts } from '../charts/register';
import {
  clampReferenceToPresent,
  getDashboardDateRange,
  type DashboardDateFilter,
} from './dateRange';
import type { DashboardTask } from './types';

export interface DashboardCaseRow {
  id_case?: number;
  subject_case?: string;
  status?: string;
  status_case?: string;
  id_status_case?: number;
  priority?: string;
  department?: string;
  case_type?: string;
  category?: string;
  creation_date?: string | Date;
  end_date?: string | Date | null;
  nombreTecnico?: string;
  company?: string;
  resolution?: string;
  [key: string]: unknown;
}

interface DashboardDataContextValue {
  session: ReturnType<typeof useSession>['data'];
  status: ReturnType<typeof useSession>['status'];
  tasks: DashboardTask[];
  tasksLoading: boolean;
  tasksRefreshing: boolean;
  tasksError: string | null;
  cases: DashboardCaseRow[];
  ticketsLoading: boolean;
  ticketsRefreshing: boolean;
  ticketsError: string | null;
  dateFilter: DashboardDateFilter;
  setDateFilter: (v: DashboardDateFilter) => void;
  selectedMonthDate: Date;
  setSelectedMonthDate: (d: Date) => void;
  fetchTasks: (opts?: { silent?: boolean }) => Promise<void>;
  fetchTickets: (opts?: { silent?: boolean }) => Promise<void>;
  isAdmin: boolean;
  loadingAdmin: boolean;
  appliedRange: string | null;
  ticketsAppliedRange: string | null;
  activeDateRange: ReturnType<typeof getDashboardDateRange>;
}

const DashboardDataContext = createContext<DashboardDataContextValue | null>(null);

function buildTasksUrl(dateFilter: DashboardDateFilter, selectedMonthDate: Date): string {
  const dateRange = getDashboardDateRange(dateFilter, selectedMonthDate);
  let url = '/api/requests-general/view-tasks';
  if (dateRange) {
    const params = new URLSearchParams({
      date_from: dateRange.startDate,
      date_to: dateRange.endDate,
    });
    url = `${url}?${params}`;
  }
  return url;
}

function periodCacheKey(dateFilter: DashboardDateFilter, selectedMonthDate: Date): string {
  const range = getDashboardDateRange(dateFilter, selectedMonthDate);
  return range
    ? `${dateFilter}:${range.startDate}:${range.endDate}`
    : `${dateFilter}:all`;
}

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { isDashboardAdmin, loadingDashboardAdmin } = useDashboardAdmin();

  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksRefreshing, setTasksRefreshing] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [cases, setCases] = useState<DashboardCaseRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsRefreshing, setTicketsRefreshing] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>('month');
  const [selectedMonthDate, setSelectedMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [appliedRange, setAppliedRange] = useState<string | null>(null);
  const [ticketsAppliedRange, setTicketsAppliedRange] = useState<string | null>(null);
  const isAdmin = isDashboardAdmin;
  const loadingAdmin = loadingDashboardAdmin;

  const tasksCacheKey = useRef<string | null>(null);
  const ticketsCacheKey = useRef<string | null>(null);
  const ticketsFetchGen = useRef(0);

  useEffect(() => {
    registerCharts();
  }, []);

  const setDateFilterSafe = useCallback((filter: DashboardDateFilter) => {
    setDateFilter(filter);
    setSelectedMonthDate((prev) => clampReferenceToPresent(prev, filter));
  }, []);

  const setSelectedMonthDateSafe = useCallback(
    (date: Date) => {
      setSelectedMonthDate(clampReferenceToPresent(date, dateFilter));
    },
    [dateFilter]
  );

  useEffect(() => {
    setSelectedMonthDate((prev) => {
      const clamped = clampReferenceToPresent(prev, dateFilter);
      return clamped.getTime() === prev.getTime() ? prev : clamped;
    });
  }, [dateFilter]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) router.push('/login');
  }, [session, status, router]);

  const fetchTasks = useCallback(
    async (opts?: { silent?: boolean }) => {
      const key = periodCacheKey(dateFilter, selectedMonthDate);
      const hasCache = tasksCacheKey.current === key;
      const silent = opts?.silent ?? hasCache;

      try {
        if (silent) {
          setTasksRefreshing(true);
        } else {
          setTasksLoading(true);
        }
        setTasksError(null);

        const response = await fetch(buildTasksUrl(dateFilter, selectedMonthDate), {
          credentials: 'same-origin',
        });
        if (response.status === 401) {
          throw new Error('Sesión no válida. Recarga la página o vuelve a iniciar sesión.');
        }
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || 'Error al cargar los datos del dashboard'
          );
        }

        const result = await response.json();
        setTasks(result.data || []);
        tasksCacheKey.current = key;

        const applied = result.filters_applied as
          | { date_from?: string | null; date_to?: string | null }
          | undefined;
        if (applied?.date_from && applied?.date_to) {
          setAppliedRange(`${applied.date_from} → ${applied.date_to}`);
        } else {
          setAppliedRange(null);
        }
      } catch (err) {
        console.error('Error fetching tasks:', err);
        setTasksError(err instanceof Error ? err.message : 'Error desconocido al cargar los datos');
      } finally {
        setTasksLoading(false);
        setTasksRefreshing(false);
      }
    },
    [dateFilter, selectedMonthDate]
  );

  const fetchTickets = useCallback(
    async (opts?: { silent?: boolean }) => {
      const key = periodCacheKey(dateFilter, selectedMonthDate);
      const hasCache = ticketsCacheKey.current === key;
      const silent = opts?.silent ?? hasCache;
      const gen = ++ticketsFetchGen.current;

      try {
        if (silent) {
          setTicketsRefreshing(true);
        } else {
          setTicketsLoading(true);
        }
        setTicketsError(null);

        const dateRange = getDashboardDateRange(dateFilter, selectedMonthDate);
        let url = '/api/help-desk/dashboard-cases';
        if (dateRange) {
          const params = new URLSearchParams({
            date_from: dateRange.startDate,
            date_to: dateRange.endDate,
          });
          url = `${url}?${params}`;
        }

        const res = await fetch(url, { credentials: 'same-origin' });
        if (res.status === 401) {
          throw new Error('Sesión no válida. Recarga la página o vuelve a iniciar sesión.');
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || 'Error al cargar tickets'
          );
        }
        const data = await res.json();
        if (gen !== ticketsFetchGen.current) return;

        setCases(data.data || []);
        ticketsCacheKey.current = key;

        const applied = data.filters_applied as
          | { date_from?: string | null; date_to?: string | null }
          | null
          | undefined;
        if (applied?.date_from && applied?.date_to) {
          setTicketsAppliedRange(`${applied.date_from} → ${applied.date_to}`);
        } else {
          setTicketsAppliedRange(null);
        }
      } catch (err) {
        if (gen !== ticketsFetchGen.current) return;
        setTicketsError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (gen !== ticketsFetchGen.current) return;
        setTicketsLoading(false);
        setTicketsRefreshing(false);
      }
    },
    [dateFilter, selectedMonthDate]
  );

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) return;
    void fetchTickets();
  }, [status, session?.user?.email, dateFilter, selectedMonthDate, fetchTickets]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) return;
    void fetchTasks();
  }, [status, session?.user?.email, dateFilter, selectedMonthDate, fetchTasks]);

  const activeDateRange = getDashboardDateRange(dateFilter, selectedMonthDate);

  const value = useMemo<DashboardDataContextValue>(
    () => ({
      session,
      status,
      tasks,
      tasksLoading,
      tasksRefreshing,
      tasksError,
      cases,
      ticketsLoading,
      ticketsRefreshing,
      ticketsError,
      dateFilter,
      setDateFilter: setDateFilterSafe,
      selectedMonthDate,
      setSelectedMonthDate: setSelectedMonthDateSafe,
      fetchTasks,
      fetchTickets,
      isAdmin,
      loadingAdmin,
      appliedRange,
      ticketsAppliedRange,
      activeDateRange,
    }),
    [
      session,
      status,
      tasks,
      tasksLoading,
      tasksRefreshing,
      tasksError,
      cases,
      ticketsLoading,
      ticketsRefreshing,
      ticketsError,
      dateFilter,
      selectedMonthDate,
      setDateFilterSafe,
      setSelectedMonthDateSafe,
      fetchTasks,
      fetchTickets,
      isAdmin,
      loadingAdmin,
      appliedRange,
      ticketsAppliedRange,
      activeDateRange,
    ]
  );

  return (
    <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>
  );
}

export function useDashboardData(): DashboardDataContextValue {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error('useDashboardData debe usarse dentro de DashboardDataProvider');
  }
  return ctx;
}
