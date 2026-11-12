'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { useMediaQuery } from '@mantine/hooks';
import {
  Title,
  Paper,
  Text,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Card,
  Textarea,
  TextInput,
  Select,
  Checkbox,
  Grid,
  Alert,
  LoadingOverlay,
  Box,
  Modal,
  Collapse,
  Table,
  Tooltip,
  Loader,
  Pagination,
  SegmentedControl,
} from '@mantine/core';
import {
  IconCalendar,
  IconUser,
  IconBuilding,
  IconNote,
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconX,
  IconFlag,
  IconTicket,
  IconFilter,
  IconClock,
  IconUpload,
  IconFile,
  IconFileText,
  IconFileSpreadsheet,
  IconPhoto,
  IconRefresh,
  IconProgress,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCircle,
  IconUserCheck,
  IconTag,
  IconCalendarEvent,
  IconDownload,
  IconListCheck,
  IconFileDescription,
} from '@tabler/icons-react';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';
import {
  FilterPanel,
  ProgressRingTile,
  RequestProgressBar,
  RequestsHeader,
  RequestsPage,
  StatFilterTile,
} from '../../../../../components/request-general/list/RequestListUi';
import requestListStyles from '../../../../../components/request-general/list/requestList.module.css';
import WorkloadDistribution from '../../../../../components/request-general/WorkloadDistribution';
import TeamTasksPanel, { useTeamAccess } from '../../../../../components/request-general/TeamTasksPanel';
import { RequestFlowBar, useRequestFlows } from '../../../../../components/request-general/RequestFlow';
import AutoRefreshNote from '../../../../../components/ui/AutoRefreshNote';
import IosSearchField from '../../../../../components/ui/IosSearchField';
import { useAutoRefresh } from '../../../../../components/ui/useAutoRefresh';
import { useRequestListPersistence } from '../../../../../components/request-general/list/useRequestListPersistence';
import {
  loadLastViewed,
  pageOfItem,
  saveRequestListNav,
  type NavItem,
} from '../../../../../lib/requests-general/requestListNav';
import { filterByText, requestSearchParts } from '../../../../../lib/requests-general/textSearch';
import { RequestListFilters } from '../../../../../components/request-general/list/RequestListFilters';
import {
  ASSIGNED_STATE_OPTIONS,
  EMPTY_LIST_FILTERS,
  buildListOptions,
  countByStatusGroup,
  describeListFilters,
  matchesListFilters,
  splitPeople,
  stateGroup,
  statusGroupOf,
  type ListFilters,
  type ListRow,
  type StatusGroup,
} from '../../../../../lib/requests-general/listFilters';
import {
  buildTaskDisplayBadges,
  getSimplifiedTasksProgress,
} from '@/lib/orion/taskProgress';
// Solo el tipo: exportBoardExcel (y con él exceljs, ~900 KB) se carga al tocar Exportar.
import type { BoardRequest } from '@/lib/request-general/exportBoardExcel';
import { downloadWorkbook } from '@/lib/dashboard/excel/excelHelpers';
import { formatEstimatedPaymentDateShort } from '@/lib/treasury/estimatedPaymentDate';
import { parseTableValue, parseTableConfig } from '@/lib/requests-general/tableField';
import { createPrerenderSearchParamsForClientPage } from 'next/dist/server/request/search-params';

const ITEMS_PER_PAGE = 100;

interface Ticket {
  id: number;
  subject: string;
  description: string;
  user: string;
  status: string;
  created_at: string;
  category: string;
  process: string;
  id_category: number;
  id_company: number;
  requester: string;
  company: string;
  email: string;
  phone: string;
  identification: string;
  id_status_case?: number;
  users_category?: string | null;
}

interface RequestTask {
  id: number;
  id_request_general: number;
  task: string;
  id_status: number;
  status_task: string;
  resolution?: string | null;
}

interface AssignedTask {
  id: number;
  id_task: number;
  task: string;
  id_request_general: number;
  description: string;
  subject_request: string;
  id_company: number;
  company: string;
  process: string;
  created_at: string;
  id_requester: number;
  name_requester: string;
  status_req: number;
  id_status: number;
  status_task: string;
  assigned: string;
  category?: string | null;
}

type AssignedItem =
  | { kind: 'request'; key: string; data: Ticket; createdAt: string }
  | { kind: 'task'; key: string; data: AssignedTask; createdAt: string };

type TypeFilter = 'all' | 'requests' | 'tasks';

/** Fila de la lista con lo que necesitan los filtros y el buscador. */
type AssignedEntry = { item: AssignedItem; row: ListRow; parts: unknown[] };

const navItemOf = (item: AssignedItem): NavItem => ({
  kind: item.kind,
  id: Number(item.kind === 'task' ? (item.data as AssignedTask).id : (item.data as Ticket).id),
});

const entryOfType = (entry: AssignedEntry, type: TypeFilter) =>
  type === 'all' || (type === 'requests' ? entry.item.kind === 'request' : entry.item.kind === 'task');

interface Note {
  id_note: number;
  note: string;
  createdBy: string;
  creation_date?: string;
}

interface Option {
  value: string;
  label: string;
}

interface ProcessCategoryData {
  id_process: number;
  process: string;
  id_category_request: number;
  category: string;
}

interface FolderFile {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
}

