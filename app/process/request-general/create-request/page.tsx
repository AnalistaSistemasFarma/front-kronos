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
}

function RequestBoard() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState({
    company: '',
    usuario: '',
    descripcion: '',
    category: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  // Options for selects
  const [companies, setCompany] = useState<{ value: string; label: string }[]>([]);
  const [idUser, setIdUser] = useState('');

  // New state for filters and enhanced functionality
  const [filters, setFilters] = useState({
    status: '',
    company: '',
    date_from: '',
    date_to: '',
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchTickets();
    fetchCompanies();
  }, [session, status, router]);

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

  const fetchTickets = async () => {
    try {
      setLoading(true);

      const response = await fetch(`/api/requests-general`);

      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = await response.json();
      setTickets(data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      setLoading(true);

      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data: { id_company: number; company: string }[] = await response.json();
        console.log('Frontend - fetchCompanies received data:', data);
        setCompany(data.map((sub) => ({ value: sub.id_company.toString(), label: sub.company })));
        console.log(
          'Frontend - fetchCompanies state updated:',
          data.map((sub) => ({ value: sub.id_company.toString(), label: sub.company }))
        );
      } else {
        console.error('Frontend - fetchCompanies failed with status:', response.status);
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear form errors when user starts typing
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

  const fetchFilteredTickets = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.company) params.append('company', filters.company);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);

      const response = await fetch(`/api/requests-general?${params.toString()}`);

      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = await response.json();
      setTickets(data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.company) {
      errors.company = 'La empresa es obligatoria';
    }
    if (!formData.usuario) {
      errors.usuario = 'El usuario asignado es obligatorio';
    }
    if (!formData.category.trim()) {
      errors.category = 'La categoría es obligatoria';
    }
    if (!formData.descripcion.trim()) {
      errors.descripcion = 'La descripción es obligatoria';
    } else if (formData.descripcion.trim().length < 10) {
      errors.descripcion = 'La descripción debe tener al menos 10 caracteres';
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

  const handleCreateTicket = async () => {
    try {
      setCreateLoading(true);
      const response = await fetch('/api/requests-general/create-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company: formData.company,
          usuario: formData.usuario,
          descripcion: formData.descripcion,
          category: formData.category,
          createdby: userName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create ticket');
      }

      const newTicket = await response.json();

      // Add the new ticket to the list
      setTickets((prev) => [newTicket, ...prev]);

      // Reset form and close modal
      setFormData({
        company: '',
        usuario: '',
        descripcion: '',
        category: '',
      });

      fetchTickets();
      setModalOpened(false);
    } catch (err) {
      console.error('Error creating ticket:', err);
      setError('Failed to create ticket. Please try again.');
    } finally {
      setCreateLoading(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div>Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pendiente':
        return 'orange';
      case 'en progreso':
        return 'blue';
      case 'completada':
        return 'green';
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

            <Button
              onClick={() => setModalOpened(true)}
              size='lg'
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
            >
              Crear Nueva Solicitud
            </Button>
          </Flex>

          {/* Stats Cards */}
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
              <Card p='md' radius='md' withBorder className='bg-orange-50 border-orange-200'>
                <Group>
                  <IconClock size={24} className='text-orange-600' />
                  <div>
                    <Text size='xs' c='orange.6'>
                      Pendientes
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'pendiente').length}
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
                      En Progreso
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'en progreso').length}
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
                      {tickets.filter((t) => t.status?.toLowerCase() === 'completada').length}
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
                    label='Estado'
                    placeholder='Todos los estados'
                    clearable
                    data={[
                      { value: 'Pendiente', label: 'Pendiente' },
                      { value: 'En Progreso', label: 'En Progreso' },
                      { value: 'Completada', label: 'Completada' },
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
                      status: '',
                      company: '',
                      date_from: '',
                      date_to: '',
                    })
                  }
                  leftSection={<IconX size={16} />}
                >
                  Limpiar Filtros
                </Button>
                <Button onClick={fetchFilteredTickets} leftSection={<IconRefresh size={16} />}>
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
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha de Solicitud</Table.Th>
                  <Table.Th>Categoría</Table.Th>
                  <Table.Th>Solicitado por</Table.Th>
                  <Table.Th>Asignado a</Table.Th>
                  <Table.Th>Descripción</Table.Th>
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
                    >
                      <Table.Td>
                        <Badge variant='light' color='blue' size='sm'>
                          #{ticket.id}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconBuilding size={14} className='text-gray-400' />
                          <Text fw={500}>{ticket.company}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getStatusColor(ticket.status)} variant='light' size='sm'>
                          {ticket.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' c='gray.7'>
                          {new Date(ticket.created_at).toISOString().split('T')[0]}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={500} className='max-w-xs truncate'>
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
                      <Table.Td>
                        <Text size='sm' className='max-w-xs truncate' lineClamp={2}>
                          {ticket.description}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>

        {/* Enhanced Modal for creating request */}
        <Modal
          opened={modalOpened}
          onClose={() => {
            setModalOpened(false);
            setFormErrors({});
          }}
          title={
            <Group>
              <IconPlus size={20} />
              <Text size='lg' fw={600}>
                Crear Nueva Solicitud
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
                  label='Empresa'
                  placeholder='Seleccione la empresa'
                  data={companies}
                  value={formData.company}
                  onChange={(value) => {
                    handleFormChange('company', value || '');
                  }}
                  error={formErrors.company}
                  required
                  leftSection={<IconBuilding size={16} />}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Asignado a'
                  placeholder='Seleccione a quien asignar esta solicitud'
                  data={[
                    { value: 'Catalina Sanchez', label: 'Catalina Sanchez' },
                    { value: 'Camila Murillo', label: 'Camila Murillo' },
                    { value: 'Lina Ramirez', label: 'Lina Ramirez' },
                  ]}
                  value={formData.usuario}
                  onChange={(value) => {
                    handleFormChange('usuario', value || '');
                  }}
                  error={formErrors.usuario}
                  required
                  leftSection={<IconUserCheck size={16} />}
                />
              </Grid.Col>
            </Grid>

            <TextInput
              label='Categoría'
              placeholder='Ingrese la categoría que necesite'
              value={formData.category}
              onChange={(e) => {
                setFormData({ ...formData, category: e.target.value });
                if (formErrors.category) {
                  setFormErrors({ ...formErrors, category: '' });
                }
              }}
              error={formErrors.category}
              required
              maxLength={100}
              description='Máximo 100 caracteres'
              leftSection={<IconTag size={16} />}
            />

            <Textarea
              label='Descripción Detallada'
              placeholder='Describa detalladamente la solicitud. Incluya toda la información relevante para una mejor atención.'
              value={formData.descripcion}
              onChange={(e) => {
                setFormData({ ...formData, descripcion: e.target.value });
                if (formErrors.descripcion) {
                  setFormErrors({ ...formErrors, descripcion: '' });
                }
              }}
              error={formErrors.descripcion}
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
                Crear Solicitud
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
    <Suspense fallback={<div>Loading...</div>}>
      <RequestBoard />
    </Suspense>
  );
}
