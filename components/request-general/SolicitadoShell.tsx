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
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Button, Center, Loader } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type {
  DashboardActivityRow,
  DashboardCounts,
  DashboardRequestRow,
} from './RequestRoleDashboard';
import { PROCESS_HUB_URL } from '../../lib/navigation/AppSectionContext';
import { fetchWithRetry } from '../../lib/navigation/fetchWithRetry';
import { fetchNavAccess } from '../../lib/navigation/navAccess';
import {
  SOLICITADO_TAB_URL,
  SolicitadoTabProvider,
  pathnameToSolicitadoTab,
} from '../../lib/request-general/SolicitadoTabContext';
import type { TeamActivityRow } from '../../lib/request-general/teamWorkload';
import SolicitadoNav from './SolicitadoNav';
import SolicitadoPeriodLabel from './SolicitadoPageHeading';
import DashboardDateToolbar from '../dashboard/DashboardDateToolbar';
import { panelStyles } from '../ui/panel/Panel';
import {
  getDashboardDateRange,
  getPeriodRangeLabel,
  parseCalendarDate,
  type DashboardDateFilter,
  type DateRangeStrings,
} from '../../lib/dashboard/dateRange';

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

export interface SolicitadoAccess {
  /** Pestañas «Mis procesos» y «Mis actividades» (permiso asignado). */
  personal: boolean;
  /** Pestaña «Mi equipo» (automática para el líder de proceso). */
  equipo: boolean;
}

export interface SolicitadoDataContextValue {
  access: SolicitadoAccess;
  requests: DashboardRequestRow[];
  /** Sin filtrar por fecha: lo pendiente es la foto de hoy. */
  allRequests: DashboardRequestRow[];
  allActivities: DashboardActivityRow[];
  activities: DashboardActivityRow[];
  requestCounts: DashboardCounts;
  activityCounts: DashboardCounts;
  /** Actividades del equipo SIN filtrar por fecha (las pendientes son la foto de hoy). */
  teamActivities: TeamActivityRow[];
  dateRange: DateRangeStrings | null;
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

type AccessCheck = 'allowed' | 'denied';

/**
 * Solo un "no" definitivo del servidor cuenta como sin acceso; una falla temporal lanza error.
 * Reutiliza la llamada del menú (lib/navigation/navAccess.ts): antes eran 2 llamadas más.
 */
async function checkAccess(email: string): Promise<{ personal: AccessCheck; equipo: AccessCheck }> {
  const result = await fetchNavAccess(email);
  if (!result.ok) throw new Error('No se pudo verificar el acceso. Intenta de nuevo.');
  return {
    personal: result.access.solicitado ? 'allowed' : 'denied',
    equipo: result.access.equipo ? 'allowed' : 'denied',
  };
}

async function fetchJson(url: string, fallbackError: string) {
  const res = await fetchWithRetry(url, { credentials: 'same-origin', cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackError);
  return data;
}

export function SolicitadoShell({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<SolicitadoAccess>({ personal: false, equipo: false });
  const [allRequests, setAllRequests] = useState<DashboardRequestRow[]>([]);
  const [allActivities, setAllActivities] = useState<DashboardActivityRow[]>([]);
  const [teamActivities, setTeamActivities] = useState<TeamActivityRow[]>([]);
  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>('month');
  const [selectedMonthDate, setSelectedMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const loadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      const email = session?.user?.email;
      if (!email) return;
      try {
        if (silent) setRefreshing(true);
        else {
          setLoading(true);
          setError(null);
        }

        // Normalmente ya está en caché (el menú la pidió al entrar): no suma un viaje.
        const { personal, equipo } = await checkAccess(email);
        if (personal === 'denied' && equipo === 'denied') {
          router.replace(PROCESS_HUB_URL);
          return;
        }

        const [personalData, teamData] = await Promise.all([
          personal === 'allowed'
            ? fetchJson('/api/requests-general/dashboard-solicitado', 'No se pudo cargar el dashboard')
            : null,
          equipo === 'allowed'
            ? fetchJson('/api/requests-general/dashboard-equipo', 'No se pudo cargar tu equipo')
            : null,
        ]);

        setAccess({ personal: personal === 'allowed', equipo: equipo === 'allowed' });
        setAllRequests(Array.isArray(personalData?.requests) ? personalData.requests : []);
        setAllActivities(Array.isArray(personalData?.activities) ? personalData.activities : []);
        setTeamActivities(Array.isArray(teamData?.activities) ? teamData.activities : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, session?.user?.email]
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

  // Pestaña sin acceso (p. ej. líder sin el permiso personal): a la que sí puede ver.
  const activeTab = pathnameToSolicitadoTab(pathname);
  const tabAllowed = activeTab === 'equipo' ? access.equipo : access.personal;
  useEffect(() => {
    if (loading || error || tabAllowed) return;
    if (access.equipo) router.replace(SOLICITADO_TAB_URL.equipo);
    else if (access.personal) router.replace(SOLICITADO_TAB_URL.procesos);
  }, [loading, error, tabAllowed, access, router]);

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
      access,
      requests,
      allRequests,
      allActivities,
      activities,
      requestCounts,
      activityCounts,
      teamActivities,
      dateRange,
      dateFilter,
      setDateFilter,
      selectedMonthDate,
      setSelectedMonthDate,
      appliedRange,
      refreshing,
      refresh,
    }),
    [
      access,
      requests,
      allRequests,
      allActivities,
      activities,
      requestCounts,
      activityCounts,
      teamActivities,
      dateRange,
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
      <Alert icon={<IconAlertCircle size={16} />} title='Dashboard personal' color='red' m='md'>
        {error}
        <Button size='xs' variant='light' color='red' mt='sm' onClick={() => void loadData()}>
          Reintentar
        </Button>
      </Alert>
    );
  }

  return (
    <SolicitadoDataContext.Provider value={value}>
      <SolicitadoTabProvider>
        <div className={`${panelStyles.root} ${panelStyles.page}`}>
          <div className={panelStyles.container}>
            <header className={panelStyles.header}>
              <div>
                <SolicitadoPeriodLabel />
                <h1 className={panelStyles.largeTitle}>Dashboard personal</h1>
              </div>
              <div className={panelStyles.headerControls}>
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
            </header>
            <div className='min-w-0' style={{ marginBottom: 24 }}>
              <SolicitadoNav />
            </div>
            <div className='solicitado-shell-content min-w-0'>
              {tabAllowed ? Children.toArray(children) : null}
            </div>
          </div>
        </div>
      </SolicitadoTabProvider>
    </SolicitadoDataContext.Provider>
  );
}
