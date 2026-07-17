'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Title,
  Paper,
  Stack,
  Alert,
  Breadcrumbs,
  Anchor,
  Table,
  TextInput,
  Select,
  Button,
  Group,
  Badge,
  Modal,
  Textarea,
  Grid,
  Card,
  Text,
  Divider,
  LoadingOverlay,
  ActionIcon,
  Tooltip,
  Collapse,
  Box,
  Flex,
  Progress,
  RingProgress,
  Loader,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconFilter,
  IconX,
  IconCheck,
  IconRefresh,
  IconFileDescription,
  IconCalendarEvent,
  IconUser,
  IconFlag,
  IconClock,
  IconBuilding,
  IconProgress,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCircle,
  IconUserCheck,
  IconTag,
} from '@tabler/icons-react';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';

interface RequestTask {
  id: number;
  id_request_general: number;
  task: string;
  id_status: number;
  status_task: string;
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

interface CategoryData {
  id: number;
  category: string;
}

interface ProcessCategoryData {
  id_process: number;
  process: string;
  id_category_request: number;
  category: string;
  email?: string;
}

interface ConsultResponse {
  companies: CompanyData[];
  categories: CategoryData[];
  processCategories: ProcessCategoryData[];
  assignedUsers: { id: string; name: string }[];
}

function ViewerRequestGeneralPage() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [userIdInitialized, setUserIdInitialized] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tasksByRequest, setTasksByRequest] = useState<Record<number, RequestTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState({
    company: '',
    subject: '',
    category: '',
    process: '',
    descripcion: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  const [companies, setCompany] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [processCategories, setProcessCategories] = useState<
    { value: string; label: string; id_category_request: number; email?: string }[]
  >([]);
  const [filteredProcesses, setFilteredProcesses] = useState<{ value: string; label: string }[]>(
    []
  );
  const [assignedUsers, setAssignedUsers] = useState<{ value: string; label: string }[]>([]);
  const [formDataLoading, setFormDataLoading] = useState(false);
  const [formDataError, setFormDataError] = useState<string | null>(null);
  const [idUser, setIdUser] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [folderContents, setFolderContents] = useState([]);

  const [filters, setFilters] = useState({
    status: '1',
    company: '',
    date_from: '',
    date_to: '',
    assigned_to: '',
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
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
            fetchTicketsWithUserId(id);
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
    await fetchTicketsWithUserId(userId);
  };

  const fetchTasksForTickets = async (ticketsToUse: Ticket[]) => {
    try {
      const response = await fetch('/api/requests-general/activities-requets');
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

  const fetchTicketsWithUserId = async (
    userIdToUse: number,
    filtersToUse: typeof filters = filters
  ) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('idUser', userIdToUse.toString());

      if (filtersToUse.status) params.append('status', filtersToUse.status);
      if (filtersToUse.company) params.append('company', filtersToUse.company);
      if (filtersToUse.date_from) params.append('date_from', filtersToUse.date_from);
      if (filtersToUse.date_to) params.append('date_to', filtersToUse.date_to);
      if (filtersToUse.assigned_to) params.append('assigned_to', filtersToUse.assigned_to);

      const url = `/api/requests-general/viewer-request?${params.toString()}`;

      const response = await fetch(url);

      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = await response.json();
      console.log('fetchTicketsWithUserId: Tickets recibidos:', data.length, 'tickets');
      setTickets(data);
      fetchTasksForTickets(data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const validateFilters = () => {
    const errors: string[] = [];

    if (filters.date_from && filters.date_to) {
      const fromDate = new Date(filters.date_from);
      const toDate = new Date(filters.date_to);
      if (fromDate > toDate) {
        errors.push('La fecha "Desde" no puede ser mayor que la fecha "Hasta"');
      }
    }

    if (filters.company && !companies.find((c) => c.value === filters.company)) {
      errors.push('La empresa seleccionada no es válida');
    }

    if (filters.assigned_to && !assignedUsers.find((u) => u.value === filters.assigned_to)) {
      errors.push('La persona asignada seleccionada no es válida');
    }

    if (errors.length > 0) {
      setError(errors.join('. '));
      return false;
    }

    return true;
  };

  const handleApplyFilters = async () => {
    if (!validateFilters()) {
      return;
    }

    if (userId) {
      await fetchTicketsWithUserId(userId);
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

  const fetchFormData = async () => {
    try {
      setFormDataLoading(true);
      setFormDataError(null);

      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data: ConsultResponse = await response.json();
        setCompany(
          data.companies.map((c) => ({ value: c.id_company.toString(), label: c.company }))
        );
        setFormData((prev) => ({
          ...prev,
          company: "3",
        }));
        setCategories(data.categories.map((c) => ({ value: c.id.toString(), label: c.category })));
        setProcessCategories(
          data.processCategories.map((p) => ({
            value: p.id_process.toString(),
            label: p.process,
            id_category_request: p.id_category_request,
            email: p.email,
          }))
        );
        if (data.assignedUsers) {
          setAssignedUsers(data.assignedUsers.map((u) => ({ value: u.name, label: u.name })));
        }
      } else {
        console.error('Frontend - fetchFormData failed with status:', response.status);
        setFormDataError('Error al cargar los datos del formulario. Inténtalo de nuevo.');
      }
    } catch (err) {
      console.error('Error fetching form data:', err);
      setFormDataError('Error al cargar los datos del formulario. Inténtalo de nuevo.');
    } finally {
      setFormDataLoading(false);
    }
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (formErrors[field]) {
      setFormErrors((prev) => ({
        ...prev,
        [field]: '',
      }));
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

  const getTasksProgress = (tasks: RequestTask[]) => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status_task?.toLowerCase() === 'resuelto').length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, percent };
  };

  const getGlobalTasksProgress = () => {
    const allTasks = Object.values(tasksByRequest).flat();
    return getTasksProgress(allTasks);
  };

  const filterByStatus = (value: string) => {
    const nf = { ...filters, status: value };
    setFilters(nf);
    if (userId) {
      fetchTicketsWithUserId(userId, nf);
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Solicitudes Generales', href: '#' },
    { title: 'Panel de Solicitudes', href: '#' },
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        {/* Header Section */}
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
                <IconFileDescription size={32} className='text-blue-600' />
                Observar Mis Solicitudes
              </Title>
              <Text size='lg' c='dimmed'>
                Observación de mis solicitudes
              </Text>
            </div>

          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Mostrar todas las solicitudes'
                onClick={() => filterByStatus('')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-blue-light)',
                  borderColor:
                    filters.status === ''
                      ? 'var(--mantine-color-blue-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconFileDescription size={24} color='var(--mantine-color-blue-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-blue-light-color)'>
                      Total de Solicitudes
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.length}
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
                role='button'
                aria-label='Filtrar solicitudes pendientes'
                onClick={() => filterByStatus('1')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-orange-light)',
                  borderColor:
                    filters.status === '1'
                      ? 'var(--mantine-color-orange-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconProgress size={24} color='var(--mantine-color-orange-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-orange-light-color)'>
                      Pendientes
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'abierto').length}
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
                role='button'
                aria-label='Filtrar solicitudes completadas'
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
                <Group>
                  <IconCheck size={24} color='var(--mantine-color-green-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-green-light-color)'>
                      Completadas
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'resuelto').length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
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
                          Avance de tareas
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
              data-testid='filter-toggle'
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    placeholder='Todos los estados'
                    clearable
                    data={[
                      { value: '0', label: 'Todos' },
                      { value: '1', label: 'Abierto' },
                      { value: '3', label: 'Cancelado' },
                      { value: '2', label: 'Resuelto' },
                      { value: '7', label: 'Devuelta' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '')}
                    leftSection={<IconFlag size={16} />}
                    data-testid='status-filter'
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
                    data-testid='company-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha Desde'
                    type='date'
                    value={filters.date_from}
                    onChange={(e) => handleFilterChange('date_from', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                    data-testid='date_from-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha Hasta'
                    type='date'
                    value={filters.date_to}
                    onChange={(e) => handleFilterChange('date_to', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                    data-testid='date_to-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Persona Asignada'
                    placeholder='Todas las personas'
                    clearable
                    data={assignedUsers}
                    value={filters.assigned_to}
                    onChange={(value) => handleFilterChange('assigned_to', value || '')}
                    leftSection={<IconUserCheck size={16} />}
                    data-testid='assigned_to-filter'
                  />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={async () => {
                    const clearedFilters = {
                      status: '',
                      company: '',
                      date_from: '',
                      date_to: '',
                      assigned_to: '',
                    };
                    setFilters(clearedFilters);

                    setError(null);

                    setTimeout(async () => {
                      if (userId) {
                        await fetchTicketsWithUserId(userId);
                      }
                    }, 100);
                  }}
                  leftSection={<IconX size={16} />}
                  data-testid='clear-filters'
                >
                  Limpiar Filtros
                </Button>
                <Button
                  onClick={handleApplyFilters}
                  leftSection={<IconRefresh size={16} />}
                  data-testid='apply-filters'
                >
                  Aplicar Filtros
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        {/* Enhanced Table */}
        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconFileDescription size={20} />
            Lista de Solicitudes
          </Title>

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
                          Intenta ajustar los filtros o crea una nueva solicitud
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
                              {tasksByRequest[ticket.id].map((task) => {
                                const { color, Icon } = getTaskVisual(task.status_task);
                                return (
                                  <Tooltip
                                    key={task.id}
                                    label={`${task.task} · ${task.status_task}`}
                                    withArrow
                                  >
                                    <Badge
                                      variant='light'
                                      color={color}
                                      size='sm'
                                      radius='sm'
                                      styles={{
                                        root: { textTransform: 'none', fontWeight: 500, cursor: 'default' },
                                        label: { overflow: 'hidden', textOverflow: 'ellipsis' },
                                      }}
                                      leftSection={<Icon size={13} />}
                                    >
                                      {task.task}
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
                        <Text size="sm" c="dimmed">
                          {
                            (() => {
                              const raw = ticket.created_at;
                              if (!raw) return "Sin fecha";

                              const date = new Date(raw);
                              if (isNaN(date.getTime())) return "Fecha inválida";

                              const adjusted = new Date(date.getTime() + 5 * 60 * 60 * 1000);

                              return new Intl.DateTimeFormat("es-CO", {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              }).format(adjusted);
                            })()
                          }
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
        </Card>

      </div>
    </div>
  );
}

export default function ViewerRequestsGeneralPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ViewerRequestGeneralPage />
    </Suspense>
  );
}
