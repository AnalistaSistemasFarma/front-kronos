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
import { ReportsChart } from '../../../../components/help-desk/ReportsChart';
import { useHelpDeskAccess } from '../../../../components/help-desk/hooks/useHelpDeskAccess';
import {
  IconAlertCircle,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconFilter,
  IconX,
  IconCheck,
  IconRefresh,
  IconTicket,
  IconCalendarEvent,
  IconUser,
  IconFlag,
  IconClock,
  IconBuilding,
} from '@tabler/icons-react';

interface Ticket {
  id_case: number;
  subject_case: string;
  priority: string;
  status: string;
  creation_date: string;
  nombreTecnico: string;
  subprocess_id: number;
  company: string;
}

function TicketsBoard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');
  const { hasAccess: hasHelpDeskAccess } = useHelpDeskAccess();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    priority: '',
    status: '1', // Por defecto mostrar solo tickets con estado "Abierto"
    assigned_user: '',
    date_from: '',
    date_to: '',
    technician: '', // Nuevo filtro por técnico
  });
  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState({
    requestType: '',
    priority: '',
    technician: '',
    category: '',
    site: '',
    asunto: '',
    subcategory: '',
    department: '',
    activity: '',
    description: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [subcategories, setSubcategories] = useState<{ value: string; label: string }[]>([]);
  const [activities, setActivities] = useState<{ value: string; label: string }[]>([]);
  const [technicals, setTechnicals] = useState<{ value: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingTechnicals, setLoadingTechnicals] = useState(false);
  const [technicalsError, setTechnicalsError] = useState<string | null>(null);
  const [idUser, setIdUser] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchTickets();
    fetchOptions();
    fetchSubprocessUsers();
  }, [session, status, router, filters]);

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

  const fetchOptions = async () => {
    try {
      setLoadingOptions(true);
      const [categoriesRes, departmentsRes] = await Promise.all([
        fetch('/api/help-desk/categories'),
        fetch('/api/help-desk/departments'),
      ]);

      if (categoriesRes.ok) {
        const categoriesData: { id_category: number; category: string }[] =
          await categoriesRes.json();
        setCategories(
          categoriesData.map((cat) => ({ value: cat.id_category.toString(), label: cat.category }))
        );
      }

      if (departmentsRes.ok) {
        const departmentsData: { id_department: number; department: string }[] =
          await departmentsRes.json();
        setDepartments(
          departmentsData.map((dep) => ({
            value: dep.id_department.toString(),
            label: dep.department,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching options:', error);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchSubcategories = async (categoryId: string) => {
    console.log('Frontend - fetchSubcategories called with categoryId:', categoryId);
    try {
      const response = await fetch(`/api/help-desk/subcategories?category_id=${categoryId}`);
      console.log('Frontend - fetchSubcategories response status:', response.status);
      if (response.ok) {
        const data: { id_subcategory: number; subcategory: string }[] = await response.json();
        console.log('Frontend - fetchSubcategories received data:', data);
        setSubcategories(
          data.map((sub) => ({ value: sub.id_subcategory.toString(), label: sub.subcategory }))
        );
        console.log(
          'Frontend - subcategories state updated:',
          data.map((sub) => ({ value: sub.id_subcategory.toString(), label: sub.subcategory }))
        );
      } else {
        console.error('Frontend - fetchSubcategories failed with status:', response.status);
      }
    } catch (error) {
      console.error('Error fetching subcategories:', error);
    }
  };

  const fetchSubprocessUsers = async () => {
    console.log('Frontend - fetchSubprocessUsers called');
    try {
      setLoadingTechnicals(true);
      setTechnicalsError(null);
      
      const response = await fetch('/api/help-desk/technical');
      console.log('Frontend - fetchSubprocessUsers response status:', response.status);

      if (response.ok) {
        const data: {
          id_subprocess_user_company: number;
          subprocess: string;
          id_company_user: number;
          name: string;
        }[] = await response.json();

        console.log('Frontend - fetchSubprocessUsers received data:', data);

        // Validar que los datos sean válidos
        if (Array.isArray(data) && data.length > 0) {
          setTechnicals(
            data.map((item) => ({
              value: item.id_subprocess_user_company.toString(),
              label: item.name,
            }))
          );
        } else {
          setTechnicals([]);
          console.log('No se encontraron técnicos disponibles');
        }
      } else {
        const errorText = await response.text();
        console.error('Frontend - fetchSubprocessUsers failed with status:', response.status, errorText);
        setTechnicalsError('No se pudieron cargar los técnicos. Intente nuevamente.');
      }
    } catch (error) {
      console.error('Error fetching subprocess users:', error);
      setTechnicalsError('Error de conexión al cargar técnicos. Verifique su conexión e intente nuevamente.');
    } finally {
      setLoadingTechnicals(false);
    }
  };

  const handleRetryTechnicals = async () => {
    await fetchSubprocessUsers();
  };

  const fetchActivities = async (subcategoryId: string) => {
    try {
      const response = await fetch(`/api/help-desk/activities?subcategory_id=${subcategoryId}`);
      if (response.ok) {
        const data: { id_activity: number; activity: string }[] = await response.json();
        setActivities(
          data.map((act) => ({ value: act.id_activity.toString(), label: act.activity }))
        );
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
  };

  const fetchTickets = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (subprocessId) params.append('subprocess_id', subprocessId);
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.status) params.append('status', filters.status);
      if (filters.assigned_user) params.append('assigned_user', filters.assigned_user);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      if (filters.technician) params.append('technician', filters.technician);

      const response = await fetch(`/api/help-desk/tickets?${params.toString()}`);

      if (!response.ok) throw new Error('Error al cargar los casos');

      const data = await response.json();
      setTickets(data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('No se pudieron cargar los casos. Por favor intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (field === 'category' && value) {
      fetchSubcategories(value);
      setFormData((prev) => ({
        ...prev,
        subcategory: '',
        activity: '',
      }));
      setSubcategories([]);
      setActivities([]);
    } else if (field === 'subcategory' && value) {
      fetchActivities(value);
      setFormData((prev) => ({
        ...prev,
        activity: '',
      }));
      setActivities([]);
    }
  };

  const handleCreateTicket = async () => {
    try {
      setCreateLoading(true);
      const response = await fetch('/api/help-desk/create_ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestType: formData.requestType,
          priority: formData.priority,
          technician: formData.technician,
          category: formData.category,
          site: formData.site,
          requester: idUser,
          asunto: formData.asunto,
          subcategory: formData.subcategory,
          department: formData.department,
          activity: formData.activity,
          description: formData.description,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al crear el caso');
      }

      const newTicket = await response.json();

      setTickets((prev) => [newTicket, ...prev]);

      setFormData({
        requestType: '',
        priority: '',
        technician: '',
        category: '',
        site: '',
        asunto: '',
        subcategory: '',
        department: '',
        activity: '',
        description: '',
      });
      setTechnicalsError(null);

      fetchTickets();
      setModalOpened(false);
    } catch (err) {
      console.error('Error creating ticket:', err);
      setError('Error al crear el caso. Por favor intente nuevamente.');
    } finally {
      setCreateLoading(false);
    }
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

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Mesa de Ayuda', href: '#' },
    { title: 'Panel de Casos', href: '#' },
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

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'alta':
        return 'red';
      case 'media':
        return 'yellow';
      case 'baja':
        return 'green';
      default:
        return 'gray';
    }
  };

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

  const getPriorityIcon = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'alta':
        return <IconFlag size={14} color='red' />;
      case 'media':
        return <IconFlag size={14} color='yellow' />;
      case 'baja':
        return <IconFlag size={14} color='green' />;
      default:
        return <IconFlag size={14} />;
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.requestType) {
      errors.requestType = 'El tipo de solicitud es obligatorio';
    }
    if (!formData.priority) {
      errors.priority = 'La prioridad es obligatoria';
    }
    if (!formData.asunto.trim()) {
      errors.asunto = 'El asunto es obligatorio';
    }
    if (!formData.category) {
      errors.category = 'La categoría es obligatoria';
    }
    if (!formData.subcategory) {
      errors.subcategory = 'La subcategoría es obligatoria';
    }
    if (!formData.department) {
      errors.department = 'El departamento es obligatorio';
    }
    if (!formData.activity) {
      errors.activity = 'La actividad es obligatoria';
    }
    if (!formData.site) {
      errors.site = 'El sitio es obligatorio';
    }
    if (!formData.description.trim()) {
      errors.description = 'La descripción es obligatoria';
    } else if (formData.description.trim().length < 10) {
      errors.description = 'La descripción debe tener al menos 10 caracteres';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateTicketWithValidation = async () => {
    if (!validateForm()) {
      return;
    }
    await handleCreateTicket();
  };

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
                <IconTicket size={32} className='text-blue-600' />
                Mesa de Ayuda
              </Title>
              <Text size='lg' color='gray.6'>
                Gestión y seguimiento de casos de soporte técnico
              </Text>
            </div>

            <Button
              onClick={() => setModalOpened(true)}
              size='lg'
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
            >
              Crear Nuevo Caso
            </Button>
          </Flex>

          {/* Stats Cards */}
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconTicket size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' color='blue.6'>
                      Total de Casos
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.length}
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
                    <Text size='xs' color='green.6'>
                      Resueltos
                    </Text>
                    <Text size='lg' fw={600}>
                      {
                        tickets.filter(
                          (t) =>
                            t.status?.toLowerCase() === 'resuelto' ||
                            t.status?.toLowerCase() === 'cerrado'
                        ).length
                      }
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-yellow-50 border-yellow-200'>
                <Group>
                  <IconClock size={24} className='text-yellow-600' />
                  <div>
                    <Text size='xs' color='yellow.6'>
                      En Progreso
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'abierto').length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-red-50 border-red-200'>
                <Group>
                  <IconFlag size={24} className='text-red-600' />
                  <div>
                    <Text size='xs' color='red.6'>
                      Alta Prioridad
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.priority?.toLowerCase() === 'alta').length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
          </Grid>
        </Card>

        {/* Reports Section - Only show for users with help-desk access */}
        {hasHelpDeskAccess && <ReportsChart className='mb-6' />}

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

        {/* Filters Section */}
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
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Prioridad'
                    placeholder='Todas las prioridades'
                    clearable
                    data={[
                      { value: 'Baja', label: 'Baja' },
                      { value: 'Media', label: 'Media' },
                      { value: 'Alta', label: 'Alta' },
                    ]}
                    value={filters.priority}
                    onChange={(value) => handleFilterChange('priority', value || '')}
                    leftSection={<IconFlag size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    placeholder='Todas los estados'
                    clearable
                    data={[
                      { value: '0', label: 'Todos' },
                      { value: '1', label: 'Abierto' },
                      { value: '2', label: 'Resuelto' },
                      { value: '3', label: 'Cancelado' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '')}
                    leftSection={<IconFlag size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Técnico Asignado'
                    placeholder='Todos los técnicos'
                    clearable
                    data={technicals}
                    value={filters.technician}
                    onChange={(value) => handleFilterChange('technician', value || '')}
                    leftSection={<IconUser size={16} />}
                    disabled={loadingOptions || loadingTechnicals}
                    rightSection={loadingTechnicals ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div> : null}
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
                  onClick={() =>
                    setFilters({
                      priority: '',
                      status: '',
                      assigned_user: '',
                      date_from: '',
                      date_to: '',
                      technician: '',
                    })
                  }
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

        {/* Tickets Table */}
        <Card shadow='sm' radius='md' withBorder className='bg-white overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconTicket size={20} />
            Lista de Casos
          </Title>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Prioridad</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha de Creación</Table.Th>
                  <Table.Th>Técnico Asignado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tickets.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconTicket size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          No se encontraron casos
                        </Text>
                        <Text size='sm'>
                          Intenta ajustar los filtros o crea un nuevo caso
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  tickets.map((ticket) => (
                    <Table.Tr
                      key={ticket.id_case}
                      className='cursor-pointer hover:bg-gray-50 transition-colors'
                      onClick={() => {
                        sessionStorage.setItem('selectedTicket', JSON.stringify(ticket));
                        router.push(`/process/help-desk/view-ticket?id=${ticket.id_case}`);
                      }}
                    >
                      <Table.Td>
                        <Badge variant='light' color='blue' size='sm'>
                          #{ticket.id_case}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={500} className='max-w-xs truncate'>
                          {ticket.subject_case}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>
                          {ticket.company}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {getPriorityIcon(ticket.priority)}
                          <Badge
                            color={getPriorityColor(ticket.priority)}
                            variant='light'
                            size='sm'
                          >
                            {ticket.priority}
                          </Badge>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getStatusColor(ticket.status)} variant='light' size='sm'>
                          {ticket.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>
                          {new Date(ticket.creation_date).toISOString().split('T')[0]}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconUser size={14} className='text-gray-400' />
                          <Text size='sm'>{ticket.nombreTecnico || 'Sin asignar'}</Text>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>

        {/* Modal for creating ticket */}
        <Modal
          opened={modalOpened}
          onClose={() => {
            setModalOpened(false);
            setFormErrors({});
            setTechnicalsError(null);
          }}
          title={
            <Group>
              <IconPlus size={20} />
              <Text size='lg' fw={600}>
                Crear Nuevo Caso
              </Text>
            </Group>
          }
          size='xl'
          radius='md'
          overlayProps={{ blur: 4 }}
        >
          <LoadingOverlay visible={createLoading} />

          <Stack>
            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Tipo de Solicitud'
                  placeholder='Seleccione el tipo de solicitud'
                  data={[
                    { value: 'Incidente', label: 'Incidente' },
                    { value: 'Solicitud', label: 'Solicitud' },
                  ]}
                  value={formData.requestType}
                  onChange={(value) => {
                    setFormData({ ...formData, requestType: value || '' });
                    if (formErrors.requestType) {
                      setFormErrors({ ...formErrors, requestType: '' });
                    }
                  }}
                  error={formErrors.requestType}
                  required
                  leftSection={<IconTicket size={16} />}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Prioridad'
                  placeholder='Seleccione la prioridad'
                  data={[
                    { value: 'Baja', label: 'Baja' },
                    { value: 'Media', label: 'Media' },
                    { value: 'Alta', label: 'Alta' },
                  ]}
                  value={formData.priority}
                  onChange={(value) => {
                    setFormData({ ...formData, priority: value || '' });
                    if (formErrors.priority) {
                      setFormErrors({ ...formErrors, priority: '' });
                    }
                  }}
                  error={formErrors.priority}
                  required
                  leftSection={<IconFlag size={16} />}
                />
              </Grid.Col>
            </Grid>

            <TextInput
              label='Asunto'
              placeholder='Ingrese un asunto claro y conciso'
              value={formData.asunto}
              onChange={(e) => {
                setFormData({ ...formData, asunto: e.target.value });
                if (formErrors.asunto) {
                  setFormErrors({ ...formErrors, asunto: '' });
                }
              }}
              error={formErrors.asunto}
              required
              maxLength={100}
              description='Máximo 100 caracteres'
            />

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Categoría'
                  placeholder='Seleccione la categoría'
                  data={categories}
                  value={formData.category}
                  onChange={(value) => {
                    handleFormChange('category', value || '');
                    if (formErrors.category) {
                      setFormErrors({ ...formErrors, category: '' });
                    }
                  }}
                  error={formErrors.category}
                  required
                  disabled={loadingOptions}
                  leftSection={<IconFilter size={16} />}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Subcategoría'
                  placeholder='Seleccione la subcategoría'
                  data={subcategories}
                  value={formData.subcategory}
                  onChange={(value) => {
                    handleFormChange('subcategory', value || '');
                    if (formErrors.subcategory) {
                      setFormErrors({ ...formErrors, subcategory: '' });
                    }
                  }}
                  error={formErrors.subcategory}
                  required
                  disabled={!formData.category || loadingOptions}
                  leftSection={<IconFilter size={16} />}
                />
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Departamento'
                  placeholder='Seleccione el departamento'
                  data={departments}
                  value={formData.department}
                  onChange={(value) => {
                    handleFormChange('department', value || '');
                    if (formErrors.department) {
                      setFormErrors({ ...formErrors, department: '' });
                    }
                  }}
                  error={formErrors.department}
                  required
                  disabled={loadingOptions}
                  leftSection={<IconBuilding size={16} />}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Sitio'
                  placeholder='Seleccione el sitio'
                  data={[
                    { value: 'Administrativa', label: 'Administrativa' },
                    { value: 'Planta', label: 'Planta' },
                    { value: 'Celta', label: 'Celta' },
                  ]}
                  value={formData.site}
                  onChange={(value) => {
                    setFormData({ ...formData, site: value || '' });
                    if (formErrors.site) {
                      setFormErrors({ ...formErrors, site: '' });
                    }
                  }}
                  error={formErrors.site}
                  required
                  leftSection={<IconBuilding size={16} />}
                />
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Actividad'
                  placeholder='Seleccione la actividad'
                  data={activities}
                  value={formData.activity}
                  onChange={(value) => {
                    handleFormChange('activity', value || '');
                    if (formErrors.activity) {
                      setFormErrors({ ...formErrors, activity: '' });
                    }
                  }}
                  error={formErrors.activity}
                  required
                  disabled={!formData.subcategory || loadingOptions}
                  leftSection={<IconFilter size={16} />}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Técnico Asignado'
                  placeholder={
                    loadingTechnicals
                      ? 'Cargando técnicos...'
                      : technicals.length === 0 && !loadingTechnicals && !technicalsError
                        ? 'No hay técnicos disponibles'
                        : 'Seleccione el técnico (opcional)'
                  }
                  data={technicals}
                  value={formData.technician}
                  onChange={(value) => {
                    // Validar que el valor sea un técnico válido o vacío
                    if (value === '' || technicals.some(t => t.value === value)) {
                      handleFormChange('technician', value || '');
                    }
                  }}
                  disabled={loadingOptions || loadingTechnicals || (technicals.length === 0 && !technicalsError)}
                  leftSection={<IconUser size={16} />}
                  clearable
                  description={
                    technicalsError
                      ? 'Error al cargar técnicos'
                      : technicals.length === 0 && !loadingTechnicals && !technicalsError
                        ? 'No se encontraron técnicos disponibles en este momento'
                        : 'Puede dejarse sin asignar'
                  }
                  error={technicalsError}
                  rightSection={loadingTechnicals ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div> : null}
                />
                {technicalsError && (
                  <Group justify="flex-end" mt="xs">
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={handleRetryTechnicals}
                      loading={loadingTechnicals}
                      leftSection={<IconRefresh size={12} />}
                    >
                      Reintentar
                    </Button>
                  </Group>
                )}
              </Grid.Col>
            </Grid>

            <Textarea
              label='Descripción Detallada'
              placeholder='Describa detalladamente el problema o solicitud. Incluya toda la información relevante para una mejor atención.'
              value={formData.description}
              onChange={(e) => {
                setFormData({ ...formData, description: e.target.value });
                if (formErrors.description) {
                  setFormErrors({ ...formErrors, description: '' });
                }
              }}
              error={formErrors.description}
              required
              minRows={5}
              maxLength={1000}
              description='Mínimo 10 caracteres, máximo 1000 caracteres'
              autosize
            />

            <Divider />

            <Group justify='flex-end' gap='md'>
              <Button
                variant='outline'
                onClick={() => {
                  setModalOpened(false);
                  setFormErrors({});
                }}
                size='md'
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateTicketWithValidation}
                loading={createLoading}
                size='md'
                leftSection={<IconPlus size={16} />}
                className='bg-blue-600 hover:bg-blue-700'
              >
                Crear Caso
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}

export default function TicketsBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <TicketsBoard />
    </Suspense>
  );
}
