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
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { registerCharts } from '../charts/register';
import {
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
  activeDateRange: ReturnType<typeof getDashboardDateRange>;
  exportDashboardToExcel: () => Promise<void>;
  exportingExcel: boolean;
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
  const [exportingExcel, setExportingExcel] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [appliedRange, setAppliedRange] = useState<string | null>(null);

  const tasksCacheKey = useRef<string | null>(null);
  const ticketsCacheKey = useRef<string | null>(null);

  useEffect(() => {
    registerCharts();
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) router.push('/login');
  }, [session, status, router]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!session?.user?.email) {
        setIsAdmin(false);
        setLoadingAdmin(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/requests-general/verify-permissions?email=${encodeURIComponent(session.user.email)}`
        );
        if (res.ok) {
          const data = await res.json();
          setIsAdmin(Boolean(data.user?.isAdmin));
        } else {
          setIsAdmin(false);
        }
      } catch {
        setIsAdmin(false);
      } finally {
        setLoadingAdmin(false);
      }
    };
    if (status === 'authenticated') checkAdmin();
  }, [session?.user?.email, status]);

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

        const response = await fetch(buildTasksUrl(dateFilter, selectedMonthDate));
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

        const res = await fetch(url);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || 'Error al cargar tickets'
          );
        }
        const data = await res.json();
        setCases(data.data || []);
        ticketsCacheKey.current = key;
      } catch (err) {
        setTicketsError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        setTicketsLoading(false);
        setTicketsRefreshing(false);
      }
    },
    [dateFilter, selectedMonthDate]
  );

  useEffect(() => {
    if (status !== 'authenticated') return;
    void fetchTickets();
  }, [status, dateFilter, selectedMonthDate, fetchTickets]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    void fetchTasks();
  }, [status, dateFilter, selectedMonthDate, fetchTasks]);

  const exportDashboardToExcel = async () => {
    try {
      setExportingExcel(true);
      const dateRange = getDashboardDateRange(dateFilter, selectedMonthDate);
      let exportUrl = '/api/dashboard/export';
      if (dateRange) {
        const params = new URLSearchParams({
          date_from: dateRange.startDate,
          date_to: dateRange.endDate,
        });
        exportUrl = `${exportUrl}?${params}`;
      }
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Error al obtener datos del servidor');
      const { solicitudes, actividades } = await res.json();

      const workbook = new ExcelJS.Workbook();
      const sheet1 = workbook.addWorksheet('Solicitudes');
      if (solicitudes.length > 0) {
        sheet1.columns = Object.keys(solicitudes[0]).map((k: string) => ({ header: k, key: k }));
        solicitudes.forEach((row: Record<string, unknown>) => sheet1.addRow(row));
      }
      const sheet2 = workbook.addWorksheet('Actividades');
      if (actividades.length > 0) {
        sheet2.columns = Object.keys(actividades[0]).map((k: string) => ({ header: k, key: k }));
        actividades.forEach((row: Record<string, unknown>) => sheet2.addRow(row));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'Dashboard-Kronos.xlsx'
      );
    } catch (err) {
      console.error('Error exportando Excel:', err);
    } finally {
      setExportingExcel(false);
    }
  };

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
      setDateFilter,
      selectedMonthDate,
      setSelectedMonthDate,
      fetchTasks,
      fetchTickets,
      isAdmin,
      loadingAdmin,
      appliedRange,
      activeDateRange,
      exportDashboardToExcel,
      exportingExcel,
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
      fetchTasks,
      fetchTickets,
      isAdmin,
      loadingAdmin,
      appliedRange,
      activeDateRange,
      exportingExcel,
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
