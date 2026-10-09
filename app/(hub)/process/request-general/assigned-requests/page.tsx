'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import axios from 'axios';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
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
  Breadcrumbs,
  Anchor,
  Flex,
  ActionIcon,
  Box,
  Modal,
  Collapse,
  Table,
  Progress,
  Tooltip,
  RingProgress,
  Loader,
  Pagination,
  SegmentedControl,
} from '@mantine/core';
import {
  IconCalendar,
  IconUser,
  IconBuilding,
  IconNote,
  IconChevronRight,
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
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';
import {
  buildTaskDisplayBadges,
  getSimplifiedTasksProgress,
} from '@/lib/orion/taskProgress';
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
  created_at: string;
  id_requester: number;
  name_requester: string;
  status_req: number;
  id_status: number;
  status_task: string;
  assigned: string;
}

type AssignedItem =
  | { kind: 'request'; key: string; data: Ticket; createdAt: string }
  | { kind: 'task'; key: string; data: AssignedTask; createdAt: string };

type TypeFilter = 'all' | 'requests' | 'tasks';

const TASK_ONLY_STATUSES = ['4'];
const REQUEST_ONLY_STATUSES = ['7'];

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
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const initialType = searchParams.get('type');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    initialType === 'tasks' || initialType === 'requests' ? initialType : 'all'
  );
  const [tasksByRequest, setTasksByRequest] = useState<Record<number, RequestTask[]>>({});
  const [loading, setLoading] = useState(true);
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

  const [filters, setFilters] = useState({
    id: '',
    status: '0',
    company: '',
    date_from: '',
    date_to: '',
    assigned_to: '',
    process: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  // Paginación en el servidor: `tickets` es solo la página actual de solicitudes; total y
  // contadores vienen de SQL sobre el conjunto filtrado (antes se descargaba todo al navegador).
  // Las tareas asignadas llegan completas y se paginan en el cliente.
  const [totalTickets, setTotalTickets] = useState(0);
  const [statusCounts, setStatusCounts] = useState({ open: 0, resolved: 0 });
  // Filtros con los que se cargó la lista (para cambiar de página y exportar).
  const appliedFiltersRef = useRef<typeof filters | null>(null);

  const byCreatedAtDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  const requestPageItems: AssignedItem[] = tickets.map((t) => ({
    kind: 'request',
    key: `req-${t.id}`,
    data: t,
    createdAt: t.created_at,
  }));
  const taskItems: AssignedItem[] = assignedTasks
    .map((t): AssignedItem => ({ kind: 'task', key: `task-${t.id}`, data: t, createdAt: t.created_at }))
    .sort(byCreatedAtDesc);
  const taskPageItems = taskItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const requestPages = Math.ceil(totalTickets / ITEMS_PER_PAGE);
  const taskPages = Math.ceil(taskItems.length / ITEMS_PER_PAGE);
  const totalPages = Math.max(
    1,
    typeFilter === 'requests'
      ? requestPages
      : typeFilter === 'tasks'
        ? taskPages
        : Math.max(requestPages, taskPages)
  );

  // En «Todos» cada página junta su página de solicitudes con su tramo de tareas.
  const pageItems: AssignedItem[] =
    typeFilter === 'requests'
      ? requestPageItems
      : typeFilter === 'tasks'
        ? taskPageItems
        : [...requestPageItems, ...taskPageItems].sort(byCreatedAtDesc);
  const totalItemsCount = totalTickets + assignedTasks.length;
  const [filtersExpanded, setFiltersExpanded] = useState(false);

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
            fetchAssignedWithUserId(id, filters);
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
    if (!userId) {
      console.log('fetchTickets: No se puede ejecutar sin userId');
      return;
    }
    await fetchAssignedWithUserId(userId, filters);
  };

  // El usuario lo toma el servidor de la sesión; aquí solo van los filtros.
  const buildTicketParams = (filtersToUse?: typeof filters) => {
    const params = new URLSearchParams();
    if (filtersToUse) {
      if (filtersToUse.id) params.append('id', filtersToUse.id);
      if (filtersToUse.status) params.append('status', filtersToUse.status);
      if (filtersToUse.company) params.append('company', filtersToUse.company);
      if (filtersToUse.date_from) params.append('date_from', filtersToUse.date_from);
      if (filtersToUse.date_to) params.append('date_to', filtersToUse.date_to);
      if (filtersToUse.assigned_to) params.append('assigned_to', filtersToUse.assigned_to);
      if (filtersToUse.process) params.append('process', filtersToUse.process);
    }
    return params;
  };

  type RequestPage = {
    rows: Ticket[];
    total: number;
    counts: { open: number; resolved: number };
  };
  const EMPTY_REQUEST_PAGE: RequestPage = { rows: [], total: 0, counts: { open: 0, resolved: 0 } };

  // Página de solicitudes que hay en `tickets` (0 = ninguna cargada).
  const loadedRequestPageRef = useRef(0);

  const includesRequests = (filtersToUse?: typeof filters) =>
    !TASK_ONLY_STATUSES.includes(filtersToUse?.status || '');

  const fetchRequestPage = async (
    filtersToUse: typeof filters | undefined,
    page: number
  ): Promise<RequestPage> => {
    const params = buildTicketParams(filtersToUse);
    params.append('page', String(page));
    params.append('pageSize', String(ITEMS_PER_PAGE));
    const res = await fetch(`/api/requests-general/request-assigned?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch assigned tickets');
    const data = await res.json();
    return {
      rows: Array.isArray(data.rows) ? data.rows : [],
      total: Number(data.total) || 0,
      counts: {
        open: Number(data.counts?.open) || 0,
        resolved: Number(data.counts?.resolved) || 0,
      },
    };
  };

  const applyRequestPage = (data: RequestPage, page: number) => {
    setTickets(data.rows);
    setTotalTickets(data.total);
    setStatusCounts(data.counts);
    loadedRequestPageRef.current = page;
    fetchTasksForTickets(data.rows);
  };

  const fetchAssignedWithUserId = async (userIdToUse: number, filtersToUse?: typeof filters) => {
    try {
      setLoading(true);
      appliedFiltersRef.current = filtersToUse ?? null;
      setCurrentPage(1);

      const statusValue = filtersToUse?.status || '';
      const includeRequests = includesRequests(filtersToUse);
      const includeTasks = !REQUEST_ONLY_STATUSES.includes(statusValue) && !filtersToUse?.process;

      // activities-assigned aún filtra por ?idUser= (request-assigned usa la sesión).
      const taskParams = buildTicketParams(filtersToUse);
      taskParams.delete('process');
      taskParams.append('idUser', userIdToUse.toString());

      const [requestResult, taskResult] = await Promise.allSettled([
        includeRequests ? fetchRequestPage(filtersToUse, 1) : Promise.resolve(EMPTY_REQUEST_PAGE),
        includeTasks
          ? fetch(`/api/requests-general/activities-assigned?${taskParams.toString()}`).then((res) => {
              if (!res.ok) throw new Error('Failed to fetch assigned tasks');
              return res.json();
            })
          : Promise.resolve([]),
      ]);

      applyRequestPage(
        requestResult.status === 'fulfilled' ? requestResult.value : EMPTY_REQUEST_PAGE,
        1
      );
      setAssignedTasks(
        taskResult.status === 'fulfilled' && Array.isArray(taskResult.value)
          ? taskResult.value
          : []
      );

      if (requestResult.status === 'rejected' && taskResult.status === 'rejected') {
        setError('No se pudieron cargar las solicitudes y tareas asignadas. Intenta de nuevo.');
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching assigned tickets:', err);
      setError('No se pudieron cargar las solicitudes y tareas asignadas. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // Las solicitudes se piden por página al servidor; las tareas ya están en memoria.
  const goToPage = async (page: number, type: TypeFilter = typeFilter) => {
    setCurrentPage(page);
    const applied = appliedFiltersRef.current ?? filters;
    if (type === 'tasks' || !includesRequests(applied)) return;
    if (loadedRequestPageRef.current === page) return;
    try {
      setLoading(true);
      applyRequestPage(await fetchRequestPage(applied, page), page);
    } catch (err) {
      console.error('Error fetching assigned tickets page:', err);
      setError('No se pudieron cargar las solicitudes asignadas. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const changeTypeFilter = (type: TypeFilter) => {
    setTypeFilter(type);
    void goToPage(1, type);
  };

  const fetchTasksForTickets = async (ticketsToUse: Ticket[]) => {
    try {
      // Solo las tareas de las solicitudes visibles (antes: la tabla completa de tareas).
      const ids = [...new Set(ticketsToUse.map((t) => t.id))];
      if (ids.length === 0) {
        setTasksByRequest({});
        return;
      }
      const response = await fetch(
        `/api/requests-general/activities-requets?ids=${ids.join(',')}`
      );
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

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
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

  const pendingTasksCount = assignedTasks.filter((t) =>
    ['sin empezar', 'abierto'].includes(t.status_task?.toLowerCase())
  ).length;
  const completedCount =
    statusCounts.resolved +
    assignedTasks.filter((t) => t.status_task?.toLowerCase() === 'resuelto').length;

  const filterByStatus = (value: string, type: TypeFilter = 'all') => {
    setTypeFilter(type);
    const nf = { ...filters, status: value };
    setFilters(nf);
    if (userId) {
      fetchAssignedWithUserId(userId, nf);
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Solicitudes Generales', href: '#' },
    { title: 'Solicitudes Asignadas', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component='span' c='dimmed'>
        {item.title}
      </Text>
    )
  );

  async function exportToExcel() {
    // La tabla solo tiene la página visible: la exportación pide la lista completa con los
    // mismos filtros (la ruta sin `page` devuelve todo).
    const params = buildTicketParams(appliedFiltersRef.current ?? filters);
    const response = await fetch(`/api/requests-general/request-assigned?${params.toString()}`);
    if (!response.ok) {
      toast.error('No se pudo generar el informe');
      return;
    }
    const allTickets = (await response.json()) as Ticket[];

    // exceljs (pesado) solo se descarga al exportar.
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Datos');

    type TicketKeys = keyof Ticket;

    const columnMapOrdered: { key: TicketKeys; header: string }[] = [
      { key: "requester", header: "nombre_solicitante" },
      { key: "subject", header: "cargo" },
      { key: "description", header: "conocimiento_experiencia_obligatoria" },
      { key: "email", header: "correo_electronico_firmante_1" },
      { key: "phone", header: "numero_celular_firmante_1" },
      { key: "identification", header: "numero_documento_firmante_1" }
    ];
    
    worksheet.columns = columnMapOrdered;

    // Una fila por solicitud (antes se agregaba cada una dos veces).
    allTickets.forEach(item => {
      const row: Record<TicketKeys, any> = {} as Record<TicketKeys, any>;

      columnMapOrdered.forEach(col => {
        row[col.key] = item[col.key];
      });

      worksheet.addRow(row);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    saveAs(blob, 'InformeSolicitudesAsignadas.xlsx');
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

  const renderTypeBadge = (kind: AssignedItem['kind']) =>
    kind === 'request' ? (
      <Badge
        variant='filled'
        color='blue'
        size='sm'
        leftSection={<IconTicket size={12} />}
        styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}
      >
        Solicitud
      </Badge>
    ) : (
      <Badge
        variant='filled'
        color='violet'
        size='sm'
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
      onClick={() => {
        sessionStorage.setItem('selectedRequest', JSON.stringify(task));
        window.open(
          `/process/request-general/view-activities?id=${task.id}&from=assigned-activities`
        );
      }}
    >
      <Table.Td style={{ whiteSpace: 'nowrap' }}>{renderTypeBadge('task')}</Table.Td>
      <Table.Td>
        <Text size='sm' fw={700} c='var(--mantine-color-violet-light-color)'>
          {task.id_request_general}
        </Text>
        <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
          Tarea #{task.id_task ?? task.id}
        </Text>
      </Table.Td>
      <Table.Td style={{ minWidth: 240, maxWidth: 320 }}>
        <Text size='sm' fw={600} lineClamp={2}>
          {task.task}
        </Text>
        <Text size='xs' c='dimmed' lineClamp={2}>
          {task.subject_request}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap='nowrap'>
          <IconBuilding size={13} className='text-gray-400' />
          <Text size='xs' c='dimmed'>
            {task.company}
          </Text>
        </Group>
      </Table.Td>
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold mb-2 flex items-center gap-3'
              >
                <IconTicket size={32} className='text-blue-600' />
                Solicitudes y Tareas Asignadas
              </Title>
              <Text size='lg' c='dimmed'>
                Gestión de solicitudes y tareas asignadas a ti
              </Text>
            </div>
          </Flex>

          <Grid columns={10}>
            <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Mostrar todas las solicitudes y tareas'
                onClick={() => filterByStatus('0')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-blue-light)',
                  borderColor:
                    filters.status === '0' && typeFilter === 'all'
                      ? 'var(--mantine-color-blue-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group wrap='nowrap'>
                  <IconTicket size={24} color='var(--mantine-color-blue-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-blue-light-color)'>
                      Total Asignado
                    </Text>
                    <Text size='lg' fw={600}>
                      {totalItemsCount}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {totalTickets} solicitudes · {assignedTasks.length} tareas
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Filtrar solicitudes pendientes'
                onClick={() => filterByStatus('1', 'requests')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-orange-light)',
                  borderColor:
                    filters.status === '1' && typeFilter === 'requests'
                      ? 'var(--mantine-color-orange-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group wrap='nowrap'>
                  <IconProgress size={24} color='var(--mantine-color-orange-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-orange-light-color)'>
                      Solicitudes Pendientes
                    </Text>
                    <Text size='lg' fw={600}>
                      {statusCounts.open}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Mostrar tareas asignadas'
                onClick={() => filterByStatus('0', 'tasks')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-violet-light)',
                  borderColor:
                    typeFilter === 'tasks'
                      ? 'var(--mantine-color-violet-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group wrap='nowrap'>
                  <IconListCheck size={24} color='var(--mantine-color-violet-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-violet-light-color)'>
                      Tareas Pendientes
                    </Text>
                    <Text size='lg' fw={600}>
                      {pendingTasksCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Filtrar solicitudes y tareas completadas'
                onClick={() => filterByStatus('2')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-green-light)',
                  borderColor:
                    filters.status === '2'
                      ? 'var(--mantine-color-green-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group wrap='nowrap'>
                  <IconCheck size={24} color='var(--mantine-color-green-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-green-light-color)'>
                      Completadas
                    </Text>
                    <Text size='lg' fw={600}>
                      {completedCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
              <Card p='md' radius='md' withBorder>
                {(() => {
                  const { total, done, percent } = getGlobalTasksProgress();
                  return (
                    <Group wrap='nowrap'>
                      <RingProgress
                        size={56}
                        thickness={6}
                        roundCaps
                        sections={[
                          { value: percent, color: percent === 100 ? 'green' : 'blue' },
                        ]}
                        label={
                          <Text size='xs' ta='center' fw={700}>
                            {percent}%
                          </Text>
                        }
                      />
                      <div>
                        <Text size='xs' c='dimmed'>
                          Avance de tareas{totalPages > 1 ? ' (esta página)' : ''}
                        </Text>
                        <Text size='lg' fw={600}>
                          {done}/{total}
                        </Text>
                      </div>
                    </Group>
                  );
                })()}
              </Card>
            </Grid.Col>
            {filters.process == '4' && (
              <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
                <Card p='md' radius='md' withBorder className='bg-green-50 border-green-200'>
                  <Group>
                    <Button
                      onClick={() => exportToExcel()}
                      size='lg'
                      leftSection={<IconDownload size={18} />}
                      className='bg-green-500 hover:bg-green-700'
                    >
                      Descargar XLSX
                    </Button>
                  </Group>
                </Card>
              </Grid.Col>
            )}
          </Grid>
        </Card>

        {error && (
          <Alert
            icon={<IconAlertCircle size={20} />}
            title='Error'
            color='red'
            mb='md'
            className='border-red-200 bg-red-50'
          >
            {error}
          </Alert>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
          <Group justify='space-between' mb='md'>
            <Title order={3} className='flex items-center gap-2'>
              <IconFilter size={20} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon
              variant='subtle'
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='ID Solicitud'
                    type='text'
                    value={filters.id}
                    onChange={(e) => handleFilterChange('id', e.target.value)}
                    leftSection={<IconFilter size={16} />}
                    data-testid='id-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    placeholder='Todos los estados'
                    clearable
                    data={[
                      { value: '0', label: 'Todos' },
                      { value: '4', label: 'Sin Empezar (solo tareas)' },
                      { value: '1', label: 'Abierto' },
                      { value: '3', label: 'Cancelado' },
                      { value: '2', label: 'Resuelto' },
                      { value: '7', label: 'Devuelta (solo solicitudes)' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '')}
                    leftSection={<IconFlag size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Empresa'
                    placeholder='Todas las empresas'
                    clearable
                    data={companies}
                    value={filters.company}
                    onChange={(value) => handleFilterChange('company', value || '')}
                    leftSection={<IconBuilding size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Proceso'
                    placeholder='Todas los procesos'
                    clearable
                    data={processes}
                    value={filters.process}
                    onChange={(value) => handleFilterChange('process', value || '')}
                    leftSection={<IconBuilding size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha Desde'
                    type='date'
                    value={filters.date_from}
                    onChange={(e) => handleFilterChange('date_from', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha Hasta'
                    type='date'
                    value={filters.date_to}
                    onChange={(e) => handleFilterChange('date_to', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                  />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={() => {
                    const clearedFilters = {
                      id: '',
                      status: '0',
                      company: '',
                      date_from: '',
                      date_to: '',
                      assigned_to: '',
                      process: '',
                    };
                    setFilters(clearedFilters);
                    setTypeFilter('all');
                    if (userId) {
                      fetchAssignedWithUserId(userId, clearedFilters);
                    }
                  }}
                  leftSection={<IconX size={16} />}
                >
                  Limpiar Filtros
                </Button>
                <Button onClick={fetchTickets} leftSection={<IconRefresh size={16} />}>
                  Aplicar Filtros
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Group justify='space-between' mb='md' wrap='wrap'>
            <Title order={3} className='flex items-center gap-2'>
              <IconTicket size={20} />
              Lista de Solicitudes y Tareas Asignadas
            </Title>
            <SegmentedControl
              value={typeFilter}
              onChange={(value) => changeTypeFilter(value as TypeFilter)}
              data={[
                { value: 'all', label: `Todos (${totalItemsCount})` },
                { value: 'requests', label: `Solicitudes (${totalTickets})` },
                { value: 'tasks', label: `Tareas (${assignedTasks.length})` },
              ]}
            />
          </Group>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ whiteSpace: 'nowrap', width: 1 }}>Tipo</Table.Th>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Proceso / Empresa</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Solicitante / Asignado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageItems.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={7} className='text-center py-12 text-gray-500'>
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
                          No tienes elementos asignados con los filtros actuales
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
                      onClick={() => {
                        sessionStorage.setItem('selectedRequest', JSON.stringify(ticket));
                        window.open(
                          `/process/request-general/view-request?id=${ticket.id}&from=assigned-requests`
                        );
                      }}
                    >
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{renderTypeBadge('request')}</Table.Td>
                      <Table.Td>
                        <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                          {ticket.id}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 240, maxWidth: 320 }}>
                        <Text size='sm' fw={500} lineClamp={2}>
                          {ticket.subject}
                        </Text>
                        {tasksByRequest[ticket.id]?.length ? (
                          <Stack gap={6} mt={8}>
                            {(() => {
                              const { total, done, percent } = getTasksProgress(
                                tasksByRequest[ticket.id]
                              );
                              return (
                                <Group gap={8} wrap='nowrap'>
                                  <Progress
                                    value={percent}
                                    color={percent === 100 ? 'green' : 'blue'}
                                    size='sm'
                                    radius='xl'
                                    style={{ flex: 1, maxWidth: 120 }}
                                  />
                                  <Text size='xs' c='dimmed' fw={500} style={{ whiteSpace: 'nowrap' }}>
                                    {done}/{total}
                                  </Text>
                                </Group>
                              );
                            })()}
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
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size='sm' fw={500}>
                            {ticket.process}
                          </Text>
                          <Group gap={4} wrap='nowrap'>
                            <IconBuilding size={13} className='text-gray-400' />
                            <Text size='xs' c='dimmed'>
                              {ticket.company}
                            </Text>
                          </Group>
                        </Stack>
                      </Table.Td>
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
          </div>

          {totalPages > 1 && (
            <Group justify='center' mt='md'>
              <Pagination
                total={totalPages}
                value={currentPage}
                onChange={(page) => void goToPage(page)}
              />
            </Group>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function TicketsBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <RequestBoard />
    </Suspense>
  );
}
