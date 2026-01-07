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
  IconUserCheck,
  IconTag,
} from '@tabler/icons-react';
import { sendMessage } from '../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../components/ui/FileUpload';

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

function RequestGeneralPage() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [userIdInitialized, setUserIdInitialized] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
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
    status: '',
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
            setError('No se pudo obtener el ID del usuario. Por favor, recargue la página.');
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

  const fetchTicketsWithUserId = async (userIdToUse: number) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('idUser', userIdToUse.toString());

      if (filters.status) params.append('status', filters.status);
      if (filters.company) params.append('company', filters.company);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);

      const url = `/api/requests-general/general-requests?${params.toString()}`;

      const response = await fetch(url);

      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = await response.json();
      console.log('fetchTicketsWithUserId: Tickets recibidos:', data.length, 'tickets');
      setTickets(data);
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
      <div className='min-h-screen flex items-center justify-center'>
        <div>Cargando...</div>
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
      default:
        return 'gray';
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
      <span key={index} className='text-gray-500'>
        {item.title}
      </span>
    )
  );

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        {/* Header Section */}
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' className='bg-white'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3'
              >
                <IconFileDescription size={32} className='text-blue-600' />
                Solicitudes Generales
              </Title>
              <Text size='lg' c='gray.6'>
                Gestión y seguimiento de solicitudes generales
              </Text>
            </div>

          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconFileDescription size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' c='blue.6'>
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
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconProgress size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' c='blue.6'>
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
              <Card p='md' radius='md' withBorder className='bg-green-50 border-green-200'>
                <Group>
                  <IconCheck size={24} className='text-green-600' />
                  <div>
                    <Text size='xs' c='green.6'>
                      Completadas
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'resuelto').length}
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

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6' className='bg-white'>
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
        <Card shadow='sm' radius='md' withBorder className='bg-white overflow-hidden'>
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
                  <Table.Th>Compañia</Table.Th>

                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha de Solicitud</Table.Th>
                  <Table.Th>Categoría</Table.Th>
                  <Table.Th>Solicitado por</Table.Th>
                  <Table.Th>Asignado a</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tickets.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8} className='text-center py-12 text-gray-500'>
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
                      className='cursor-pointer hover:bg-gray-50 transition-colors'
                      onClick={() => {
                        sessionStorage.setItem('selectedRequest', JSON.stringify(ticket));
                        router.push(`/process/request-general/view-request?id=${ticket.id}&from=general-requests`);
                      }}
                    >
                      <Table.Td>
                        <Text size='xs' color='blue'className='max-w-xs truncate' lineClamp={2}>
                          {ticket.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' className='max-w-xs truncate' lineClamp={2}>
                          {ticket.subject}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconBuilding size={14} className='text-gray-400' />

                          <Text size='sm' className='max-w-xs truncate' lineClamp={2}>
                            {ticket.company}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getStatusColor(ticket.status)} variant='light' size='sm'>
                          {ticket.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="gray.7">
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
                        <Text fw={500} className='max-w-xs truncate' size='sm'>
                          {ticket.category}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconUser size={14} className='text-gray-400' />
                          <Text size='sm'>{ticket.requester}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconUserCheck size={14} className='text-gray-400' />
                          <Text size='sm'>{ticket.user}</Text>
                        </Group>
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

export default function RequestsGeneralPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequestGeneralPage />
    </Suspense>
  );
}
