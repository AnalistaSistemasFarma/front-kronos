'use client';

import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Grid,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconArrowsExchange,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheckFilled,
  IconClock,
  IconFilter,
  IconHierarchy2,
  IconHistory,
  IconLayoutList,
  IconListCheck,
  IconLock,
  IconProgress,
  IconTicket,
  IconUser,
  IconUserCheck,
  IconUserShare,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import {
  FilterPanel,
  RequestsHeader,
  RequestsPage,
  StatFilterTile,
} from '../../../../../components/request-general/list/RequestListUi';
import IosSearchField from '../../../../../components/ui/IosSearchField';
import ReassignmentHistory from '../../../../../components/request-general/ReassignmentHistory';
import { Z_INDEX } from '../../../../../lib/ui/zIndex';
import {
  EMPTY_FILTERS,
  KINDS,
  buildBoardItems,
  buildFilterOptions,
  emptySelection,
  filterBoardItems,
  isSelected,
  selectionPayload,
  setSelected,
  type BoardFilters,
  type BoardItem,
  type Kind,
  type RequestRow,
  type Selection,
  type TaskRow,
  type WorkflowRaw,
} from '../../../../../lib/requests-general/reassignmentBoard';

const ACCESS_URL = '/api/requests-general/reassignment-workflow-request/access';
const CONSULT_URL = '/api/requests-general/reassignment-workflow-request/consult';
const REASSIGN_URL = '/api/requests-general/reassignment-workflow-request/reassign';
const ITEMS_PER_PAGE = 100;

interface Department {
  id_department: number;
  department: string;
}

interface AccessResponse {
  canViewTeam: boolean;
  companies: number[];
  departments: Department[];
}

interface AppUser {
  id: string | number;
  name: string;
}

type TabKey = 'all' | Kind;


const KIND_META: Record<Kind, { one: string; many: string; label: string; color: string; Icon: typeof IconTicket }> = {
  workflows: { one: 'flujo', many: 'flujos', label: 'Flujo', color: 'teal', Icon: IconHierarchy2 },
  requests: { one: 'solicitud', many: 'solicitudes', label: 'Solicitud', color: 'blue', Icon: IconTicket },
  tasks: { one: 'tarea', many: 'tareas', label: 'Tarea', color: 'violet', Icon: IconListCheck },
};

type ReassignMode = 'person' | 'selected';
type ReassignCounts = Record<Kind, number> & { templates?: number };

const templatesLabel = (n: number) => `tareas futuras de ${n} plantilla${n === 1 ? '' : 's'}`;

const describeCounts = (c: ReassignCounts) =>
  [
    ...KINDS.filter((k) => c[k] > 0).map((k) => plural(c[k], k)),
    ...(c.templates ? [templatesLabel(c.templates)] : []),
  ].join(' · ') || 'nada';

const tomorrowIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const plural = (n: number, kind: Kind) => `${n} ${n === 1 ? KIND_META[kind].one : KIND_META[kind].many}`;

const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'abierto':
      return 'blue';
    case 'activo':
    case 'resuelto':
      return 'green';
    case 'cancelado':
      return 'red';
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
    case 'inactivo':
      return IconX;
    case 'resuelto':
    case 'activo':
      return IconCircleCheckFilled;
    default:
      return IconClock;
  }
};

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

const renderTypeBadge = (kind: Kind) => {
  const { label, color, Icon } = KIND_META[kind];
  return (
    <Badge
      variant='light'
      color={color}
      size='xs'
      leftSection={<Icon size={12} />}
      styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}
    >
      {label}
    </Badge>
  );
};

const formatDate = (raw?: string | null) => {
  if (!raw) return 'Sin fecha';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  const adjusted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(adjusted);
};

function SelectAllCheckbox({
  items,
  selection,
  onChange,
  label,
}: {
  items: BoardItem[];
  selection: Selection;
  onChange: (items: BoardItem[], checked: boolean) => void;
  label?: ReactNode;
}) {
  const count = items.filter((item) => isSelected(selection, item)).length;
  return (
    <Checkbox
      aria-label='Seleccionar todo en esta página'
      label={label}
      checked={items.length > 0 && count === items.length}
      indeterminate={count > 0 && count < items.length}
      disabled={items.length === 0}
      onChange={(e) => onChange(items, e.currentTarget.checked)}
    />
  );
}

function EmptyState({ tab, filtered, onClear }: { tab: TabKey; filtered?: boolean; onClear?: () => void }) {
  const Icon = tab === 'all' ? IconLayoutList : KIND_META[tab].Icon;
  if (filtered) {
    return (
      <Stack align='center' gap='xs' py='xl'>
        <Icon size={44} className='text-gray-300' />
        <Text size='md' fw={500} c='dimmed' ta='center'>
          Nada coincide con la búsqueda o los filtros
        </Text>
        {onClear ? (
          <Button variant='light' size='xs' onClick={onClear}>
            Limpiar búsqueda y filtros
          </Button>
        ) : null}
      </Stack>
    );
  }
  const title =
    tab === 'all'
      ? 'No hay flujos, solicitudes ni tareas'
      : tab === 'workflows'
        ? 'No hay flujos de trabajo'
        : tab === 'requests'
          ? 'No hay solicitudes asignadas'
          : 'No hay tareas asignadas';
  return (
    <Stack align='center' gap='xs' py='xl'>
      <Icon size={44} className='text-gray-300' />
      <Text size='md' fw={500} c='dimmed' ta='center'>
        {title}
      </Text>
    </Stack>
  );
}

