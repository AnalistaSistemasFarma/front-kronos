'use client';

import { useState, useEffect, useMemo, useDeferredValue, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
// exportBoardExcel (y con él exceljs, ~900 KB) se carga al tocar Exportar, no al abrir la pantalla.
import { downloadWorkbook } from '@/lib/dashboard/excel/excelHelpers';
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
  Grid,
  Select,
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
import { useRequestListPersistence } from '../../../../../components/request-general/list/useRequestListPersistence';
import {
  loadLastViewed,
  pageOfItem,
  saveRequestListNav,
} from '../../../../../lib/requests-general/requestListNav';
import { filterByText, requestSearchParts } from '../../../../../lib/requests-general/textSearch';
import {
  EMPTY_LIST_FILTERS,
  buildListOptions,
  countByStatusGroup,
  REQUEST_STATE_OPTIONS,
  describeListFilters,
  matchesListFilters,
  splitPeople,
  statusGroupOf,
  type ListFilters,
  type ListRow,
} from '../../../../../lib/requests-general/listFilters';
import {
  buildTaskDisplayBadges,
  getSimplifiedTasksProgress,
} from '@/lib/orion/taskProgress';

const ITEMS_PER_PAGE = 100;

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
  process?: string;
  id_status_case: number;
  date_resolution: string | null;
}

/**
 * La consulta repite la solicitud una vez por cada persona asignada al proceso: se deja una sola
 * fila por solicitud y las personas quedan juntas ("A, B").
 */
function mergeTicketsById(rows: Ticket[]): Ticket[] {
  const byId = new Map<number, Ticket>();
  for (const row of rows) {
    const found = byId.get(row.id);
    if (!found) {
      byId.set(row.id, { ...row });
      continue;
    }
    found.user = splitPeople(found.user, row.user).join(', ');
  }
  return [...byId.values()];
}

function ViewerRequestGeneralPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tasksByRequest, setTasksByRequest] = useState<Record<number, RequestTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Filtros extra de observadores: categoría (en el navegador, dentro de `filters`) y
  // departamento del solicitante (en el servidor: cambia el conjunto que se trae).
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [departmentOptions, setDepartmentOptions] = useState<{ value: string; label: string }[]>(
    []
  );
  const [currentPage, setCurrentPage] = useState(1);

  // Filtros iguales a los de Mis solicitudes: se aplican al instante sobre TODAS las solicitudes
  // cargadas (la lista se pide completa una vez; nada se filtra en el servidor).
  const [filters, setFilters] = useState<ListFilters>(EMPTY_LIST_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput);

  const ticketRows = useMemo(
    () =>
      tickets.map((t) => ({
        ticket: t,
        row: {
          requestId: t.id,
          group: statusGroupOf(t.id_status_case, t.status),
          statusId: t.id_status_case,
          category: t.category,
          companyId: String(t.id_company ?? ''),
          company: t.company,
          process: t.process ?? '',
          people: splitPeople(t.user),
          createdAt: t.created_at,
        } satisfies ListRow,
      })),
    [tickets]
  );
  const categoryOptions = useMemo(
    () =>
      [...new Set(tickets.map((t) => t.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map((c) => ({ value: c, label: c })),
    [tickets]
  );
  // «Estado» exacto y «Categoría» van en el mismo panel (los filtros que había antes del panel).
  const listOptions = useMemo(
    () => ({
      ...buildListOptions(ticketRows.map((x) => x.row)),
      categories: categoryOptions,
      states: REQUEST_STATE_OPTIONS,
    }),
    [ticketRows, categoryOptions]
  );
  // Búsqueda + filtros del panel; el estado se aplica aparte para que las tarjetas no cambien.
  const matchingRows = useMemo(
    () =>
      filterByText(ticketRows, deferredSearch, (x) => requestSearchParts(x.ticket)).filter((x) =>
        matchesListFilters(x.row, filters, { ignoreStatus: true })
      ),
    [ticketRows, deferredSearch, filters]
  );
  const statusCounts = useMemo(() => countByStatusGroup(matchingRows.map((x) => x.row)), [matchingRows]);
  const visibleTickets = useMemo(
    () => matchingRows.filter((x) => matchesListFilters(x.row, filters)).map((x) => x.ticket),
    [matchingRows, filters]
  );

  // Paginación en cliente: al cambiar filtros o búsqueda vuelve a la página 1.
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, deferredSearch, tickets]);

  const totalPages = Math.max(1, Math.ceil(visibleTickets.length / ITEMS_PER_PAGE));
  const pageItems = visibleTickets.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Orden exacto en pantalla para «Anterior / Siguiente» del detalle.
  const visibleNavItems = useMemo(
    () => visibleTickets.map((t) => ({ kind: 'request' as const, id: Number(t.id) })),
    [visibleTickets]
  );
  // Filtros, búsqueda y página se conservan al volver del detalle (breadcrumb o atrás).
  const pendingPageRef = useRef<number | null>(null);
  const { hydrated: listHydrated } = useRequestListPersistence(
    'viewer-request',
    { filters, search: searchInput, page: currentPage },
    (saved) => {
      setFilters(saved.filters);
      setSearchInput(saved.search);
      pendingPageRef.current = saved.page ?? null;
    },
    !loading
  );
  useEffect(() => {
    if (!listHydrated || loading || pendingPageRef.current === null) return;
    const page =
      pageOfItem(visibleNavItems, loadLastViewed('viewer-request'), ITEMS_PER_PAGE) ?? pendingPageRef.current;
    pendingPageRef.current = null;
    setCurrentPage(Math.min(page, totalPages));
  }, [listHydrated, loading, visibleNavItems, totalPages]);

  const clearListFilters = () => {
    setFilters(EMPTY_LIST_FILTERS);
    setSearchInput('');
    if (departmentFilter) {
      setDepartmentFilter('');
      void fetchTickets(false, '');
    }
  };

  const departmentLabel = (id: string) =>
    id ? departmentOptions.find((d) => d.value === id)?.label || id : 'Todos';

  const changeDepartment = (value: string) => {
    setDepartmentFilter(value);
    void fetchTickets(false, value);
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    void fetchTickets();
    void fetchDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, router]);

  const fetchDepartments = async () => {
    try {
      const res = await fetch('/api/help-desk/departments');
      if (!res.ok) return;
      const deps: { id_department: number; department: string }[] = await res.json();
      if (Array.isArray(deps)) {
        setDepartmentOptions(
          deps.map((d) => ({ value: String(d.id_department), label: d.department }))
        );
      }
    } catch (err) {
      console.error('Error fetching departments:', err);
    }
  };

  const fetchTasksForTickets = async (ticketsToUse: Ticket[]) => {
    try {
      // Solo las tareas de las solicitudes listadas, en lotes de 500 ids (límite de la ruta).
      const ticketIds = new Set(ticketsToUse.map((t) => t.id));
      const ids = [...ticketIds];
      const batches: number[][] = [];
      for (let i = 0; i < ids.length; i += 500) batches.push(ids.slice(i, i + 500));
      const responses = await Promise.all(
        batches.map((batch) =>
          fetch('/api/requests-general/activities-requets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: batch }),
          })
        )
      );
      if (responses.some((r) => !r.ok)) throw new Error('Failed to fetch request tasks');

      const data: RequestTask[] = (
        await Promise.all(responses.map((r) => r.json() as Promise<RequestTask[]>))
      ).flat();
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

  /**
   * Trae TODAS las solicitudes que puede observar la persona (status=0: todos los estados); el
   * usuario sale de la sesión en el servidor. `silent`: refresca sin tapar la pantalla.
   * `department`: filtra por departamento del solicitante (por defecto, el elegido en pantalla).
   */
  const fetchTickets = async (silent = false, department = departmentFilter) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const params = new URLSearchParams({ status: '0' });
      if (department) params.append('department', department);
      const response = await fetch(`/api/requests-general/viewer-request?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = (await response.json()) as Ticket[];
      const merged = mergeTicketsById(Array.isArray(data) ? data : []);
      setTickets(merged);
      setLastUpdated(new Date());
      void fetchTasksForTickets(merged);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      // En el refresco automático un fallo de red no tapa la tabla; se reintenta en el siguiente.
      if (!silent) setError('No se pudieron cargar las solicitudes. Inténtalo de nuevo.');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  // Refresco automático cada 30 s (y al volver a la pestaña); los filtros quedan como están.
  useAutoRefresh(() => {
    if (session) void fetchTickets(true);
  });

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

  async function exportToExcel() {
    if (exporting) return;
    // Se exporta exactamente lo que se ve (filtros + buscador), sobre toda la lista.
    if (visibleTickets.length === 0) {
      toast.error('No hay solicitudes con los filtros actuales');
      return;
    }
    setExporting(true);
    try {
      const { boardExportFilename, buildBoardWorkbook } = await import('@/lib/request-general/exportBoardExcel');
      const workbook = await buildBoardWorkbook({
        module: 'Mis solicitudes',
        filters: [
          ...describeListFilters(filters, listOptions),
          { label: 'Departamento del solicitante', value: departmentLabel(departmentFilter) },
          { label: 'Búsqueda', value: searchInput.trim() || 'Ninguna' },
        ],
        requests: visibleTickets.map((ticket) => ({
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
          dateResolution: ticket.date_resolution,
          tasks: tasksByRequest[ticket.id] ?? [],
        })),
      });
      await downloadWorkbook(workbook, boardExportFilename('Mis-solicitudes'));
      toast.success('Excel descargado');
    } catch (err) {
      console.error(err);
      toast.error('No se pudo generar el informe');
    } finally {
      setExporting(false);
    }
  }

  return (
    <RequestsPage>
      <RequestsHeader
        crumbs={[
          { title: 'Procesos', href: '/process' },
          { title: 'Solicitudes Generales' },
          { title: 'Observar Mis Solicitudes' },
        ]}
        title='Observar Mis Solicitudes'
        subtitle='Seguimiento de las solicitudes que puedes observar'
        actions={
          <Button
            variant='default'
            radius='xl'
            leftSection={<IconDownload size={16} />}
            loading={exporting}
            onClick={() => exportToExcel()}
          >
            Descargar Excel
          </Button>
        }
      />

      <RequestListFilters
        filters={filters}
        onChange={setFilters}
        onClear={clearListFilters}
        counts={statusCounts}
        showReturned
        options={listOptions}
        progress={globalProgress}
        extraActiveCount={departmentFilter ? 1 : 0}
        extraFields={
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Select
              label='Departamento del solicitante'
              placeholder='Todos'
              clearable
              searchable
              data={departmentOptions}
              value={departmentFilter || null}
              onChange={(value) => changeDepartment(value || '')}
              leftSection={<IconBuilding size={16} />}
              nothingFoundMessage='Sin coincidencias'
              data-testid='department-filter'
            />
          </Grid.Col>
        }
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
            placeholder='Buscar ID, asunto, empresa, categoría, estado o persona'
            ariaLabel='Buscar solicitudes'
            meta={
              visibleTickets.length !== tickets.length
                ? `${visibleTickets.length} de ${tickets.length} solicitud(es)`
                : 'Busca en todas las solicitudes que observas; no importan tildes ni mayúsculas'
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
              {visibleTickets.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6} className='text-center py-12 text-gray-500'>
                    <div className='flex flex-col items-center gap-3'>
                      <IconFileDescription size={48} className='text-gray-300' />
                      <Text size='lg' fw={500}>
                        No se encontraron solicitudes
                      </Text>
                      <Text size='sm' c='gray.5'>
                        {tickets.length > 0
                          ? 'Ninguna solicitud coincide con los filtros o la búsqueda'
                          : 'Aún no tienes solicitudes para observar'}
                      </Text>
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                pageItems.map((ticket) => (
                  <Table.Tr
                    key={ticket.id}
                    className='cursor-pointer transition-colors'
                    onClick={() => {
                      sessionStorage.setItem('selectedRequest', JSON.stringify(ticket));
                      saveRequestListNav('viewer-request', visibleNavItems, {
                        kind: 'request',
                        id: Number(ticket.id),
                      });
                      window.open(
                        `/process/request-general/view-request?id=${ticket.id}&from=viewer-request`
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
            <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} />
          </Group>
        )}
      </Card>
    </RequestsPage>
  );
}

export default function ViewerRequestsGeneralPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <ViewerRequestGeneralPage />
    </Suspense>
  );
}
