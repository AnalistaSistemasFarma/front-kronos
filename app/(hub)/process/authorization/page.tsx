'use client';

import { Suspense, useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Title,
  Text,
  Badge,
  Button,
  Group,
  Card,
  TextInput,
  Textarea,
  Select,
  Grid,
  Alert,
  LoadingOverlay,
  Breadcrumbs,
  Anchor,
  Flex,
  ActionIcon,
  Box,
  Collapse,
  Table,
  Stack,
  Loader,
  Checkbox,
  Modal,
  Tooltip,
  ThemeIcon,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconBuilding,
  IconChevronRight,
  IconAlertCircle,
  IconCheck,
  IconX,
  IconFilter,
  IconRefresh,
  IconCalendarEvent,
  IconUser,
  IconShieldCheck,
  IconClock,
  IconThumbUp,
  IconThumbDown,
  IconFileText,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';

interface AuthorizationRequest {
  id: number; // id_task_request (task_request_general.id) — usado para selección y update-activities
  id_request_general: number;
  subject: string;
  company: string;
  id_company: number;
  type_authorization: string;
  requester: string;
  created_at: string;
  status: 'pendiente' | 'autorizado' | 'rechazado' | 'cancelado';
}

// Forma cruda de cada registro devuelto por /api/authorization/authorization-activities
interface RawActivity {
  id_task_request: number;
  id_request_general: number;
  id_status: number;
  task: string;
  status_task: string;
  assigned_task: string | null;
  type_authorization: string;
  subject_request: string;
  description: string | null;
  id_company: number;
  company: string;
  created_at: string;
  id_creator_request: string;
  creator_request: string | null;
}

// Valores numéricos de id_status que espera la API (status_case)
const STATUS_OPTIONS = [
  { value: '0', label: 'Todos' },
  { value: '4', label: 'Pendiente' },
  { value: '2', label: 'Autorizado' },
  { value: '3', label: 'Rechazado' },
];

const mapStatus = (idStatus: number): AuthorizationRequest['status'] => {
  switch (idStatus) {
    case 2:
      return 'autorizado';
    case 3:
      return 'rechazado';
    case 1:
    case 4:
      return 'pendiente';
    default:
      return 'pendiente';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pendiente':
      return 'yellow';
    case 'autorizado':
      return 'green';
    case 'rechazado':
      return 'red';
    default:
      return 'gray';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pendiente':
      return 'Pendiente';
    case 'autorizado':
      return 'Autorizado';
    case 'rechazado':
      return 'Rechazado';
    case 'cancelado':
      return 'Cancelado';
    default:
      return status;
  }
};

const formatDate = (value: string) => {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

function AuthorizationBoard() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const isMobile = useMediaQuery('(max-width: 768px)');

    // Estado UI
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const userName = session?.user?.name || '';
    const [userIdInitialized, setUserIdInitialized] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    const [requests, setRequests] = useState<AuthorizationRequest[]>([]);
    const [companyOptions, setCompanyOptions] = useState<{ value: string; label: string }[]>([]);

    const [filters, setFilters] = useState({
        id: '',
        status: '0',
        company: '',
        date_from: '',
        date_to: '',
    });
    const [filtersExpanded, setFiltersExpanded] = useState(false);

    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // Modales
    const [rejectModalOpened, setRejectModalOpened] = useState(false);
    const [authorizeModalOpened, setAuthorizeModalOpened] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectReasonError, setRejectReasonError] = useState(false);
    // target: id puntual, o null = acción masiva sobre la selección
    const [actionTarget, setActionTarget] = useState<number | null>(null);

    const [departmentUser, setDepartmentUser] = useState<{
    departments: Array<{
        departments: number;
    }>;
    
    }>({ departments: []});

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
                fetchDepartments(id);
                fetchActivities(id, filters);
              } else {
                setUserIdInitialized(true);
              }
            });
          } else if (!userName) {
            setUserIdInitialized(true);
          }
        }
    }, [status, session, userName, userId, userIdInitialized, router]);

    // ---- Derivados ----
    // El filtrado (id, estado, empresa, fechas) y la validación de departamentos se hacen en el
    // backend (query de authorization-activities); aquí solo mostramos lo recibido.
    const filteredRequests = requests;

    // Solo las pendientes son seleccionables para acciones masivas
    const selectableRequests = useMemo(
        () => filteredRequests.filter((r) => r.status === 'pendiente'),
        [filteredRequests]
    );

    const stats = useMemo(
        () => ({
        total: requests.length,
        pendientes: requests.filter((r) => r.status === 'pendiente').length,
        autorizadas: requests.filter((r) => r.status === 'autorizado').length,
        rechazadas: requests.filter((r) => r.status === 'rechazado').length,
        }),
        [requests]
    );

    const allSelectableSelected =
        selectableRequests.length > 0 && selectableRequests.every((r) => selectedIds.has(r.id));
    const someSelectableSelected = selectableRequests.some((r) => selectedIds.has(r.id));

    const getUserIdByName = async (userName: string): Promise<string | null> => {
        if (!session || status !== 'authenticated') {
            console.error('No hay sesión activa para realizar esta operación');
            return null;
        }

        if (!userName || userName.trim() === '') {
            console.error('El nombre de usuario es requerido');
            return null;
        }

        try {

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
        }
    };

    const fetchActivities = async (id: string, f = filters) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ idUser: id });
            params.set('status', f.status || '0');
            if (f.id) params.set('id', f.id);
            if (f.company) params.set('company', f.company);
            if (f.date_from) params.set('date_from', f.date_from);
            if (f.date_to) params.set('date_to', f.date_to);

            const response = await fetch(
                `/api/authorization/authorization-activities?${params.toString()}`,
                { cache: 'no-store' }
            );

            if (!response.ok) {
                const err = await response.json().catch(() => null);
                throw new Error(err?.error || 'No se pudieron cargar las solicitudes');
            }

            const data: RawActivity[] = await response.json();
            const mapped: AuthorizationRequest[] = data.map((a) => ({
                id: a.id_task_request,
                id_request_general: a.id_request_general,
                subject: a.subject_request,
                company: a.company,
                id_company: a.id_company,
                type_authorization: a.type_authorization,
                requester: a.creator_request || '—',
                created_at: a.created_at,
                status: mapStatus(a.id_status),
            }));

            setRequests(mapped);

            // Poblar opciones de empresa solo cuando no hay filtro de empresa (lista completa).
            if (!f.company) {
                const seen = new Map<number, string>();
                mapped.forEach((m) => {
                    if (m.id_company != null && !seen.has(m.id_company)) {
                        seen.set(m.id_company, m.company);
                    }
                });
                setCompanyOptions(
                    Array.from(seen, ([value, label]) => ({ value: value.toString(), label }))
                );
            }
        } catch (e) {
            console.error('Error fetching authorization activities:', e);
            setError(e instanceof Error ? e.message : 'Error al cargar solicitudes');
            setRequests([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchDepartments = async (userIdParam?: string) => {
        try {
        const idUser = userIdParam || '';
        const url = `/api/authorization/authorization-departments?userId=${idUser}`;

        const response = await fetch(url);
        const data = await response.json();

        setDepartmentUser(data);

        } catch (error) {
        console.error('Error fetching workflow data:', error);
        } 
    };

    // ---- Handlers (stubs) ----
    const handleFilterChange = (field: string, value: string) => {
        setFilters((prev) => ({ ...prev, [field]: value }));
    };

    const applyFilters = () => {
        setSelectedIds(new Set());
        if (userId) fetchActivities(userId, filters);
    };

    const clearFilters = () => {
        const empty = { id: '', status: '0', company: '', date_from: '', date_to: '' };
        setFilters(empty);
        setSelectedIds(new Set());
        if (userId) fetchActivities(userId, empty);
    };

    const toggleSelect = (id: number) => {
        setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds((prev) => {
        if (selectableRequests.length > 0 && selectableRequests.every((r) => prev.has(r.id))) {
            return new Set();
        }
        return new Set(selectableRequests.map((r) => r.id));
        });
    };

    const openAuthorizeModal = (target: number | null) => {
        setActionTarget(target);
        setAuthorizeModalOpened(true);
    };

    const openRejectModal = (target: number | null) => {
        setActionTarget(target);
        setRejectReason('');
        setRejectReasonError(false);
        setRejectModalOpened(true);
    };

    const targetIds = (): number[] =>
        actionTarget !== null ? [actionTarget] : Array.from(selectedIds);

    // Envía una actualización de estado por tarea a update-activities. Devuelve true si OK.
    const updateActivityStatus = async (
        taskId: number,
        idStatus: number,
        resolution: string | null
    ): Promise<boolean> => {
        try {
            const response = await fetch('/api/requests-general/update-activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: taskId,
                    id_status: idStatus,
                    id_assigned: userId,
                    resolution,
                }),
            });
            return response.ok;
        } catch (e) {
            console.error('Error updating activity', taskId, e);
            return false;
        }
    };

    const confirmAuthorize = async () => {
        if (!userId) return;
        const ids = targetIds();
        if (ids.length === 0) return;

        setLoading(true);
        const results = await Promise.all(ids.map((id) => updateActivityStatus(id, 2, null)));
        const ok = results.filter(Boolean).length;
        const fail = results.length - ok;

        setAuthorizeModalOpened(false);
        setSelectedIds(new Set());
        if (ok > 0) {
            toast.success(ok > 1 ? `${ok} solicitudes autorizadas` : 'Solicitud autorizada');
        }
        if (fail > 0) {
            toast.error(`${fail} solicitud(es) no se pudieron autorizar`);
        }
        await fetchActivities(userId, filters);
    };

    const confirmReject = async () => {
        if (!rejectReason.trim()) {
            setRejectReasonError(true);
            return;
        }
        if (!userId) return;
        const ids = targetIds();
        if (ids.length === 0) return;

        setLoading(true);
        const reason = rejectReason.trim();
        const results = await Promise.all(ids.map((id) => updateActivityStatus(id, 3, reason)));
        const ok = results.filter(Boolean).length;
        const fail = results.length - ok;

        setRejectModalOpened(false);
        setSelectedIds(new Set());
        if (ok > 0) {
            toast.success(ok > 1 ? `${ok} solicitudes rechazadas` : 'Solicitud rechazada');
        }
        if (fail > 0) {
            toast.error(`${fail} solicitud(es) no se pudieron rechazar`);
        }
        await fetchActivities(userId, filters);
    };

    const actionCount = actionTarget !== null ? 1 : selectedIds.size;

    const breadcrumbItems = [
        { title: 'Procesos', href: '/process' },
        { title: 'Autorización', href: '#' },
    ].map((item, index) =>
        item.href !== '#' ? (
        <Link key={index} href={item.href} passHref>
            <Anchor component='span'>{item.title}</Anchor>
        </Link>
        ) : (
        <span key={index} className='text-gray-500'>
            {item.title}
        </span>
        )
    );

    if (status === 'loading') {
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

    // ---- Render de una fila (tabla, escritorio) ----
    const renderRow = (req: AuthorizationRequest) => {
        const isPending = req.status === 'pendiente';
        return (
        <Table.Tr
            key={req.id}
            bg={selectedIds.has(req.id) ? 'var(--mantine-color-blue-light)' : undefined}
        >
            <Table.Td>
            <Checkbox
                checked={selectedIds.has(req.id)}
                onChange={() => toggleSelect(req.id)}
                disabled={!isPending}
                aria-label={`Seleccionar solicitud ${req.id_request_general}`}
            />
            </Table.Td>
            <Table.Td>
            <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                #{req.id_request_general}
            </Text>
            </Table.Td>
            <Table.Td style={{ minWidth: 220, maxWidth: 340 }}>
            <Text size='sm' fw={500} lineClamp={2}>
                {req.subject}
            </Text>
            </Table.Td>
            <Table.Td>
            <Group gap={4} wrap='nowrap'>
                <IconBuilding size={14} className='text-gray-400' />
                <Text size='sm' className='truncate'>
                {req.company}
                </Text>
            </Group>
            </Table.Td>
            <Table.Td>
            <Badge variant='light' color='indigo' size='sm'>
                {req.type_authorization}
            </Badge>
            </Table.Td>
            <Table.Td>
            <Group gap={4} wrap='nowrap'>
                <IconUser size={14} className='text-gray-400' />
                <Text size='sm'>{req.requester}</Text>
            </Group>
            </Table.Td>
            <Table.Td>
            <Group gap={4} wrap='nowrap'>
                <IconCalendarEvent size={14} className='text-gray-400' />
                <Text size='sm' c='dimmed'>
                {new Intl.DateTimeFormat('es-CO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  }).format(
                    new Date(
                      new Date(req.created_at).getTime() + 5 * 60 * 60 * 1000 
                    )
                  )}
                </Text>
            </Group>
            </Table.Td>
            <Table.Td style={{ whiteSpace: 'nowrap' }}>
            <Badge variant='light' color={getStatusColor(req.status)} size='sm'>
                {getStatusLabel(req.status)}
            </Badge>
            </Table.Td>
            <Table.Td>
            {isPending ? (
                <Group gap='xs' wrap='nowrap'>
                <Tooltip label='Autorizar'>
                    <ActionIcon
                    variant='light'
                    color='green'
                    onClick={() => openAuthorizeModal(req.id)}
                    aria-label='Autorizar'
                    >
                    <IconThumbUp size={16} />
                    </ActionIcon>
                </Tooltip>
                <Tooltip label='Rechazar'>
                    <ActionIcon
                    variant='light'
                    color='red'
                    onClick={() => openRejectModal(req.id)}
                    aria-label='Rechazar'
                    >
                    <IconThumbDown size={16} />
                    </ActionIcon>
                </Tooltip>
                </Group>
            ) : (
                <Text size='xs' c='dimmed'>
                —
                </Text>
            )}
            </Table.Td>
        </Table.Tr>
        );
    };

    // ---- Render de una tarjeta (móvil) ----
    const renderCard = (req: AuthorizationRequest) => {
        const isPending = req.status === 'pendiente';
        return (
        <Card
            key={req.id}
            withBorder
            radius='md'
            p='md'
            style={{
            backgroundColor: selectedIds.has(req.id) ? 'var(--mantine-color-blue-light)' : undefined,
            }}
        >
            <Stack gap='xs'>
            <Group justify='space-between' wrap='nowrap'>
                <Group gap='xs' wrap='nowrap'>
                <Checkbox
                    checked={selectedIds.has(req.id)}
                    onChange={() => toggleSelect(req.id)}
                    disabled={!isPending}
                    aria-label={`Seleccionar solicitud ${req.id_request_general}`}
                />
                <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                    #{req.id_request_general}
                </Text>
                </Group>
                <Badge variant='light' color={getStatusColor(req.status)} size='sm'>
                {getStatusLabel(req.status)}
                </Badge>
            </Group>

            <Text size='sm' fw={500} lineClamp={2}>
                {req.subject}
            </Text>

            <Group gap={6} wrap='nowrap'>
                <IconBuilding size={14} className='text-gray-400' />
                <Text size='sm'>{req.company}</Text>
                <Badge variant='light' color='indigo' size='xs' ml='auto'>
                {req.type_authorization}
                </Badge>
            </Group>

            <Group gap={6} wrap='nowrap'>
                <IconUser size={14} className='text-gray-400' />
                <Text size='sm'>{req.requester}</Text>
            </Group>

            <Group gap={6} wrap='nowrap'>
                <IconCalendarEvent size={14} className='text-gray-400' />
                <Text size='xs' c='dimmed'>
                {formatDate(req.created_at)}
                </Text>
            </Group>

            {isPending && (
                <Group grow mt='xs'>
                <Button
                    size='xs'
                    color='green'
                    variant='light'
                    leftSection={<IconThumbUp size={14} />}
                    onClick={() => openAuthorizeModal(req.id)}
                >
                    Autorizar
                </Button>
                <Button
                    size='xs'
                    color='red'
                    variant='light'
                    leftSection={<IconThumbDown size={14} />}
                    onClick={() => openRejectModal(req.id)}
                >
                    Rechazar
                </Button>
                </Group>
            )}
            </Stack>
        </Card>
        );
    };

    return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
        <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
            {/* Header */}
            <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
            <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
                {breadcrumbItems}
            </Breadcrumbs>

            <Flex justify='space-between' align='center' mb='4'>
                <div>
                <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3'>
                    <IconShieldCheck size={32} className='text-blue-600' />
                    Autorizaciones
                </Title>
                <Text size='lg' c='dimmed'>
                    Autoriza o rechaza solicitudes de forma individual o masiva
                </Text>
                </div>
            </Flex>

            <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Card
                    p='md'
                    radius='md'
                    withBorder
                    style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}
                >
                    <Group>
                    <IconFileText size={24} color='var(--mantine-color-blue-light-color)' />
                    <div>
                        <Text size='xs' c='var(--mantine-color-blue-light-color)'>
                        Total
                        </Text>
                        <Text size='lg' fw={600}>
                        {stats.total}
                        </Text>
                    </div>
                    </Group>
                </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Card
                    p='md'
                    radius='md'
                    withBorder
                    style={{ backgroundColor: 'var(--mantine-color-yellow-light)' }}
                >
                    <Group>
                    <IconClock size={24} color='var(--mantine-color-yellow-light-color)' />
                    <div>
                        <Text size='xs' c='var(--mantine-color-yellow-light-color)'>
                        Pendientes
                        </Text>
                        <Text size='lg' fw={600}>
                        {stats.pendientes}
                        </Text>
                    </div>
                    </Group>
                </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Card
                    p='md'
                    radius='md'
                    withBorder
                    style={{ backgroundColor: 'var(--mantine-color-green-light)' }}
                >
                    <Group>
                    <IconCheck size={24} color='var(--mantine-color-green-light-color)' />
                    <div>
                        <Text size='xs' c='var(--mantine-color-green-light-color)'>
                        Autorizadas
                        </Text>
                        <Text size='lg' fw={600}>
                        {stats.autorizadas}
                        </Text>
                    </div>
                    </Group>
                </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Card
                    p='md'
                    radius='md'
                    withBorder
                    style={{ backgroundColor: 'var(--mantine-color-red-light)' }}
                >
                    <Group>
                    <IconX size={24} color='var(--mantine-color-red-light-color)' />
                    <div>
                        <Text size='xs' c='var(--mantine-color-red-light-color)'>
                        Rechazadas
                        </Text>
                        <Text size='lg' fw={600}>
                        {stats.rechazadas}
                        </Text>
                    </div>
                    </Group>
                </Card>
                </Grid.Col>
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

            {/* Filtros */}
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
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <Select
                        label='Estado'
                        placeholder='Todos los estados'
                        clearable
                        data={STATUS_OPTIONS}
                        value={filters.status || null}
                        onChange={(value) => handleFilterChange('status', value || '')}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <Select
                        label='Empresa'
                        placeholder='Todas las empresas'
                        clearable
                        searchable
                        data={companyOptions}
                        value={filters.company || null}
                        onChange={(value) => handleFilterChange('company', value || '')}
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
                    <Button variant='outline' leftSection={<IconX size={16} />} onClick={clearFilters}>
                    Limpiar Filtros
                    </Button>
                    <Button leftSection={<IconRefresh size={16} />} onClick={applyFilters}>
                    Aplicar Filtros
                    </Button>
                </Group>
                </Box>
            </Collapse>
            </Card>

            {/* Barra de acciones masivas */}
            {selectedIds.size > 0 && (
            <Card
                shadow='sm'
                p='md'
                radius='md'
                withBorder
                mb='6'
                style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}
            >
                <Flex
                justify='space-between'
                align={{ base: 'stretch', sm: 'center' }}
                direction={{ base: 'column', sm: 'row' }}
                gap='sm'
                >
                <Group gap='xs'>
                    <ThemeIcon variant='light' color='blue' radius='xl'>
                    <IconShieldCheck size={16} />
                    </ThemeIcon>
                    <Text fw={600}>{selectedIds.size} seleccionada(s)</Text>
                </Group>
                <Group grow={isMobile}>
                    <Button
                    color='green'
                    leftSection={<IconCheck size={16} />}
                    onClick={() => openAuthorizeModal(null)}
                    >
                    Autorizar seleccionadas
                    </Button>
                    <Button
                    color='red'
                    leftSection={<IconX size={16} />}
                    onClick={() => openRejectModal(null)}
                    >
                    Rechazar seleccionadas
                    </Button>
                </Group>
                </Flex>
            </Card>
            )}

            {/* Contenido */}
            <Card shadow='sm' radius='md' withBorder className='overflow-hidden' pos='relative'>
            <LoadingOverlay visible={loading} />

            <Group justify='space-between' mb='md'>
                <Title order={3} className='flex items-center gap-2'>
                <IconShieldCheck size={20} />
                Solicitudes por autorizar
                </Title>
                {!isMobile && selectableRequests.length > 0 && (
                <Checkbox
                    label='Seleccionar todo'
                    checked={allSelectableSelected}
                    indeterminate={someSelectableSelected && !allSelectableSelected}
                    onChange={toggleSelectAll}
                />
                )}
            </Group>

            {filteredRequests.length === 0 ? (
                <Stack align='center' gap='xs' py='xl'>
                <IconShieldCheck size={48} className='text-gray-300' />
                <Text size='lg' fw={500}>
                    No se encontraron solicitudes
                </Text>
                <Text size='sm' c='dimmed'>
                    No hay solicitudes que coincidan con los filtros
                </Text>
                </Stack>
            ) : isMobile ? (
                // Vista móvil: tarjetas
                <Stack gap='sm'>
                {selectableRequests.length > 0 && (
                    <Checkbox
                    label='Seleccionar todo'
                    checked={allSelectableSelected}
                    indeterminate={someSelectableSelected && !allSelectableSelected}
                    onChange={toggleSelectAll}
                    />
                )}
                {filteredRequests.map(renderCard)}
                </Stack>
            ) : (
                // Vista escritorio: tabla
                <div className='overflow-x-auto'>
                <Table striped highlightOnHover verticalSpacing='sm'>
                    <Table.Thead>
                    <Table.Tr>
                        <Table.Th w={40}>
                        <Checkbox
                            checked={allSelectableSelected}
                            indeterminate={someSelectableSelected && !allSelectableSelected}
                            onChange={toggleSelectAll}
                            disabled={selectableRequests.length === 0}
                            aria-label='Seleccionar todo'
                        />
                        </Table.Th>
                        <Table.Th>ID</Table.Th>
                        <Table.Th>Asunto</Table.Th>
                        <Table.Th>Empresa</Table.Th>
                        <Table.Th>Tipo de autorización</Table.Th>
                        <Table.Th>Solicitante</Table.Th>
                        <Table.Th>Fecha</Table.Th>
                        <Table.Th>Estado</Table.Th>
                        <Table.Th>Acciones</Table.Th>
                    </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>{filteredRequests.map(renderRow)}</Table.Tbody>
                </Table>
                </div>
            )}
            </Card>
        </div>

        {/* Modal de autorización (confirmación simple) */}
        <Modal
            opened={authorizeModalOpened}
            onClose={() => setAuthorizeModalOpened(false)}
            title='Confirmar autorización'
            centered
        >
            <Stack>
            <Group gap='sm'>
                <ThemeIcon variant='light' color='green' size='lg' radius='xl'>
                <IconThumbUp size={20} />
                </ThemeIcon>
                <Text>
                ¿Deseas autorizar{' '}
                <strong>
                    {actionCount} solicitud{actionCount !== 1 ? 'es' : ''}
                </strong>
                ?
                </Text>
            </Group>
            <Group justify='flex-end'>
                <Button variant='default' onClick={() => setAuthorizeModalOpened(false)}>
                Cancelar
                </Button>
                <Button color='green' leftSection={<IconCheck size={16} />} onClick={confirmAuthorize}>
                Autorizar
                </Button>
            </Group>
            </Stack>
        </Modal>

        {/* Modal de rechazo (con motivo obligatorio) */}
        <Modal
            opened={rejectModalOpened}
            onClose={() => setRejectModalOpened(false)}
            title={`Rechazar ${actionCount} solicitud${actionCount !== 1 ? 'es' : ''}`}
            centered
        >
            <Stack>
            <Text size='sm' c='dimmed'>
                Indica el motivo del rechazo. Esta información será visible para el solicitante.
            </Text>
            <Textarea
                label='Motivo del rechazo'
                placeholder='Escribe el motivo...'
                required
                minRows={3}
                autosize
                value={rejectReason}
                error={rejectReasonError ? 'El motivo es obligatorio' : undefined}
                onChange={(e) => {
                setRejectReason(e.currentTarget.value);
                if (rejectReasonError) setRejectReasonError(false);
                }}
            />
            <Group justify='flex-end'>
                <Button variant='default' onClick={() => setRejectModalOpened(false)}>
                Cancelar
                </Button>
                <Button color='red' leftSection={<IconX size={16} />} onClick={confirmReject}>
                Rechazar
                </Button>
            </Group>
            </Stack>
        </Modal>
        </div>
    );
    }

    export default function AuthorizationPage() {
    return (
        <Suspense
        fallback={
            <div className='min-h-screen flex items-center justify-center'>
            <Loader size='lg' />
            </div>
        }
        >
        <AuthorizationBoard />
        </Suspense>
    );
}