function ReassignmentBoard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 48em)') ?? false;

  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [workflows, setWorkflows] = useState<WorkflowRaw[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>('all');
  const [pages, setPages] = useState<Record<TabKey, number>>({ all: 1, workflows: 1, requests: 1, tasks: 1 });
  const [selection, setSelection] = useState<Selection>(emptySelection);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [reassignMode, setReassignMode] = useState<ReassignMode>('person');
  const [fromUserId, setFromUserId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ loading: boolean; counts?: ReassignCounts; error?: string } | null>(
    null
  );
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [willReturn, setWillReturn] = useState(false);
  const [dateToReturn, setDateToReturn] = useState('');
  const [view, setView] = useState<'board' | 'history'>('board');
  const [historyKey, setHistoryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const loadBoard = useCallback(async (departmentIds: number[], idAssigned?: string | null) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(CONSULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: departmentIds, ...(idAssigned ? { idAssigned } : {}) }),
      });
      if (!res.ok) throw new Error('consult');
      const data = await res.json();
      if (seq !== loadSeq.current) return;
      setWorkflows(Array.isArray(data?.workflows) ? data.workflows : []);
      setRequests(Array.isArray(data?.requestsAssigned) ? data.requestsAssigned : []);
      setTasks(Array.isArray(data?.taskAssigned) ? data.taskAssigned : []);
      setUsers(Array.isArray(data?.assignedUsers) ? data.assignedUsers : []);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      console.error('Error cargando el tablero de reasignación:', err);
      setError('No se pudo cargar la información del departamento. Intenta de nuevo.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ACCESS_URL);
        if (!res.ok) throw new Error('access');
        const data: AccessResponse = await res.json();
        if (cancelled) return;
        const normalized: AccessResponse = {
          canViewTeam: Boolean(data?.canViewTeam),
          companies: Array.isArray(data?.companies) ? data.companies : [],
          departments: Array.isArray(data?.departments) ? data.departments : [],
        };
        setAccess(normalized);
        if (!normalized.canViewTeam || normalized.departments.length === 0) setLoading(false);
      } catch (err) {
        console.error('Error consultando el acceso:', err);
        if (!cancelled) {
          setAccessError('No se pudo validar tu acceso a este módulo.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, status, router]);

  const departmentIds = useMemo(() => (access?.departments ?? []).map((d) => d.id_department), [access]);
  const canLoad = Boolean(access?.canViewTeam) && departmentIds.length > 0;

  const assignedUserId = filters.person;
  useEffect(() => {
    if (!canLoad) return;
    setSelection(emptySelection());
    void loadBoard(departmentIds, assignedUserId);
  }, [canLoad, departmentIds, assignedUserId, loadBoard]);

  const reload = () => {
    if (canLoad) void loadBoard(departmentIds, assignedUserId);
  };

  const allItems = useMemo(
    () => buildBoardItems({ workflows, requests, tasks }),
    [workflows, requests, tasks]
  );

  const deferredSearch = useDeferredValue(search);
  const itemsByTab = useMemo<Record<TabKey, BoardItem[]>>(() => {
    const visible = filterBoardItems(allItems, deferredSearch, filters);
    return {
      all: visible,
      workflows: visible.filter((i) => i.kind === 'workflows'),
      requests: visible.filter((i) => i.kind === 'requests'),
      tasks: visible.filter((i) => i.kind === 'tasks'),
    };
  }, [allItems, deferredSearch, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const isFiltering = activeFilterCount > 0 || deferredSearch.trim() !== '';
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setSearch('');
  };

  useEffect(() => {
    setPages({ all: 1, workflows: 1, requests: 1, tasks: 1 });
  }, [filters, deferredSearch]);

  const counts: Record<TabKey, number> = {
    all: itemsByTab.all.length,
    workflows: itemsByTab.workflows.length,
    requests: itemsByTab.requests.length,
    tasks: itemsByTab.tasks.length,
  };

  const items = itemsByTab[tab];
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const page = Math.min(pages[tab], totalPages);
  const pageItems = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const filterOptions = useMemo(() => buildFilterOptions(allItems), [allItems]);

  const userOptions = useMemo(
    () => users.filter((u) => u?.name).map((u) => ({ value: String(u.id), label: u.name })),
    [users]
  );

  const toggleItem = (item: BoardItem) =>
    setSelection((prev) => setSelected(prev, [item], !prev[item.kind].has(item.id), allItems));

  const toggleItems = (list: BoardItem[], checked: boolean) =>
    setSelection((prev) => setSelected(prev, list, checked, allItems));

  const clearSelection = () => setSelection(emptySelection());

  const selectedCount: Record<Kind, number> = {
    workflows: selection.workflows.size,
    requests: selection.requests.size,
    tasks: selection.tasks.size,
  };
  const totalSelected = selectedCount.workflows + selectedCount.requests + selectedCount.tasks;
  const selectionSummary = KINDS.filter((k) => selectedCount[k] > 0)
    .map((k) => plural(selectedCount[k], k))
    .join(' · ');
  const allSelected = itemsByTab.all.length > 0 && itemsByTab.all.every((item) => isSelected(selection, item));
  const selectedOf = (tabKey: TabKey) => (tabKey === 'all' ? totalSelected : selectedCount[tabKey]);

  const assignedUserName = userOptions.find((u) => u.value === assignedUserId)?.label ?? null;

  const openModal = (mode: ReassignMode = totalSelected > 0 ? 'selected' : 'person') => {
    setReassignMode(mode);
    setFromUserId(mode === 'person' ? assignedUserId : null);
    setToUserId(null);
    setReason('');
    setWillReturn(false);
    setDateToReturn('');
    setSaveError(null);
    setSummaryOpen(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  useEffect(() => {
    if (!modalOpen || reassignMode !== 'person' || !fromUserId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreview({ loading: true });
    (async () => {
      try {
        const res = await fetch(REASSIGN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'person', dryRun: true, fromUserId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'No se pudo calcular qué se reasignará');
        if (!cancelled) setPreview({ loading: false, counts: data.preview as ReassignCounts });
      } catch (err) {
        if (!cancelled) {
          setPreview({
            loading: false,
            error: err instanceof Error ? err.message : 'No se pudo calcular qué se reasignará',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, reassignMode, fromUserId]);

  const previewTotal = preview?.counts
    ? preview.counts.workflows + preview.counts.tasks + (preview.counts.templates ?? 0)
    : 0;
  const minReturnDate = tomorrowIso();
  const returnDateError =
    willReturn && dateToReturn && dateToReturn < minReturnDate ? 'La fecha de retorno debe ser posterior a hoy' : null;
  const returnOk = !willReturn || (Boolean(dateToReturn) && !returnDateError);
  const canSubmit =
    Boolean(toUserId) &&
    Boolean(reason.trim()) &&
    returnOk &&
    (reassignMode === 'selected'
      ? totalSelected > 0
      : Boolean(fromUserId) && fromUserId !== toUserId && !preview?.loading && previewTotal > 0);

  const submitReassign = async () => {
    if (reassignMode === 'person' && !fromUserId) {
      setSaveError('Selecciona la persona que entrega.');
      return;
    }
    if (!toUserId) {
      setSaveError('Selecciona la persona a la que se reasignará.');
      return;
    }
    if (!reason.trim()) {
      setSaveError('Escribe el motivo de la reasignación.');
      return;
    }
    if (!returnOk) {
      setSaveError(returnDateError ?? 'Indica la fecha de retorno.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const returnFields = { willReturn, dateToReturn: willReturn ? dateToReturn : null };
      const payload =
        reassignMode === 'person'
          ? { mode: 'person', fromUserId, toUserId, reason: reason.trim(), ...returnFields }
          : {
              mode: 'selected',
              ...selectionPayload(selection),
              toUserId,
              reason: reason.trim(),
              ...returnFields,
            };
      const res = await fetch(REASSIGN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo completar la reasignación');

      const target = userOptions.find((u) => u.value === toUserId)?.label ?? 'la persona seleccionada';
      const done = data?.reassigned as ReassignCounts | undefined;
      toast.success(
        done ? `Reasignado a ${target}: ${describeCounts(done)}` : `Reasignado a ${target}`,
        { duration: 6000 }
      );
      setModalOpen(false);
      clearSelection();
      reload();
      setHistoryKey((k) => k + 1);
    } catch (err) {
      console.error('Error reasignando:', err);
      setSaveError(err instanceof Error ? err.message : 'No se pudo completar la reasignación');
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || (access === null && !accessError)) {
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

  if (!session) return null;

  const crumbs = [
    { title: 'Procesos', href: '/process' },
    { title: 'Solicitudes Generales' },
    { title: 'Reasignación de Flujos y Solicitudes' },
  ];
  const title = 'Reasignación de Flujos de Trabajo y Solicitudes';

  if (accessError || !access?.canViewTeam) {
    return (
      <RequestsPage>
        <RequestsHeader crumbs={crumbs} title={title} />
        <Alert
          icon={accessError ? <IconAlertCircle size={20} /> : <IconLock size={20} />}
          title={accessError ? 'Error' : 'Sin acceso'}
          color={accessError ? 'red' : 'yellow'}
          radius='lg'
          mt='md'
        >
          {accessError ?? 'No tienes permiso para ver este módulo. Solicítalo al administrador.'}
        </Alert>
      </RequestsPage>
    );
  }

  const departmentNames = access.departments.map((d) => d.department).filter(Boolean);
  const showType = tab === 'all';
  const showDate = tab !== 'workflows';

  const mobileList = (
    <Stack gap='xs' hiddenFrom='md'>
      {pageItems.length > 0 && (
        <Paper withBorder radius='md' px='sm' py={10}>
          <SelectAllCheckbox
            items={pageItems}
            selection={selection}
            onChange={toggleItems}
            label={<Text size='sm'>Seleccionar todo ({pageItems.length})</Text>}
          />
        </Paper>
      )}
      {pageItems.length === 0 ? (
        <EmptyState tab={tab} filtered={isFiltering} onClear={clearAll} />
      ) : (
        pageItems.map((item) => {
          const checked = isSelected(selection, item);
          return (
            <Paper
              key={`m-${item.key}`}
              withBorder
              radius='md'
              p='sm'
              role='checkbox'
              aria-checked={checked}
              tabIndex={0}
              onClick={() => toggleItem(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleItem(item);
                }
              }}
              style={{
                cursor: 'pointer',
                borderColor: checked ? 'var(--mantine-primary-color-filled)' : undefined,
                backgroundColor: checked ? 'var(--mantine-primary-color-light)' : undefined,
                transition: 'background-color 120ms, border-color 120ms',
              }}
            >
              <Group wrap='nowrap' align='flex-start' gap='sm'>
                <Checkbox checked={checked} readOnly tabIndex={-1} aria-hidden mt={2} size='md' />
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Group justify='space-between' wrap='nowrap' gap='xs' mb={4}>
                    <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                      {renderTypeBadge(item.kind)}
                      <Text size='sm' fw={700}>
                        {item.ref}
                      </Text>
                    </Group>
                    {renderStatusBadge(item.status)}
                  </Group>
                  <Text size='sm' fw={600} lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
                    {item.title}
                  </Text>
                  {item.subtitle ? (
                    <Text size='xs' c='dimmed' lineClamp={1}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                  <Text size='xs' c='dimmed' mt={6} style={{ overflowWrap: 'anywhere' }}>
                    {[item.company, item.detail, item.date ? formatDate(item.date) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Group gap={4} wrap='nowrap' mt={2} align='flex-start'>
                    <IconUserCheck size={13} className='text-gray-400' style={{ marginTop: 2, flexShrink: 0 }} />
                    <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                      {item.requester ? `${item.requester} → ${item.assigned}` : item.assigned}
                    </Text>
                  </Group>
                </Box>
              </Group>
            </Paper>
          );
        })
      )}
    </Stack>
  );

  const colSpan = 6 + (showType ? 1 : 0) + (showDate ? 1 : 0);

  const desktopTable = (
    <Box visibleFrom='md' className='overflow-x-auto'>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}>
              <SelectAllCheckbox items={pageItems} selection={selection} onChange={toggleItems} />
            </Table.Th>
            {showType && <Table.Th>Tipo</Table.Th>}
            <Table.Th>ID</Table.Th>
            <Table.Th>{tab === 'workflows' ? 'Proceso' : tab === 'tasks' ? 'Tarea' : 'Asunto'}</Table.Th>
            <Table.Th>{tab === 'workflows' ? 'Empresa / Departamento' : 'Compañía / Categoría'}</Table.Th>
            <Table.Th>Estado</Table.Th>
            {showDate && <Table.Th>Fecha</Table.Th>}
            <Table.Th>{tab === 'workflows' ? 'Asignado(s)' : 'Solicitante / Asignado'}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {pageItems.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={colSpan}>
                <EmptyState tab={tab} filtered={isFiltering} onClear={clearAll} />
              </Table.Td>
            </Table.Tr>
          ) : (
            pageItems.map((item) => {
              const checked = isSelected(selection, item);
              return (
                <Table.Tr
                  key={item.key}
                  className='cursor-pointer'
                  bg={checked ? 'var(--mantine-primary-color-light)' : undefined}
                  onClick={() => toggleItem(item)}
                >
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Seleccionar ${KIND_META[item.kind].one} ${item.ref}`}
                      checked={checked}
                      onChange={() => toggleItem(item)}
                    />
                  </Table.Td>
                  {showType && <Table.Td>{renderTypeBadge(item.kind)}</Table.Td>}
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text size='sm' fw={700} c={`var(--mantine-color-${KIND_META[item.kind].color}-light-color)`}>
                      {item.ref}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ minWidth: 220, maxWidth: 340 }}>
                    <Text size='sm' fw={600} lineClamp={2}>
                      {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text size='xs' c='dimmed' lineClamp={2}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Group gap={4} wrap='nowrap'>
                        <IconBuilding size={14} className='text-gray-400' />
                        <Text size='sm' fw={500}>
                          {item.company}
                        </Text>
                      </Group>
                      {item.detail ? (
                        <Text size='xs' c='dimmed'>
                          {item.detail}
                        </Text>
                      ) : null}
                    </Stack>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{renderStatusBadge(item.status)}</Table.Td>
                  {showDate && (
                    <Table.Td>
                      {item.date ? (
                        <Group gap={4} wrap='nowrap' align='flex-start'>
                          <IconCalendarEvent size={14} className='text-gray-400' style={{ marginTop: 2 }} />
                          <Text size='sm' c='dimmed'>
                            {formatDate(item.date)}
                          </Text>
                        </Group>
                      ) : (
                        <Text size='sm' c='dimmed'>
                          —
                        </Text>
                      )}
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Stack gap={4}>
                      {item.requester ? (
                        <Group gap={4} wrap='nowrap'>
                          <IconUser size={14} className='text-gray-400' />
                          <Text size='sm'>{item.requester}</Text>
                        </Group>
                      ) : null}
                      <Group gap={4} wrap='nowrap' align='flex-start'>
                        <IconUserCheck size={14} className='text-gray-400' style={{ marginTop: 2 }} />
                        <Text size='sm' c='dimmed'>
                          {item.assigned}
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
  );

  const tabLabel = (label: string, tabKey: TabKey) => (
    <Group gap={6} wrap='nowrap'>
      <span>{label}</span>
      <Badge size='sm' variant='light' color='gray'>
        {counts[tabKey]}
      </Badge>
      {selectedOf(tabKey) > 0 ? (
        <Badge size='sm' variant='filled'>
          {selectedOf(tabKey)} sel.
        </Badge>
      ) : null}
    </Group>
  );

  const mobileTabLabel = (label: string, tabKey: TabKey) => (
    <Stack gap={0} align='center'>
      <Text size='sm' fw={700} lh={1.2}>
        {counts[tabKey]}
      </Text>
      <Text size='10px' lh={1.2}>
        {label}
      </Text>
    </Stack>
  );

  const selectedItems = allItems.filter((i) => isSelected(selection, i));
  const flowSummary = new Map<number, { title: string; requests: number }>();
  for (const i of selectedItems) {
    if (i.kind === 'tasks' || i.flowId == null) continue;
    const entry = flowSummary.get(i.flowId) ?? { title: i.process || `Flujo #${i.flowId}`, requests: 0 };
    if (i.kind === 'workflows') entry.title = i.title;
    else entry.requests += 1;
    flowSummary.set(i.flowId, entry);
  }
  const selectedNames: Record<Kind, string[]> = {
    workflows: [...flowSummary.values()].map(
      (f) => `${f.title} — ${f.requests} solicitud${f.requests === 1 ? '' : 'es'}`
    ),
    requests: selectedItems.filter((i) => i.kind === 'requests').map((i) => `${i.ref} · ${i.title}`),
    tasks: selectedItems.filter((i) => i.kind === 'tasks').map((i) => `${i.ref} · ${i.title}`),
  };

  return (
    <RequestsPage>
      <Box pb={view === 'board' && totalSelected > 0 ? { base: 96, md: 0 } : 0}>
        <RequestsHeader
          crumbs={crumbs}
          title={title}
          subtitle={
            departmentNames.length
              ? `Flujos, solicitudes y tareas del departamento: ${departmentNames.join(', ')}`
              : 'Flujos, solicitudes y tareas de tu departamento'
          }
          actions={
            <Group gap='xs' w={isMobile ? '100%' : undefined} grow={isMobile} wrap={isMobile ? 'wrap' : 'nowrap'}>
              <Button
                radius='xl'
                leftSection={<IconUserShare size={16} />}
                onClick={() => openModal('person')}
              >
                {assignedUserName ? `Reasignar todo de ${assignedUserName}` : 'Reasignar todo de una persona'}
              </Button>
              <Button
                radius='xl'
                variant='light'
                leftSection={<IconArrowsExchange size={16} />}
                disabled={totalSelected === 0}
                onClick={() => openModal('selected')}
              >
                Reasignar seleccionados{totalSelected ? ` (${totalSelected})` : ''}
              </Button>
            </Group>
          }
        />

        <SegmentedControl
          mt='md'
          fullWidth={isMobile}
          value={view}
          onChange={(v) => setView(v as 'board' | 'history')}
          data={[
            {
              value: 'board',
              label: (
                <Group gap={6} wrap='nowrap' justify='center'>
                  <IconLayoutList size={16} />
                  <span>Tablero</span>
                </Group>
              ),
            },
            {
              value: 'history',
              label: (
                <Group gap={6} wrap='nowrap' justify='center'>
                  <IconHistory size={16} />
                  <span>Historial de reasignaciones</span>
                </Group>
              ),
            },
          ]}
        />

        {view === 'history' ? (
          <ReassignmentHistory
            departmentIds={departmentIds}
            refreshKey={historyKey}
            isMobile={isMobile}
            onReverted={reload}
          />
        ) : (
        <>
        <Grid mt='md' gutter='sm' visibleFrom='sm'>
          {(
            [
              ['all', 'Todo', <IconLayoutList key='i' size={20} />, 'idle'],
              ['workflows', 'Flujos de trabajo', <IconHierarchy2 key='i' size={20} />, 'ok'],
              ['requests', 'Solicitudes asignadas', <IconTicket key='i' size={20} />, 'info'],
              ['tasks', 'Tareas asignadas', <IconListCheck key='i' size={20} />, 'violet'],
            ] as const
          ).map(([key, label, icon, tone]) => (
            <Grid.Col key={key} span={{ base: 6, md: 3 }}>
              <StatFilterTile
                icon={icon}
                label={label}
                value={counts[key]}
                tone={tone}
                active={tab === key}
                onClick={() => setTab(key)}
                hint={selectedOf(key) ? `${selectedOf(key)} seleccionados` : undefined}
              />
            </Grid.Col>
          ))}
        </Grid>

        <FilterPanel
          expanded={filtersOpen}
          onToggle={() => setFiltersOpen((v) => !v)}
          icon={
            <Group gap={6} wrap='nowrap' component='span'>
              <IconFilter size={18} />
              {activeFilterCount > 0 ? (
                <Badge size='sm' variant='filled' circle>
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Group>
          }
        >
          <Collapse in={filtersOpen}>
            <Grid gutter='sm' mt='sm'>
              <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                <Select
                  label='Empresa'
                  placeholder='Todas'
                  data={filterOptions.companies}
                  value={filters.company}
                  onChange={(v) => setFilters((f) => ({ ...f, company: v }))}
                  searchable
                  clearable
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                <Select
                  label='Proceso'
                  placeholder='Todos'
                  data={filterOptions.processes}
                  value={filters.process}
                  onChange={(v) => setFilters((f) => ({ ...f, process: v }))}
                  searchable
                  clearable
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                <Select
                  label='Estado'
                  placeholder='Todos'
                  data={filterOptions.statuses}
                  value={filters.status}
                  onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
                  clearable
                />
              </Grid.Col>
            </Grid>
            <Group justify='flex-end' mt='sm'>
              <Button
                variant='subtle'
                size='xs'
                disabled={activeFilterCount === 0}
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                Limpiar filtros
              </Button>
            </Group>
          </Collapse>
        </FilterPanel>

        {error && (
          <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' radius='lg' mt='md'>
            <Group justify='space-between' gap='xs'>
              <span>{error}</span>
              <Button size='xs' variant='light' color='red' onClick={reload}>
                Reintentar
              </Button>
            </Group>
          </Alert>
        )}

        <Card shadow='sm' radius='md' withBorder mt='md' p={{ base: 'sm', sm: 'lg' }}>
          <Group justify='space-between' align='flex-start' mb='md' wrap='wrap' gap='sm'>
            <Title order={3} className='flex items-center gap-2' fz={{ base: 'lg', sm: 'xl' }}>
              <IconArrowsExchange size={20} />
              {assignedUserName ? `Asignado a ${assignedUserName}` : 'Elementos del departamento'}
            </Title>
            <Group gap='sm' align='flex-start' wrap='wrap' style={{ flex: '1 1 520px', minWidth: 0 }} justify='flex-end'>
            <Select
              aria-label='Persona asignada'
              placeholder='Todo el departamento'
              data={userOptions}
              value={assignedUserId}
              onChange={(v) => setFilters((f) => ({ ...f, person: v }))}
              searchable
              clearable
              leftSection={<IconUser size={16} />}
              nothingFoundMessage='No se encontraron personas'
              w={isMobile ? '100%' : 260}
              comboboxProps={{ withinPortal: true }}
            />
            <Box style={{ flex: '1 1 260px', minWidth: 0, maxWidth: isMobile ? undefined : 420 }}>
              <IosSearchField
                value={search}
                onChange={setSearch}
                placeholder='Buscar ID, proceso, asunto, tarea o persona'
                ariaLabel='Buscar flujos, solicitudes y tareas'
                meta={
                  isFiltering
                    ? `${counts.all} de ${allItems.length} coinciden`
                    : 'Busca en todo, no solo en esta página; no importan tildes ni mayúsculas'
                }
              />
            </Box>
            </Group>
          </Group>

          {loading ? (
            <Group justify='center' py='xl' gap='sm'>
              <Loader size='sm' />
              <Text c='dimmed'>Cargando información del departamento...</Text>
            </Group>
          ) : (
            <>
              <Paper
                withBorder
                radius='md'
                p='sm'
                mb='md'
                style={{
                  borderColor: allSelected ? 'var(--mantine-primary-color-filled)' : undefined,
                  backgroundColor: allSelected ? 'var(--mantine-primary-color-light)' : undefined,
                }}
              >
                <Group justify='space-between' align='center' gap='sm' wrap='wrap'>
                  <Checkbox
                    size='md'
                    data-testid='select-everything'
                    checked={allSelected}
                    indeterminate={!allSelected && totalSelected > 0}
                    disabled={itemsByTab.all.length === 0}
                    onChange={(e) => toggleItems(itemsByTab.all, e.currentTarget.checked)}
                    label={
                      <Stack gap={0}>
                        <Text fw={700}>Todo</Text>
                        <Text size='xs' c='dimmed'>
                          {itemsByTab.all.length === 0
                            ? 'No hay nada para seleccionar'
                            : `${describeCounts(counts)}${isFiltering ? ' (con los filtros actuales)' : ''}`}
                        </Text>
                      </Stack>
                    }
                  />
                  {totalSelected > 0 && (
                    <Button
                      leftSection={<IconArrowsExchange size={16} />}
                      fullWidth={isMobile}
                      onClick={() => openModal('selected')}
                    >
                      {allSelected ? `Reasignar todo (${totalSelected})` : `Reasignar seleccionados (${totalSelected})`}
                    </Button>
                  )}
                </Group>
              </Paper>

              <Box hiddenFrom='sm' mb='sm'>
                <SegmentedControl
                  fullWidth
                  size='xs'
                  value={tab}
                  onChange={(v) => setTab(v as TabKey)}
                  data={[
                    { value: 'all', label: mobileTabLabel('Todo', 'all') },
                    { value: 'workflows', label: mobileTabLabel('Flujos', 'workflows') },
                    { value: 'requests', label: mobileTabLabel('Solicitudes', 'requests') },
                    { value: 'tasks', label: mobileTabLabel('Tareas', 'tasks') },
                  ]}
                />
                {totalSelected === 0 && (
                  <Text size='xs' c='dimmed' ta='center' mt={6}>
                    Toca los elementos para seleccionarlos y reasignarlos
                  </Text>
                )}
              </Box>

              <Tabs value={tab} onChange={(v) => v && setTab(v as TabKey)}>
                <Tabs.List mb='md' visibleFrom='sm'>
                  <Tabs.Tab value='all' leftSection={<IconLayoutList size={16} />}>
                    {tabLabel('Todo', 'all')}
                  </Tabs.Tab>
                  <Tabs.Tab value='workflows' leftSection={<IconHierarchy2 size={16} />}>
                    {tabLabel('Flujos', 'workflows')}
                  </Tabs.Tab>
                  <Tabs.Tab value='requests' leftSection={<IconTicket size={16} />}>
                    {tabLabel('Solicitudes', 'requests')}
                  </Tabs.Tab>
                  <Tabs.Tab value='tasks' leftSection={<IconListCheck size={16} />}>
                    {tabLabel('Tareas', 'tasks')}
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs>

              {(tab === 'requests' || tab === 'all') && (
                <Alert icon={<IconAlertCircle size={16} />} color='blue' variant='light' radius='md' p='xs' mb='md'>
                  <Text size='sm'>
                    Las solicitudes se reasignan por flujo: al elegir una se cambia el líder del flujo y se
                    marcan todas sus solicitudes abiertas.
                  </Text>
                </Alert>
              )}

              {mobileList}
              {desktopTable}

              {totalPages > 1 && (
                <Group justify='center' mt='md'>
                  <Pagination
                    total={totalPages}
                    value={page}
                    onChange={(p) => setPages((prev) => ({ ...prev, [tab]: p }))}
                    siblings={isMobile ? 0 : 1}
                    size={isMobile ? 'sm' : 'md'}
                  />
                </Group>
              )}
            </>
          )}
        </Card>
        </>
        )}
      </Box>

      {view === 'board' && totalSelected > 0 && (
        <Paper
          shadow='lg'
          radius={isMobile ? 'lg' : 'xl'}
          withBorder
          px='md'
          py={isMobile ? 'sm' : 'xs'}
          style={
            isMobile
              ? {
                  position: 'fixed',
                  left: 12,
                  right: 12,
                  bottom: 'calc(12px + env(safe-area-inset-bottom))',
                  zIndex: Z_INDEX.pageFloating,
                }
              : { position: 'sticky', bottom: 16, zIndex: 20, marginTop: 16 }
          }
        >
          {isMobile ? (
            <Stack gap={8}>
              <Text size='sm' fw={600} ta='center'>
                {selectionSummary}
              </Text>
              <Group grow gap='xs'>
                <Button variant='default' onClick={clearSelection}>
                  Limpiar
                </Button>
                <Button leftSection={<IconArrowsExchange size={16} />} onClick={() => openModal('selected')}>
                  Reasignar
                </Button>
              </Group>
            </Stack>
          ) : (
            <Group justify='space-between' wrap='wrap' gap='sm'>
              <Text size='sm' fw={600}>
                {selectionSummary} seleccionados
              </Text>
              <Group gap='xs'>
                <Button variant='subtle' size='xs' color='gray' onClick={clearSelection}>
                  Limpiar
                </Button>
                <Button size='xs' leftSection={<IconArrowsExchange size={14} />} onClick={() => openModal('selected')}>
                  Reasignar
                </Button>
              </Group>
            </Group>
          )}
        </Paper>
      )}

      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={
          <Group gap='sm' wrap='nowrap'>
            <IconArrowsExchange size={20} />
            <Text fw={600}>
              {isMobile
                ? 'Reasignar'
                : reassignMode === 'person'
                  ? 'Reasignar todo de una persona'
                  : 'Reasignar seleccionados'}
            </Text>
          </Group>
        }
        radius={isMobile ? 0 : 'lg'}
        size='lg'
        centered
        fullScreen={isMobile}
        overlayProps={{ blur: 4 }}
      >
        <Stack gap='md'>
          <SegmentedControl
            fullWidth
            value={reassignMode}
            onChange={(v) => {
              setReassignMode(v as ReassignMode);
              setSaveError(null);
            }}
            data={[
              { value: 'person', label: 'Todo de una persona' },
              {
                value: 'selected',
                label: `Seleccionados (${totalSelected})`,
                disabled: totalSelected === 0,
              },
            ]}
          />

          {reassignMode === 'person' && (
            <>
              <Text size='sm' c='dimmed'>
                Pasa de una vez <b>todo</b> lo que tiene una persona a otra: los flujos donde es líder (con sus
                solicitudes) y sus tareas abiertas. No depende de filtros ni de lo seleccionado en el tablero.
              </Text>

              <Select
                label='De (persona que entrega)'
                placeholder='Selecciona la persona'
                searchable
                required
                data={userOptions}
                value={fromUserId}
                onChange={(v) => {
                  setFromUserId(v);
                  if (v && v === toUserId) setToUserId(null);
                }}
                leftSection={<IconUser size={16} />}
                nothingFoundMessage='No se encontraron personas'
                comboboxProps={{ withinPortal: true }}
              />

              {fromUserId && (
                <Paper withBorder radius='md' p='sm'>
                  {preview?.loading ? (
                    <Group gap='xs'>
                      <Loader size='xs' />
                      <Text size='sm' c='dimmed'>
                        Calculando qué se reasignará...
                      </Text>
                    </Group>
                  ) : preview?.error ? (
                    <Text size='sm' c='red'>
                      {preview.error}
                    </Text>
                  ) : preview?.counts ? (
                    <Stack gap={6}>
                      <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                        Se reasignará
                      </Text>
                      <Group gap='xs'>
                        {KINDS.map((k) => {
                          const { color, Icon } = KIND_META[k];
                          return (
                            <Badge
                              key={k}
                              size='lg'
                              variant='light'
                              color={preview.counts![k] > 0 ? color : 'gray'}
                              leftSection={<Icon size={14} />}
                              styles={{ root: { textTransform: 'none' } }}
                            >
                              {plural(preview.counts![k], k)}
                            </Badge>
                          );
                        })}
                        {(preview.counts.templates ?? 0) > 0 && (
                          <Badge size='lg' variant='light' color='blue' styles={{ root: { textTransform: 'none' } }}>
                            {templatesLabel(preview.counts.templates ?? 0)}
                          </Badge>
                        )}
                      </Group>
                      {previewTotal === 0 ? (
                        <Text size='xs' c='dimmed'>
                          Esta persona no tiene flujos, tareas abiertas ni tareas futuras para reasignar.
                        </Text>
                      ) : (
                        <Text size='xs' c='dimmed'>
                          Las solicitudes son las abiertas de los flujos que lidera: pasan con el flujo. Los demás
                          líderes de esos flujos se conservan. La plantilla no cambia: mientras la reasignación siga
                          activa, las tareas nuevas que le tocarían a esta persona llegan a quien recibe.
                        </Text>
                      )}
                    </Stack>
                  ) : null}
                </Paper>
              )}
            </>
          )}

          {reassignMode === 'selected' && (
          <>
          <Paper withBorder radius='md' p='sm'>
            <UnstyledButton onClick={() => setSummaryOpen((v) => !v)} w='100%'>
              <Group justify='space-between' wrap='nowrap' align='flex-start'>
                <Group gap='xs'>
                  {KINDS.filter((k) => selectedCount[k] > 0).map((k) => {
                    const { color, Icon } = KIND_META[k];
                    return (
                      <Badge key={k} variant='light' color={color} leftSection={<Icon size={12} />}>
                        {plural(selectedCount[k], k)}
                      </Badge>
                    );
                  })}
                </Group>
                <Group gap={4} wrap='nowrap'>
                  <Text size='xs' c='dimmed'>
                    {summaryOpen ? 'Ocultar' : 'Ver detalle'}
                  </Text>
                  {summaryOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </Group>
              </Group>
            </UnstyledButton>
            <Collapse in={summaryOpen}>
              <Stack gap='xs' mt='sm' mah={isMobile ? 260 : 220} style={{ overflowY: 'auto' }}>
                {KINDS.filter((k) => selectedNames[k].length > 0).map((k) => (
                  <Box key={k}>
                    <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                      {KIND_META[k].many}
                    </Text>
                    {selectedNames[k].map((name, i) => (
                      <Text key={`${k}-${i}`} size='sm' lineClamp={1}>
                        {name}
                      </Text>
                    ))}
                  </Box>
                ))}
              </Stack>
            </Collapse>
          </Paper>

          {(selectedCount.workflows > 0 || selectedCount.requests > 0) && (
            <Alert icon={<IconAlertCircle size={16} />} color='yellow' radius='md' p='xs'>
              <Text size='xs'>
                En flujos y solicitudes se cambia el <b>líder del proceso</b>: la nueva persona queda como
                única asignada del flujo y eso aplica a <b>todas sus solicitudes abiertas</b>.
                {selectedCount.tasks > 0 ? ' Las tareas seleccionadas pasan solo esas a la nueva persona.' : ''}
              </Text>
            </Alert>
          )}
          <Text size='xs' c='dimmed'>
            Tareas futuras: mientras la reasignación siga activa, las tareas nuevas de esos flujos (y de las
            tareas elegidas) que le tocarían a la persona anterior llegan a quien recibe. La plantilla no cambia.
          </Text>
          </>
          )}

          <Select
            label={reassignMode === 'person' ? 'A (persona que recibe)' : 'Reasignar a'}
            placeholder='Selecciona la persona'
            searchable
            required
            data={
              reassignMode === 'person' && fromUserId
                ? userOptions.map((u) => (u.value === fromUserId ? { ...u, disabled: true } : u))
                : userOptions
            }
            value={toUserId}
            onChange={setToUserId}
            leftSection={<IconUsers size={16} />}
            nothingFoundMessage='No se encontraron personas'
            comboboxProps={{ withinPortal: true }}
          />

          <Textarea
            label='Motivo o concepto'
            description='Explica por qué se hace la reasignación'
            placeholder='Ej. Redistribución de carga por vacaciones'
            required
            autosize
            minRows={3}
            maxRows={8}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Text size='xs' c='dimmed' ta='right' mt={-10}>
            {reason.length}/500
          </Text>

          <Paper withBorder radius='md' p='sm'>
            <Switch
              checked={willReturn}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setWillReturn(checked);
                if (!checked) setDateToReturn('');
              }}
              label='Reasignación temporal (se retornará)'
              description='Actívalo si lo reasignado debe volver a la persona original en una fecha'
            />
            <Collapse in={willReturn}>
              <TextInput
                mt='sm'
                type='date'
                label='Fecha de retorno'
                required={willReturn}
                min={minReturnDate}
                value={dateToReturn}
                onChange={(e) => setDateToReturn(e.currentTarget.value)}
                leftSection={<IconCalendarEvent size={16} />}
                error={returnDateError}
              />
            </Collapse>
          </Paper>

          <Text size='xs' c='dimmed'>
            Quedará registro en el historial con el motivo y el detalle de los flujos, solicitudes y tareas
            reasignados.
          </Text>

          {saveError && (
            <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md'>
              {saveError}
            </Alert>
          )}

          <Group justify='flex-end' gap='sm' grow={isMobile}>
            <Button variant='outline' onClick={closeModal} disabled={saving}>
              Cancelar
            </Button>
            <Button
              leftSection={<IconCheck size={16} />}
              onClick={() => void submitReassign()}
              loading={saving}
              disabled={!canSubmit}
            >
              {reassignMode === 'person' ? 'Reasignar todo' : 'Reasignar'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </RequestsPage>
  );
}

export default function ReassignmentWorkflowRequestPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <ReassignmentBoard />
    </Suspense>
  );
}
