'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { saveAs } from 'file-saver';
import {
  Title,
  Stack,
  Alert,
  Table,
  Group,
  Badge,
  Card,
  Text,
  LoadingOverlay,
  Tooltip,
  Box,
  Loader,
  Pagination,
  Button,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconX,
  IconFileDescription,
  IconUser,
  IconClock,
  IconBuilding,
  IconProgress,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCircle,
  IconUserCheck,
  IconDownload,
} from '@tabler/icons-react';
import {
  RequestProgressBar,
  RequestsHeader,
  RequestsPage,
} from '../../../../../components/request-general/list/RequestListUi';
import { RequestListFilters } from '../../../../../components/request-general/list/RequestListFilters';
import AutoRefreshNote from '../../../../../components/ui/AutoRefreshNote';
import IosSearchField from '../../../../../components/ui/IosSearchField';
import { useAutoRefresh } from '../../../../../components/ui/useAutoRefresh';
import {
  EMPTY_LIST_FILTERS,
  type ListFilters,
  type ListOptions,
  type StatusCounts,
} from '../../../../../lib/requests-general/listFilters';
import {
  buildTaskDisplayBadges,
  getSimplifiedTasksProgress,
} from '@/lib/orion/taskProgress';

const ITEMS_PER_PAGE = 100;
const EMPTY_COUNTS: StatusCounts = { all: 0, pending: 0, done: 0, cancelled: 0 };

interface RequestTask {
  id: number;
  id_request_general: number;
  task: string;
  id_status: number;
  status_task: string;
  resolution?: string | null;
}

interface Ticket {
  id: number;
  description: string;
  user: string;
  status: string;
  created_at: string;
  category: string;
  id_company: number;
  requester: string;
  company: string;
  subject: string;
}

interface CompanyData {
  id_company: number;
  company: string;
}

interface ProcessCategoriesNew {
  process: string;
}

interface ConsultResponse {
  companies: CompanyData[];
  assignedUsers: { id: string; name: string }[];
  processCategoriesNew: ProcessCategoriesNew[];
}

/** Lo que se le pide al servidor: los filtros del panel + el texto del buscador. */
type AppliedQuery = { filters: ListFilters; search: string };

function RequestGeneralPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // El servidor identifica a la persona por la sesión; basta con que exista.
  const canLoad = Boolean(session);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tasksByRequest, setTasksByRequest] = useState<Record<number, RequestTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<{ value: string; label: string }[]>([]);
  const [processes, setProcesses] = useState<{ value: string; label: string }[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<{ value: string; label: string }[]>([]);

  // Filtros iguales a los de Mis solicitudes; aquí la lista se pagina en el servidor, así que
  // cada cambio vuelve a consultar desde la página 1 (con espera corta al teclear).
  const [filters, setFilters] = useState<ListFilters>(EMPTY_LIST_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  // Paginación en el servidor: `tickets` es solo la página actual; total y contadores vienen
  // de SQL sobre el conjunto filtrado (antes se descargaba todo el historial al navegador).
  const [totalTickets, setTotalTickets] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>(EMPTY_COUNTS);
  // Consulta con la que se cargó la lista: al cambiar de página o refrescar se reutiliza.
  const appliedRef = useRef<AppliedQuery | null>(null);
  const requestSeqRef = useRef(0);
  const loadedOnceRef = useRef(false);
  const prevQueryRef = useRef<AppliedQuery | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalTickets / ITEMS_PER_PAGE));

  // Opciones de los filtros: salen de los catálogos cargados (la lista llega por páginas).
  const listOptions = useMemo<ListOptions>(
    () => ({ companies, processes, people: assignedUsers }),
    [companies, processes, assignedUsers]
  );

  const clearListFilters = () => {
    setFilters(EMPTY_LIST_FILTERS);
    setSearchInput('');
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    void fetchFormData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, router]);

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

  /** `silent`: refresca la tabla sin tapar la pantalla con el cargador (filtros, búsqueda y refresco automático). */
  const fetchTickets = async (query: AppliedQuery, page = 1, silent = false) => {
    const seq = ++requestSeqRef.current;
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      appliedRef.current = query;
      const { filters: f, search } = query;

      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('pageSize', String(ITEMS_PER_PAGE));
      // El estado viaja como grupo (all | pending | done | cancelled).
      params.append('status', f.status);
      if (f.company) params.append('company', f.company);
      if (f.date_from) params.append('date_from', f.date_from);
      if (f.date_to) params.append('date_to', f.date_to);
      if (f.person) params.append('assigned_to', f.person);
      if (f.process) params.append('process', f.process);
      const idDigits = f.id.replace(/\D/g, '');
      if (idDigits) params.append('id', idDigits);
      if (search) params.append('search', search);

      const response = await fetch(`/api/requests-general/general-requests?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = (await response.json()) as {
        rows: Ticket[];
        total: number;
        counts: Partial<StatusCounts>;
      };
      // Si mientras tanto se pidió otra consulta, esta respuesta ya no vale.
      if (seq !== requestSeqRef.current) return;

      const rows = Array.isArray(data.rows) ? data.rows : [];
      setTickets(rows);
      setTotalTickets(Number(data.total) || 0);
      setStatusCounts({
        all: Number(data.counts?.all) || 0,
        pending: Number(data.counts?.pending) || 0,
        done: Number(data.counts?.done) || 0,
        cancelled: Number(data.counts?.cancelled) || 0,
      });
      setCurrentPage(page);
      setLastUpdated(new Date());
      setError(null);
      void fetchTasksForTickets(rows);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      // En el refresco automático un fallo de red no tapa la tabla; se reintenta en el siguiente.
      if (!silent && seq === requestSeqRef.current) {
        setError('No se pudieron cargar las solicitudes. Inténtalo de nuevo.');
      }
    } finally {
      if (seq === requestSeqRef.current) {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    }
  };

  // Carga inicial y cada cambio de filtros/estado/buscador: vuelve a la página 1. Solo cambiar
  // el estado (tarjetas) consulta al instante; al teclear se espera a que deje de escribir.
  useEffect(() => {
    if (!canLoad) return;
    const query: AppliedQuery = { filters, search: searchInput.trim() };
    const prev = prevQueryRef.current;
    prevQueryRef.current = query;
    const onlyStatusChanged =
      prev !== null &&
      prev.search === query.search &&
      prev.filters.status !== query.filters.status &&
      (Object.keys(query.filters) as Array<keyof ListFilters>).every(
        (k) => k === 'status' || prev.filters[k] === query.filters[k]
      );
    const first = !loadedOnceRef.current;
    const timer = window.setTimeout(
      () => {
        loadedOnceRef.current = true;
        void fetchTickets(query, 1, !first);
      },
      first || onlyStatusChanged ? 0 : 350
    );
    return () => window.clearTimeout(timer);
    // fetchTickets solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, filters, searchInput]);

  // Refresco automático cada 30 s (y al volver a la pestaña): misma página, filtros y búsqueda.
  useAutoRefresh(() => {
    if (canLoad && appliedRef.current) {
      void fetchTickets(appliedRef.current, currentPage, true);
    }
  });

  const fetchFormData = async () => {
    try {
      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data: ConsultResponse = await response.json();
        setCompanies(
          data.companies
            .map((c) => ({ value: c.id_company.toString(), label: c.company }))
            .sort((a, b) => a.label.localeCompare(b.label, 'es'))
        );
        setProcesses(
          [...new Set((data.processCategoriesNew ?? []).map((p) => String(p.process)))]
            .map((p) => ({ value: p, label: p }))
            .sort((a, b) => a.label.localeCompare(b.label, 'es'))
        );
        setAssignedUsers(
          (data.assignedUsers ?? [])
            .map((u) => ({ value: u.name, label: u.name }))
            .sort((a, b) => a.label.localeCompare(b.label, 'es'))
        );
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
        return 'green';
      case 'cancelado':
        return 'gray';
      case 'resuelto':
        return 'blue';
      case 'devuelta':
      case 'devuelto':
        return 'orange';
      default:
        return 'gray';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
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

  const globalProgress = getTasksProgress(Object.values(tasksByRequest).flat());

  /** Exporta la página que se está viendo (la lista completa vive en el servidor). */
  async function exportToExcel() {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Datos');

    type TicketKeys = keyof Ticket;

    const formatDate = (raw: any) => {
      if (!raw) return '';
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      return new Intl.DateTimeFormat('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    };

    const dateKeys: TicketKeys[] = ['created_at'];

    const columnMapOrdered: { key: TicketKeys; header: string; width: number }[] = [
      { key: 'requester', header: 'Solicitante', width: 24 },
      { key: 'user', header: 'Asignado', width: 24 },
      { key: 'company', header: 'Empresa', width: 24 },
      { key: 'category', header: 'Categoría', width: 22 },
      { key: 'subject', header: 'Asunto', width: 30 },
      { key: 'description', header: 'Descripción', width: 40 },
      { key: 'status', header: 'Estado', width: 18 },
      { key: 'created_at', header: 'Fecha de creación', width: 20 },
    ];

    worksheet.columns = columnMapOrdered;

    tickets.forEach((item) => {
      const row: Record<TicketKeys, any> = {} as Record<TicketKeys, any>;

      columnMapOrdered.forEach((col) => {
        const value = item[col.key];
        row[col.key] = dateKeys.includes(col.key) ? formatDate(value) : value;
      });

      worksheet.addRow(row);
    });

    worksheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    saveAs(blob, 'InformeSolicitudes.xlsx');
  }

  return (
    <RequestsPage>
      <RequestsHeader
        crumbs={[
          { title: 'Procesos', href: '/process' },
          { title: 'Solicitudes Generales' },
          { title: 'Panel de Solicitudes' },
        ]}
        title='Solicitudes Generales'
        subtitle='Gestión y seguimiento de solicitudes generales'
        actions={
          <Tooltip label='Exporta las solicitudes de la página que estás viendo' withArrow>
            <Button
              variant='default'
              radius='xl'
              leftSection={<IconDownload size={16} />}
              disabled={tickets.length === 0}
              onClick={() => void exportToExcel()}
            >
              Descargar Excel
            </Button>
          </Tooltip>
        }
      />

      <RequestListFilters
        filters={filters}
        onChange={setFilters}
        onClear={clearListFilters}
        counts={statusCounts}
        options={listOptions}
        progress={globalProgress}
        progressLabel={totalPages > 1 ? 'Avance de tareas (esta página)' : 'Avance de tareas'}
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
            Lista de Solicitudes
          </Title>
          <AutoRefreshNote refreshing={refreshing} lastUpdated={lastUpdated} />
        </Group>

        <Box mb='md'>
          <IosSearchField
            value={searchInput}
            onChange={setSearchInput}
            placeholder='Buscar ID, asunto, empresa, categoría, proceso, estado o persona'
            ariaLabel='Buscar solicitudes'
            meta={
              searchInput.trim()
                ? `Buscando en todas las solicitudes · ${totalTickets} resultado(s)`
                : 'Busca en toda la base, no solo en esta página; no importan tildes ni mayúsculas'
            }
          />
        </Box>

        <div className='overflow-x-auto'>
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
              {tickets.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6} className='text-center py-12 text-gray-500'>
                    <div className='flex flex-col items-center gap-3'>
                      <IconFileDescription size={48} className='text-gray-300' />
                      <Text size='lg' fw={500}>
                        No se encontraron solicitudes
                      </Text>
                      <Text size='sm' c='gray.5'>
                        {searchInput.trim()
                          ? `Ninguna solicitud coincide con “${searchInput.trim()}”`
                          : 'Ninguna solicitud coincide con los filtros'}
                      </Text>
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                tickets.map((ticket) => (
                  <Table.Tr
                    key={ticket.id}
                    className='cursor-pointer transition-colors'
                    onClick={() => {
                      sessionStorage.setItem('selectedRequest', JSON.stringify(ticket));
                      window.open(
                        `/process/request-general/view-request?id=${ticket.id}&from=general-requests`
                      );
                    }}
                  >
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
                          <RequestProgressBar {...getTasksProgress(tasksByRequest[ticket.id])} />
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
                        <Group gap={4} wrap='nowrap'>
                          <IconBuilding size={14} className='text-gray-400' />
                          <Text size='sm' fw={500}>
                            {ticket.company}
                          </Text>
                        </Group>
                        <Text size='xs' c='dimmed'>
                          {ticket.category}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {(() => {
                        const StatusIcon = getStatusIcon(ticket.status);
                        return (
                          <Badge
                            color={getStatusColor(ticket.status)}
                            variant='light'
                            size='sm'
                            leftSection={<StatusIcon size={12} />}
                            styles={{ label: { overflow: 'visible' } }}
                          >
                            {ticket.status}
                          </Badge>
                        );
                      })()}
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm' c='dimmed'>
                        {(() => {
                          const raw = ticket.created_at;
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
                        })()}
                      </Text>
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
                ))
              )}
            </Table.Tbody>
          </Table>
        </div>

        {totalPages > 1 && (
          <Group justify='center' mt='md'>
            <Pagination
              total={totalPages}
              value={currentPage}
              onChange={(page) => {
                if (canLoad && appliedRef.current) {
                  void fetchTickets(appliedRef.current, page, true);
                }
              }}
            />
          </Group>
        )}
      </Card>
    </RequestsPage>
  );
}

export default function RequestsGeneralPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <RequestGeneralPage />
    </Suspense>
  );
}