function RequestBoard() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [userIdInitialized, setUserIdInitialized] = useState(false);
  const [processes, setProcess] = useState<{ value: string; label: string }[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const isMobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  // «Todo lo abierto»: tareas abiertas (no Resuelto/Cancelado, incluye Sin empezar) de las
  // solicitudes que el usuario ve aquí, aunque estén asignadas a otra persona.
  const [openAll, setOpenAll] = useState(false);
  const [openScopeTasks, setOpenScopeTasks] = useState<AssignedTask[]>([]);
  const initialType = searchParams.get('type');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    initialType === 'tasks' || initialType === 'requests' ? initialType : 'all'
  );
  // Pestaña "Mi equipo": solo para quien tiene el permiso "Ver tareas de mi equipo" (Líder de solicitudes).
  const teamAccess = useTeamAccess();
  const canViewTeam = Boolean(teamAccess?.canViewTeam);
  const [showTeam, setShowTeam] = useState(false);
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [tasksByRequest, setTasksByRequest] = useState<Record<number, RequestTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    company: '',
    usuario: '',
    descripcion: '',
    category: '',
    process: '',
  });

  const [companies, setCompany] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [processCategories, setProcessCategories] = useState<
    { value: string; label: string; id_category_request: number }[]
  >([]);
  const [filteredProcesses, setFilteredProcesses] = useState<{ value: string; label: string }[]>(
    []
  );
  const [assignedUsers, setAssignedUsers] = useState<{ value: string; label: string }[]>([]);
  const [idUser, setIdUser] = useState('');

  // Filtros iguales a los de Mis solicitudes: el estado es GENERAL ("Pendientes" trae solicitudes
  // y tareas a la vez) y todo se filtra en el navegador sobre la lista COMPLETA, no por página.
  // La paginación solo reparte lo ya filtrado para pintarlo.
  const [filters, setFilters] = useState<ListFilters>(EMPTY_LIST_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const byCreatedAtDesc =(a: { createdAt: string }, b: { createdAt: string }) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  const allEntries = useMemo<AssignedEntry[]>(() => {
    const requests: AssignedEntry[] = tickets.map((t) => ({
      item: { kind: 'request', key: `req-${t.id}`, data: t, createdAt: t.created_at },
      row: {
        requestId: t.id,
        group: statusGroupOf(t.id_status_case, t.status),
        statusId: t.id_status_case,
        companyId: String(t.id_company ?? ''),
        company: t.company,
        process: t.process,
        people: splitPeople(t.user, t.users_category),
        createdAt: t.created_at,
      },
      parts: requestSearchParts(t),
    }));
    const ownTaskIds = new Set(assignedTasks.map((t) => t.id));
    const taskRows = openAll
      ? [...assignedTasks, ...openScopeTasks.filter((t) => !ownTaskIds.has(t.id))]
      : assignedTasks;
    const tasks: AssignedEntry[] = taskRows.map((t) => ({
      item: { kind: 'task', key: `task-${t.id}`, data: t, createdAt: t.created_at },
      row: {
        requestId: t.id_request_general,
        group: statusGroupOf(t.id_status, t.status_task),
        statusId: t.id_status,
        companyId: String(t.id_company ?? ''),
        company: t.company,
        process: t.process,
        people: splitPeople(t.assigned),
        createdAt: t.created_at,
      },
      parts: [
        t.id_request_general,
        t.task,
        t.subject_request,
        t.description,
        t.company,
        t.process,
        t.status_task,
        t.name_requester,
        t.assigned,
      ],
    }));
    return [...requests, ...tasks].sort((a, b) => byCreatedAtDesc(a.item, b.item));
  }, [tickets, assignedTasks, openAll, openScopeTasks]);

  // «Estado» exacto (Sin empezar, Abierto, Cancelado, Resuelto, Devuelta): el filtro que había antes del panel.
  const listOptions = useMemo(
    () => ({ ...buildListOptions(allEntries.map((e) => e.row)), states: ASSIGNED_STATE_OPTIONS }),
    [allEntries]
  );
  // Buscador + filtros del panel (sin estado ni tipo): base de las tarjetas y las pestañas.
  const matchingEntries = useMemo(
    () =>
      filterByText(allEntries, deferredSearch, (e) => e.parts).filter((e) =>
        matchesListFilters(e.row, filters, { ignoreStatus: true })
      ),
    [allEntries, deferredSearch, filters]
  );
  const typedEntries = useMemo(
    () => matchingEntries.filter((e) => entryOfType(e, typeFilter)),
    [matchingEntries, typeFilter]
  );
  const statusCounts = useMemo(() => countByStatusGroup(typedEntries.map((e) => e.row)), [typedEntries]);
  // En «Todos» cada tarjeta dice cuántas son solicitudes y cuántas tareas.
  const statusHints = useMemo(() => {
    if (typeFilter !== 'all') return undefined;
    const hints: Partial<Record<StatusGroup, string>> = {};
    for (const group of ['all', 'pending', 'returned', 'done', 'cancelled'] as StatusGroup[]) {
      const inGroup = typedEntries.filter((e) => group === 'all' || e.row.group === group);
      const requests = inGroup.filter((e) => e.item.kind === 'request').length;
      hints[group] = `${requests} solicitudes · ${inGroup.length - requests} tareas`;
    }
    return hints;
  }, [typedEntries, typeFilter]);
  const visibleEntries = useMemo(
    () => typedEntries.filter((e) => matchesListFilters(e.row, filters)),
    [typedEntries, filters]
  );
  // Pestañas Todos / Solicitudes / Tareas con el estado elegido.
  const kindCounts = useMemo(() => {
    const withStatus = matchingEntries.filter((e) => matchesListFilters(e.row, filters));
    const requests = withStatus.filter((e) => e.item.kind === 'request').length;
    return { all: withStatus.length, requests, tasks: withStatus.length - requests };
  }, [matchingEntries, filters]);

  // Orden exacto en pantalla (todas las páginas) para «Anterior / Siguiente» del detalle.
  const visibleNavItems = useMemo(() => visibleEntries.map((e) => navItemOf(e.item)), [visibleEntries]);

  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems: AssignedItem[] = visibleEntries
    .slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
    .map((e) => e.item);

  // Al cambiar filtros, búsqueda o tipo se vuelve a la primera página.
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, deferredSearch, typeFilter]);

  const fetchOpenScopeTasks = async () => {
    try {
      const res = await fetch('/api/requests-general/activities-assigned?status=0&scope=open');
      if (!res.ok) throw new Error('Failed to fetch open tasks');
      const data: unknown = await res.json();
      setOpenScopeTasks(Array.isArray(data) ? (data as AssignedTask[]) : []);
    } catch (err) {
      console.error('Error fetching open tasks:', err);
      setOpenScopeTasks([]);
    }
  };

  // Encendido: estado «Pendientes» y se traen las tareas abiertas del alcance; la empresa se
  // elige con el filtro Empresa del panel.
  const toggleOpenAll = () => {
    const next = !openAll;
    setOpenAll(next);
    if (next) {
      // Un estado exacto que no sea pendiente (Resuelto, Cancelado) dejaría la lista vacía.
      setFilters((f) => ({
        ...f,
        status: 'pending',
        state: f.state && stateGroup(f.state) === 'pending' ? f.state : '',
      }));
      void fetchOpenScopeTasks();
    }
  };

  const clearListFilters = () => {
    setOpenAll(false);
    setFilters(EMPTY_LIST_FILTERS);
    setSearchInput('');
    setTypeFilter('all');
  };

  // Filtros, pestaña, «Todo lo abierto», búsqueda y página se conservan al volver del detalle.
  // Un ?type= en la URL (p. ej. el menú «Tareas asignadas») manda sobre la pestaña guardada.
  const pendingPageRef = useRef<number | null>(null);
  const { hydrated: listHydrated } = useRequestListPersistence(
    'assigned-requests',
    { filters, search: searchInput, type: typeFilter, openAll, page: safePage },
    (saved) => {
      setFilters(saved.filters);
      setSearchInput(saved.search);
      if (saved.type && !initialType) setTypeFilter(saved.type);
      if (saved.openAll) {
        setOpenAll(true);
        void fetchOpenScopeTasks();
      }
      pendingPageRef.current = saved.page ?? null;
    },
    !loading && userIdInitialized
  );
  // Ya cargada la lista: la página del último elemento abierto (o la que estaba guardada).
  useEffect(() => {
    if (!listHydrated || loading || !userIdInitialized || pendingPageRef.current === null) return;
    const last = loadLastViewed('assigned-requests');
    const page = pageOfItem(visibleNavItems, last, ITEMS_PER_PAGE) ?? pendingPageRef.current;
    pendingPageRef.current = null;
    setCurrentPage(page);
  }, [listHydrated, loading, userIdInitialized, visibleNavItems]);
  const openFromList = (item: AssignedItem, href: string) => {
    sessionStorage.setItem('selectedRequest', JSON.stringify(item.data));
    saveRequestListNav('assigned-requests', visibleNavItems, navItemOf(item));
    window.open(href);
  };
  // Flujo completo (en qué paso va) de las solicitudes de la página, también las de cada tarea.
  const { flows: requestFlows } = useRequestFlows(
    pageItems.map((item) =>
      item.kind === 'task' ? Number((item.data as AssignedTask).id_request_general) : Number((item.data as Ticket).id)
    )
  );

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchCompanies();
    fetchFormData();
  }, [session, status, router]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }

    if (!userIdInitialized) {
      if (userName && !userId) {
        getUserIdByName(userName).then((id) => {
          if (id) {
            setUserId(id);
            setUserIdInitialized(true);
            fetchAssignedWithUserId(id);
          } else {
            setUserIdInitialized(true);
          }
        });
      } else if (!userName) {
        setUserIdInitialized(true);
      }
    }
  }, [status, session, userName, userId, userIdInitialized, router]);

  useEffect(() => {
    const globalStore = localStorage.getItem('global-store');
    if (globalStore) {
      try {
        const parsedStore = JSON.parse(globalStore);
        const idUserValue = parsedStore?.state?.idUser || '';
        setIdUser(idUserValue);
      } catch (error) {
        console.error('Error parsing global-store from localStorage:', error);
        setIdUser('');
      }
    } else {
      setIdUser('');
    }
  }, []);

  useEffect(() => {
    if (formData.category) {
      const filtered = processCategories.filter(
        (p) => p.id_category_request === parseInt(formData.category)
      );
      setFilteredProcesses(filtered);
      if (!filtered.find((p) => p.value === formData.process)) {
        setFormData((prev) => ({ ...prev, process: '' }));
      }
    } else {
      setFilteredProcesses([]);
      setFormData((prev) => ({ ...prev, process: '' }));
    }
  }, [formData.category, processCategories]);

  const fetchTickets = async () => {
    if (!userId) return;
    await fetchAssignedWithUserId(userId);
  };

  /**
   * Trae TODAS las solicitudes y tareas asignadas (todos los estados) de una vez; filtros,
   * buscador y páginas se resuelven aquí. `silent`: refresca sin tapar la pantalla y, si algo
   * falla, deja lo que ya se veía (refresco automático).
   */
  const fetchAssignedWithUserId = async (
    userIdToUse: number,
    { silent = false }: { silent?: boolean } = {}
  ) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      // activities-assigned aún recibe ?idUser= (las dos rutas toman el usuario de la sesión).
      const taskParams = new URLSearchParams({ status: '0', idUser: userIdToUse.toString() });
      const readArray = (res: Response, what: string) => {
        if (!res.ok) throw new Error(`Failed to fetch ${what}`);
        return res.json().then((data: unknown) => (Array.isArray(data) ? data : []));
      };
      const [requestResult, taskResult] = await Promise.allSettled([
        fetch('/api/requests-general/request-assigned?status=0').then((res) =>
          readArray(res, 'assigned tickets')
        ),
        fetch(`/api/requests-general/activities-assigned?${taskParams.toString()}`).then((res) =>
          readArray(res, 'assigned tasks')
        ),
      ]);

      // En silencio, lo que falle no borra lo que ya se veía.
      if (!silent || requestResult.status === 'fulfilled') {
        setTickets(requestResult.status === 'fulfilled' ? (requestResult.value as Ticket[]) : []);
      }
      if (!silent || taskResult.status === 'fulfilled') {
        setAssignedTasks(taskResult.status === 'fulfilled' ? (taskResult.value as AssignedTask[]) : []);
      }

      if (requestResult.status === 'rejected' && taskResult.status === 'rejected') {
        if (!silent) {
          setError('No se pudieron cargar las solicitudes y tareas asignadas. Intenta de nuevo.');
        }
      } else {
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Error fetching assigned tickets:', err);
      if (!silent) {
        setError('No se pudieron cargar las solicitudes y tareas asignadas. Intenta de nuevo.');
      }
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  // Refresco automático cada 30 s (y al volver a la pestaña); filtros y página quedan igual.
  useAutoRefresh(() => {
    if (userId) void fetchAssignedWithUserId(userId, { silent: true });
  });

  // Avance de tareas de las solicitudes que se ven en la página actual.
  const pageRequestIds = pageItems
    .filter((item) => item.kind === 'request')
    .map((item) => (item.data as Ticket).id)
    .join(',');
  useEffect(() => {
    const ids = new Set(pageRequestIds.split(',').filter(Boolean).map(Number));
    void fetchTasksForTickets(tickets.filter((t) => ids.has(t.id)));
    // Solo cuando cambian las solicitudes visibles.
  }, [pageRequestIds]);

  const fetchTasksForTickets = async (ticketsToUse: Ticket[]) => {
    try {
      // Solo las tareas de las solicitudes visibles (antes: la tabla completa de tareas).
      const ids = [...new Set(ticketsToUse.map((t) => t.id))];
      if (ids.length === 0) {
        setTasksByRequest({});
        return;
      }
      const response = await fetch('/api/requests-general/activities-requets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error('Failed to fetch request tasks');

      const data: RequestTask[] = await response.json();
      const ticketIds = new Set(ticketsToUse.map((t) => t.id));
      const grouped: Record<number, RequestTask[]> = {};

      for (const task of data) {
        if (!ticketIds.has(task.id_request_general)) continue;
        (grouped[task.id_request_general] ||= []).push(task);
      }

      setTasksByRequest(grouped);
    } catch (err) {
      console.error('Error fetching request tasks:', err);
    }
  };

  const getUserIdByName = async (userName: string): Promise<number | null> => {
    // La sesión ya trae el id de Kronos (callback jwt, buscado por correo): sin viaje extra al
    // servidor ni búsqueda por NOMBRE, que con dos personas homónimas podía traer el id equivocado.
    // (El id es un cuid de texto; este archivo lo tipa como número, igual que lo que devolvía la API.)
    if (session?.user?.id) return session.user.id as unknown as number;
    if (!session || status !== 'authenticated') {
      console.error('No hay sesión activa para realizar esta operación');
      return null;
    }

    if (!userName || userName.trim() === '') {
      console.error('El nombre de usuario es requerido');
      return null;
    }

    try {
      setLoadingUserId(true);

      const params = new URLSearchParams({
        userName: userName.trim(),
      });

      const response = await fetch(`/api/requests-general/get-user-id?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error al obtener ID de usuario:', errorData.error);
        return null;
      }

      const data = await response.json();
      return data.success ? data.userId : null;
    } catch (error) {
      console.error('Error en la llamada al endpoint:', error);
      return null;
    } finally {
      setLoadingUserId(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      setLoading(true);

      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data = await response.json();
        console.log('Frontend - fetchCompanies received data:', data);

        if (data.companies && Array.isArray(data.companies)) {
          setCompany(
            data.companies.map((sub: { id_company: number; company: string }) => ({
              value: sub.id_company.toString(),
              label: sub.company,
            }))
          );
          console.log(
            'Frontend - fetchCompanies state updated:',
            data.companies.map((sub: { id_company: number; company: string }) => ({
              value: sub.id_company.toString(),
              label: sub.company,
            }))
          );
        } else {
          console.error('Frontend - fetchCompanies: companies data is not an array or missing');
          setCompany([]);
        }
        if (data.processCategoriesNew && Array.isArray(data.processCategoriesNew)) {
          setProcess(
            data.processCategoriesNew.map((sub: { process: string }) => ({
              value: sub.process,
              label: sub.process,
            }))
          );
        } else {
          console.error(
            'Frontend - fetchCompanies: processCategories data is not an array or missing'
          );
          setProcess([]);
        }
      } else {
        console.error('Frontend - fetchCompanies failed with status:', response.status);
      }
    } catch (err) {
      console.error('Error fetching companies:', err);
      setError('Unable to load companies. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchFormData = async () => {
    try {
      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data = await response.json();
        console.log('Frontend - fetchFormData received data:', data);
        setCategories(
          data.categories.map((c: { id: number; category: string }) => ({
            value: c.id.toString(),
            label: c.category,
          }))
        );
        setProcessCategories(
          data.processCategories.map(
            (p: { id_process: number; process: string; id_category_request: number }) => ({
              value: p.id_process.toString(),
              label: p.process,
              id_category_request: p.id_category_request,
            })
          )
        );
        if (data.assignedUsers) {
          setAssignedUsers(
            data.assignedUsers.map((u: { name: string }) => ({ value: u.name, label: u.name }))
          );
        }
      } else {
        console.error('Frontend - fetchFormData failed with status:', response.status);
      }
    } catch (err) {
      console.error('Error fetching form data:', err);
    }
  };


  if (status === 'loading' || loading) {
    return (
      <div
        style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}
        className='flex items-center justify-center'
      >
        <Group gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando...</Text>
        </Group>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'abierto':
        return 'blue';
      case 'cancelado':
        return 'red';
      case 'resuelto':
        return 'green';
      case 'devuelta':
      case 'devuelto':
        return 'orange';
      default:
        return 'gray';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'sin empezar':
        return IconClock;
      case 'abierto':
        return IconProgress;
      case 'cancelado':
        return IconX;
      case 'resuelto':
        return IconCircleCheckFilled;
      default:
        return IconClock;
    }
  };

  const getTaskVisual = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'resuelto':
        return { color: 'green', Icon: IconCircleCheckFilled };
      case 'abierto':
        return { color: 'orange', Icon: IconCircleDot };
      case 'sin empezar':
        return { color: 'gray', Icon: IconCircle };
      default:
        return { color: 'red', Icon: IconCircle };
    }
  };

  const getTasksProgress = (tasks: RequestTask[]) => getSimplifiedTasksProgress(tasks);

  const getGlobalTasksProgress = () => {
    const allTasks = Object.values(tasksByRequest).flat();
    return getTasksProgress(allTasks);
  };

  async function loadTasksByRequest(ids: number[]) {
    const grouped: Record<number, RequestTask[]> = {};
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      if (batch.length === 0) continue;
      const response = await fetch('/api/requests-general/activities-requets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: batch }),
      });
      if (!response.ok) throw new Error('No se pudieron leer las tareas');
      const data = (await response.json()) as RequestTask[];
      for (const task of data) {
        (grouped[task.id_request_general] ||= []).push(task);
      }
    }
    return grouped;
  }

  async function exportToExcel() {
    if (exporting) return;
    // Se exporta exactamente lo que se ve (filtros, estado, tipo y buscador) en TODAS las páginas.
    const allTickets = visibleEntries
      .filter((e) => e.item.kind === 'request')
      .map((e) => e.item.data as Ticket);
    const tasks = visibleEntries
      .filter((e) => e.item.kind === 'task')
      .map((e) => e.item.data as AssignedTask);

    setExporting(true);
    try {
      const { boardExportFilename, buildBoardWorkbook } = await import('@/lib/request-general/exportBoardExcel');
      if (allTickets.length === 0 && tasks.length === 0) {
        toast.error('No hay registros con los filtros actuales');
        return;
      }

      const tasksById = allTickets.length
        ? await loadTasksByRequest(allTickets.map((ticket) => ticket.id))
        : {};

      const requests: BoardRequest[] = allTickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        process: ticket.process,
        category: ticket.category,
        company: ticket.company,
        status: ticket.status,
        requester: ticket.requester,
        assigned: ticket.user,
        createdAt: ticket.created_at,
        description: ticket.description,
        tasks: tasksById[ticket.id] ?? [],
      }));

      const workbook = await buildBoardWorkbook({
        module: 'Solicitudes y Tareas Asignadas',
        filters: [
          {
            label: 'Vista',
            value:
              typeFilter === 'tasks'
                ? 'Solo tareas'
                : typeFilter === 'requests'
                  ? 'Solo solicitudes'
                  : 'Solicitudes y tareas',
          },
          ...describeListFilters(filters, listOptions),
          { label: 'Búsqueda', value: searchInput.trim() || 'Ninguna' },
        ],
        requests,
        assignedTasks: tasks.map((task) => ({
          requestId: task.id_request_general,
          taskId: task.id_task ?? task.id,
          task: task.task,
          subject: task.subject_request,
          process: task.process,
          company: task.company,
          status: task.status_task,
          createdAt: task.created_at,
          requester: task.name_requester,
          assigned: task.assigned,
          description: task.description,
        })),
      });

      // Hoja extra: "Solicitudes de Pago". Trae los campos extra (pivote de
      // request_form_value) para las solicitudes del proceso "Solicitud de Pago"
      // que estén en el panel. El endpoint filtra por proceso, así que basta con
      // mandarle los ids de los tickets cargados.
      try {
        const ids = allTickets.map((t) => t.id).filter((n) => Number.isInteger(n));
        if (ids.length > 0) {
          const payResponse = await fetch('/api/requests-general/payment-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          });

          if (payResponse.ok) {
            const paymentRows: Array<{
              id_solicitud: number;
              asunto?: string | null;
              empresa?: string | null;
              subempresa?: string | null;
              creador_solicitud?: string | null;
              estado?: string | null;
              fecha_creación_solicitud?: string | null;
              tipo_solicitud?: string | null;
              subtipo_solicitud?: string | null;
              valor_pagar?: string | null;
              fecha_solicitada_pago?: string | null;
              acreedor?: string | null;
            }> = await payResponse.json().catch(() => []);

            if (Array.isArray(paymentRows) && paymentRows.length > 0) {
              const splitAcreedor = (value?: string | null) => {
                const r = String(value || '').trim();
                const idx = r.indexOf(' - ');
                if (idx === -1) return { doc: '', name: r };
                return { doc: r.slice(0, idx).trim(), name: r.slice(idx + 3).trim() };
              };
              const formatReqDate = (raw?: string | null) => {
                if (!raw) return '';
                const d = new Date(raw);
                if (isNaN(d.getTime())) return String(raw);
                return new Intl.DateTimeFormat('es-CO', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(d);
              };

              const paySheet = workbook.addWorksheet('Solicitudes de Pago');
              paySheet.columns = [
                { key: 'id', header: 'ID Solicitud', width: 12 },
                { key: 'empresa', header: 'Empresa', width: 24 },
                { key: 'subempresa', header: 'Subempresa', width: 22 },
                { key: 'tipo', header: 'Tipo', width: 22 },
                { key: 'subtipo', header: 'Subtipo', width: 24 },
                { key: 'documento', header: 'Documento', width: 16 },
                { key: 'acreedor', header: 'Acreedor', width: 30 },
                { key: 'valor', header: 'Valor a Pagar', width: 16 },
                { key: 'fecha_solicitada', header: 'Fecha Solicitada de Pago', width: 22 },
                { key: 'fecha_estimada', header: 'Fecha Estimada de Pago', width: 24 },
                { key: 'estado', header: 'Estado', width: 16 },
                { key: 'solicitante', header: 'Solicitante', width: 24 },
                { key: 'asunto', header: 'Asunto', width: 30 },
              ];

              paymentRows.forEach((r) => {
                const a = splitAcreedor(r.acreedor);
                const valor = Number(String(r.valor_pagar ?? '').replace(/[^\d.-]/g, ''));
                paySheet.addRow({
                  id: r.id_solicitud,
                  empresa: r.empresa ?? '',
                  subempresa: r.subempresa ?? '',
                  tipo: r.tipo_solicitud ?? '',
                  subtipo: r.subtipo_solicitud ?? '',
                  documento: a.doc,
                  acreedor: a.name,
                  valor: Number.isFinite(valor) ? valor : '',
                  fecha_solicitada: formatReqDate(r.fecha_solicitada_pago),
                  fecha_estimada: formatEstimatedPaymentDateShort(
                    r.empresa,
                    r.fecha_creación_solicitud
                  ),
                  estado: r.estado ?? '',
                  solicitante: r.creador_solicitud ?? '',
                  asunto: r.asunto ?? '',
                });
              });

              paySheet.getRow(1).font = { bold: true };
              paySheet.getColumn('valor').numFmt = '#,##0';
            }
          } else {
            console.error('No se pudo obtener el reporte de pagos:', payResponse.status);
          }
        }
      } catch (e) {
        console.error('Error generando la hoja de Solicitudes de Pago:', e);
      }

      try {
        const ids = allTickets.map((t) => t.id).filter((n) => Number.isInteger(n));
        if (ids.length > 0) {
          const messagingResponse = await fetch('/api/requests-general/messaging-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          });

          if (messagingResponse.ok) {
            const messagingRows: Array<{
              id: number;
              descripcion?: string | null;
              empresa?: string | null;
              nombre_solicitante?: string | null;
              estado_solicitud?: string | null;
              fecha_creación?: string | null;
              proceso?: string | null;
              destinatario?: string | null;
              destinatario_config?: string | null;
              remitente?: string | null;
              remitente_config?: string | null;
              observacion?: string | null;
            }> = await messagingResponse.json().catch(() => []);

            if (Array.isArray(messagingRows) && messagingRows.length > 0) {
              const formatReqDate = (raw?: string | null) => {
                if (!raw) return '';
                const d = new Date(raw);
                if (isNaN(d.getTime())) return String(raw);
                return new Intl.DateTimeFormat('es-CO', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(d);
              };

              // Destinatario/Remitente son campos de tipo "tabla": su value_text es
              // un JSON { rows: [...] }. Se aplana a texto legible usando las
              // etiquetas de columna (config_json). Si no es JSON de tabla, se
              // devuelve el texto tal cual.
              const formatTableValue = (
                valueText?: string | null,
                configJson?: string | null
              ) => {
                const txt = String(valueText ?? '').trim();
                if (!txt || (txt[0] !== '{' && txt[0] !== '[')) return txt;
                const { rows } = parseTableValue(txt);
                if (rows.length === 0) return txt;
                const labelByKey = new Map(
                  parseTableConfig(configJson).columns.map((c) => [c.key, c.label])
                );
                return rows
                  .map((row) =>
                    Object.entries(row)
                      .filter(
                        ([, v]) => v !== null && v !== undefined && String(v).trim() !== ''
                      )
                      .map(([k, v]) => {
                        const label = labelByKey.get(k);
                        return label ? `${label}: ${String(v)}` : String(v);
                      })
                      .join(' · ')
                  )
                  .filter((line) => line.length > 0)
                  .join('\n');
              };

              const messagingSheet = workbook.addWorksheet('Solicitudes de Mensajería');
              messagingSheet.columns = [
                { key: 'id', header: 'ID Solicitud', width: 12 },
                { key: 'empresa', header: 'Empresa', width: 24 },
                { key: 'descripcion', header: 'Descripción', width: 22 },
                { key: 'nombre_solicitante', header: 'Nombre del Solicitante', width: 22 },
                { key: 'estado_solicitud', header: 'Estado de la Solicitud', width: 24 },
                { key: 'fecha_creación', header: 'Fecha de Creación', width: 16 },
                { key: 'proceso', header: 'Proceso', width: 30 },
                { key: 'destinatario', header: 'Destinatario', width: 30 },
                { key: 'remitente', header: 'Remitente', width: 30 },
                { key: 'observacion', header: 'Observación', width: 30 },
              ];

              messagingRows.forEach((r) => {
                messagingSheet.addRow({
                  id: r.id,
                  empresa: r.empresa ?? '',
                  descripcion: r.descripcion ?? '',
                  nombre_solicitante: r.nombre_solicitante ?? '',
                  estado_solicitud: r.estado_solicitud ?? '',
                  fecha_creación: formatReqDate(r.fecha_creación),
                  proceso: r.proceso ?? '',
                  destinatario: formatTableValue(r.destinatario, r.destinatario_config),
                  remitente: formatTableValue(r.remitente, r.remitente_config),
                  observacion: r.observacion ?? '',
                });
              });

              messagingSheet.getRow(1).font = { bold: true };
              messagingSheet.getColumn('destinatario').alignment = {
                wrapText: true,
                vertical: 'top',
              };
              messagingSheet.getColumn('remitente').alignment = {
                wrapText: true,
                vertical: 'top',
              };
            }
          } else {
            console.error('No se pudo obtener el reporte de mensajería:', messagingResponse.status);
          }
        }
      } catch (e) {
        console.error('Error generando la hoja de Solicitudes de Mensajería:', e);
      }

      await downloadWorkbook(workbook, boardExportFilename('Solicitudes-y-tareas-asignadas'));
      toast.success('Excel descargado');
    } catch (err) {
      console.error(err);
      toast.error('No se pudo generar el informe');
    } finally {
      setExporting(false);
    }
  }

  const formatAssignedDate = (raw: string) => {
    if (!raw) return 'Sin fecha';

    const date = new Date(raw);
    if (isNaN(date.getTime())) return 'Fecha inválida';

    const adjusted = new Date(date.getTime() + 5 * 60 * 60 * 1000);

    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(adjusted);
  };

  // Misma columna que Panel, Visor y Mis solicitudes (Compañía / Categoría); aquí se suma el
  // proceso en la línea gris porque en Asignadas se trabaja por proceso.
  const renderCompanyCell = (company: string, category?: string | null, process?: string | null) => (
    <Stack gap={2}>
      <Group gap={4} wrap='nowrap'>
        <IconBuilding size={14} className='text-gray-400' />
        <Text size='sm' fw={500}>
          {company}
        </Text>
      </Group>
      <Text size='xs' c='dimmed'>
        {[category, process].filter(Boolean).join(' · ')}
      </Text>
    </Stack>
  );

  // Etiqueta pequeña que dice qué es cada fila (va debajo del ID): «Solicitud» azul o «Tarea» morada.
  const renderTypeBadge = (kind: AssignedItem['kind']) =>
    kind === 'request' ? (
      <Badge
        variant='light'
        color='blue'
        size='xs'
        leftSection={<IconTicket size={12} />}
        styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}
      >
        Solicitud
      </Badge>
    ) : (
      <Badge
        variant='light'
        color='violet'
        size='xs'
        leftSection={<IconListCheck size={12} />}
        styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}
      >
        Tarea
      </Badge>
    );

  const renderStatusBadge = (status: string) => {
    const StatusIcon = getStatusIcon(status);
    return (
      <Badge
        color={getStatusColor(status)}
        variant='light'
        size='sm'
        leftSection={<StatusIcon size={12} />}
        styles={{ label: { overflow: 'visible' } }}
      >
        {status}
      </Badge>
    );
  };

  const renderTaskRow = (key: string, task: AssignedTask) => (
    <Table.Tr
      key={key}
      className='cursor-pointer transition-colors'
      onClick={() =>
        openFromList(
          { kind: 'task', key, data: task, createdAt: task.created_at },
          `/process/request-general/view-activities?id=${task.id}&from=assigned-activities`
        )
      }
    >
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        <Stack gap={4} align='flex-start'>
          <Text size='sm' fw={700} c='var(--mantine-color-violet-light-color)'>
            {task.id_request_general}
          </Text>
          {renderTypeBadge('task')}
        </Stack>
      </Table.Td>
      <Table.Td style={{ minWidth: 240, maxWidth: 320 }}>
        <Text size='sm' fw={600} lineClamp={2}>
          {task.task}
        </Text>
        <Text size='xs' c='dimmed' lineClamp={2}>
          {task.subject_request}
        </Text>
        <div style={{ marginTop: 6 }}>
          <RequestFlowBar flow={requestFlows[Number(task.id_request_general)]} />
        </div>
      </Table.Td>
      <Table.Td>{renderCompanyCell(task.company, task.category, task.process)}</Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>{renderStatusBadge(task.status_task)}</Table.Td>
      <Table.Td>
        <Group gap={4} wrap='nowrap' align='flex-start'>
          <IconCalendarEvent size={14} className='text-gray-400' style={{ marginTop: 2 }} />
          <Text size='sm' c='dimmed'>
            {formatAssignedDate(task.created_at)}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        <Stack gap={4}>
          <Group gap={4} wrap='nowrap'>
            <IconUser size={14} className='text-gray-400' />
            <Text size='sm'>{task.name_requester}</Text>
          </Group>
          <Group gap={4} wrap='nowrap'>
            <IconUserCheck size={14} className='text-gray-400' />
            <Text size='sm' c='dimmed'>
              {task.assigned}
            </Text>
          </Group>
        </Stack>
      </Table.Td>
    </Table.Tr>
  );

  const globalProgress = getGlobalTasksProgress();

  return (
    <RequestsPage>
      <RequestsHeader
        crumbs={[
          { title: 'Procesos', href: '/process' },
          { title: 'Solicitudes Generales' },
          { title: 'Solicitudes Asignadas' },
        ]}
        title='Solicitudes y Tareas Asignadas'
        subtitle='Gestión de solicitudes y tareas asignadas a ti'
        actions={
          <>
            <Button
              variant='default'
              radius='xl'
              leftSection={<IconDownload size={16} />}
              loading={exporting}
              onClick={() => exportToExcel()}
            >
              Descargar Excel
            </Button>
            <WorkloadDistribution onReassigned={() => fetchTickets()} />
          </>
        }
      />

      <RequestListFilters
        filters={filters}
        onChange={setFilters}
        onClear={clearListFilters}
        counts={statusCounts}
        showReturned
        hints={statusHints}
        options={listOptions}
        progress={globalProgress}
        progressLabel={`Avance de tareas${totalPages > 1 ? ' (esta página)' : ''}`}
      />

      {error && (
        <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' radius='lg' mt='md'>
          {error}
        </Alert>
      )}

        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Group justify='space-between' align='center' mb='xs' wrap='wrap'>
            <Title order={3} className='flex items-center gap-2'>
              <IconFileDescription size={20} />
              Lista de Solicitudes y Tareas
            </Title>
            <AutoRefreshNote refreshing={refreshing} lastUpdated={lastUpdated} />
          </Group>

          <Group justify='space-between' align='flex-start' mb='md' wrap='wrap' gap='sm'>
            <Box style={{ flex: '1 1 320px', minWidth: 0 }}>
              <IosSearchField
                value={searchInput}
                onChange={setSearchInput}
                placeholder='Buscar ID, asunto, tarea, empresa, proceso, estado o persona'
                ariaLabel='Buscar solicitudes y tareas'
                meta={
                  visibleEntries.length !== allEntries.length
                    ? `${kindCounts.requests} solicitud(es) y ${kindCounts.tasks} tarea(s) coinciden`
                    : 'Busca en todas, no solo en esta página; no importan tildes ni mayúsculas'
                }
              />
            </Box>
            <Button
              variant={openAll ? 'filled' : 'light'}
              size={isMobile ? 'xs' : 'sm'}
              onClick={toggleOpenAll}
              aria-pressed={openAll}
              data-testid='open-all-filter'
            >
              Todo lo abierto
            </Button>
            <SegmentedControl
              fullWidth={isMobile}
              size={isMobile ? 'xs' : 'sm'}
              w={{ base: '100%', sm: 'auto' }}
              value={showTeam ? 'team' : typeFilter}
              onChange={(value) => {
                if (value === 'team') {
                  setShowTeam(true);
                  return;
                }
                setShowTeam(false);
                setTypeFilter(value as TypeFilter);
              }}
              data={[
                { value: 'all', label: `Todos (${kindCounts.all})` },
                { value: 'requests', label: `Solicitudes (${kindCounts.requests})` },
                { value: 'tasks', label: `Tareas (${kindCounts.tasks})` },
                ...(canViewTeam
                  ? [{ value: 'team', label: teamCount == null ? 'Mi equipo' : `Mi equipo (${teamCount})` }]
                  : []),
              ]}
            />
          </Group>

          {showTeam && teamAccess && canViewTeam ? (
            <TeamTasksPanel
              departments={teamAccess.departments}
              renderStatusBadge={renderStatusBadge}
              formatDate={formatAssignedDate}
              onReassigned={() => void fetchTickets()}
              onMembersCount={setTeamCount}
            />
          ) : (
          <>

          {/* Móvil: tarjetas apiladas en lugar de la tabla ancha */}
          <Stack gap='xs' hiddenFrom='md' data-testid='assigned-mobile-list'>
            {pageItems.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py='xl'>
                {typeFilter === 'tasks'
                  ? 'No se encontraron tareas asignadas'
                  : typeFilter === 'requests'
                    ? 'No se encontraron solicitudes asignadas'
                    : 'No se encontraron solicitudes ni tareas asignadas'}
              </Text>
            ) : (
              pageItems.map((item) => {
                const isTask = item.kind === 'task';
                const t = isTask ? (item.data as AssignedTask) : null;
                const r = isTask ? null : (item.data as Ticket);
                const open = () =>
                  openFromList(
                    item,
                    isTask
                      ? `/process/request-general/view-activities?id=${t!.id}&from=assigned-activities`
                      : `/process/request-general/view-request?id=${r!.id}&from=assigned-requests`
                  );
                const flow = requestFlows[isTask ? Number(t!.id_request_general) : Number(r!.id)];
                const progress =
                  !flow && r && tasksByRequest[r.id]?.length ? getTasksProgress(tasksByRequest[r.id]) : null;
                return (
                  <Paper
                    key={item.key}
                    withBorder
                    radius='md'
                    p='sm'
                    role='button'
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') open();
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <Group justify='space-between' wrap='nowrap' gap='xs' mb={4}>
                      <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                        {renderTypeBadge(isTask ? 'task' : 'request')}
                        <Text size='sm' fw={700}>
                          #{isTask ? t!.id_request_general : r!.id}
                        </Text>
                      </Group>
                      {renderStatusBadge(isTask ? t!.status_task : r!.status)}
                    </Group>
                    <Text size='sm' fw={600} lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
                      {isTask ? t!.task : r!.subject}
                    </Text>
                    {isTask && (
                      <Text size='xs' c='dimmed' lineClamp={1}>
                        {t!.subject_request}
                      </Text>
                    )}
                    {flow ? (
                      <div style={{ marginTop: 6 }}>
                        <RequestFlowBar flow={flow} />
                      </div>
                    ) : progress ? (
                      <div style={{ marginTop: 6 }}>
                        <RequestProgressBar {...progress} />
                      </div>
                    ) : null}
                    <Text size='xs' c='dimmed' mt={6} style={{ overflowWrap: 'anywhere' }}>
                      {[isTask ? null : r!.process, isTask ? t!.company : r!.company, formatAssignedDate(isTask ? t!.created_at : r!.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                      {isTask ? t!.name_requester : r!.requester} → {isTask ? t!.assigned : r!.user}
                    </Text>
                  </Paper>
                );
              })
            )}
          </Stack>

          <Box visibleFrom='md' className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Compañía / Categoría</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Solicitante / Asignado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageItems.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconTicket size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          {typeFilter === 'tasks'
                            ? 'No se encontraron tareas asignadas'
                            : typeFilter === 'requests'
                              ? 'No se encontraron solicitudes asignadas'
                              : 'No se encontraron solicitudes ni tareas asignadas'}
                        </Text>
                        <Text size='sm' c='gray.5'>
                          {searchInput.trim()
                            ? `Nada coincide con “${searchInput.trim()}”`
                            : 'No tienes elementos asignados con los filtros actuales'}
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  pageItems.map((item) => {
                    if (item.kind === 'task') return renderTaskRow(item.key, item.data);
                    const ticket = item.data;
                    return (
                    <Table.Tr
                      key={item.key}
                      className='cursor-pointer transition-colors'
                      onClick={() =>
                        openFromList(
                          item,
                          `/process/request-general/view-request?id=${ticket.id}&from=assigned-requests`
                        )
                      }
                    >
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        <Stack gap={4} align='flex-start'>
                          <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                            {ticket.id}
                          </Text>
                          {renderTypeBadge('request')}
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 240, maxWidth: 320 }}>
                        <Text size='sm' fw={500} lineClamp={2}>
                          {ticket.subject}
                        </Text>
                        {requestFlows[ticket.id] ? (
                          <div style={{ marginTop: 8 }}>
                            <RequestFlowBar flow={requestFlows[ticket.id]} />
                          </div>
                        ) : null}
                        {tasksByRequest[ticket.id]?.length ? (
                          <Stack gap={6} mt={8}>
                            {requestFlows[ticket.id] ? null : (
                              <RequestProgressBar {...getTasksProgress(tasksByRequest[ticket.id])} />
                            )}
                            <Group gap={6} wrap='wrap'>
                              {buildTaskDisplayBadges(tasksByRequest[ticket.id]).map((badge) => {
                                const { color, Icon } = getTaskVisual(badge.statusKey);
                                return (
                                  <Tooltip
                                    key={badge.key}
                                    label={`${badge.label} · ${badge.statusLabel}`}
                                    withArrow
                                  >
                                    <Badge
                                      variant='light'
                                      color={color}
                                      size='sm'
                                      radius='sm'
                                      styles={{
                                        root: {
                                          textTransform: 'none',
                                          fontWeight: 500,
                                          cursor: 'default',
                                        },
                                        label: {
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        },
                                      }}
                                      leftSection={<Icon size={13} />}
                                    >
                                      {badge.label}
                                    </Badge>
                                  </Tooltip>
                                );
                              })}
                            </Group>
                          </Stack>
                        ) : null}
                      </Table.Td>
                      <Table.Td>{renderCompanyCell(ticket.company, ticket.category, ticket.process)}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {renderStatusBadge(ticket.status)}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap='nowrap' align='flex-start'>
                          <IconCalendarEvent size={14} className='text-gray-400' style={{ marginTop: 2 }} />
                          <Text size='sm' c='dimmed'>
                            {formatAssignedDate(ticket.created_at)}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <Group gap={4} wrap='nowrap'>
                            <IconUser size={14} className='text-gray-400' />
                            <Text size='sm'>{ticket.requester}</Text>
                          </Group>
                          <Group gap={4} wrap='nowrap'>
                            <IconUserCheck size={14} className='text-gray-400' />
                            <Text size='sm' c='dimmed'>
                              {ticket.user}
                            </Text>
                          </Group>
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </Box>

          {totalPages > 1 && (
            <Group justify='center' mt='md'>
              <Pagination
                total={totalPages}
                value={safePage}
                onChange={setCurrentPage}
                siblings={isMobile ? 0 : 1}
                size={isMobile ? 'sm' : 'md'}
              />
            </Group>
          )}
          </>
          )}
        </Card>
    </RequestsPage>
  );
}

export default function TicketsBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <RequestBoard />
    </Suspense>
  );
}
