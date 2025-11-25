'use client';

import { useState, useEffect, Suspense } from 'react';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
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
      // Reset process if not in filtered
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

      // Add filters to params
      if (filters.status) params.append('status', filters.status);
      if (filters.company) params.append('company', filters.company);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);

      const url = `/api/requests-general?${params.toString()}`;

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

    // Validate date range
    if (filters.date_from && filters.date_to) {
      const fromDate = new Date(filters.date_from);
      const toDate = new Date(filters.date_to);
      if (fromDate > toDate) {
        errors.push('La fecha "Desde" no puede ser mayor que la fecha "Hasta"');
      }
    }

    // Validate company filter
    if (filters.company && !companies.find((c) => c.value === filters.company)) {
      errors.push('La empresa seleccionada no es válida');
    }

    // Validate assigned user filter
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
        console.log('Frontend - fetchFormData received data:', data);
        setCompany(
          data.companies.map((c) => ({ value: c.id_company.toString(), label: c.company }))
        );
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

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.company) {
      errors.company = 'La empresa es obligatoria';
    }
    if (!formData.subject.trim()) {
      errors.subject = 'El asunto es obligatorio';
    }
    if (!formData.category) {
      errors.category = 'La categoría es obligatoria';
    }
    if (!formData.process) {
      errors.process = 'El proceso es obligatorio';
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
          subject: formData.subject,
          descripcion: formData.descripcion,
          category: parseInt(formData.category),
          process: parseInt(formData.process),
          createdby: userId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create ticket');
      }

      const newTicket = await response.json();

      setTickets((prev) => [newTicket, ...prev]);

      // Upload attached files if any
      if (attachedFiles.length > 0) {
        const token = await getMicrosoftToken();
        if (!token) {
          throw new Error('No se pudo obtener el token de acceso para subir archivos.');
        }

        const folderName = `Request-${newTicket.id_request}`;
        const filesToUpload = attachedFiles.map((file) => ({ file: file.file }));

        if (filesToUpload.length > 0) {
          await CheckOrCreateFolderAndUpload(folderName, filesToUpload, token);
        }
      }

      // Send email notification to assigned user
      await sendRequestEmailNotification(newTicket.id_request, formData.subject, parseInt(formData.process));

      setFormData({
        company: '',
        subject: '',
        category: '',
        process: '',
        descripcion: '',
      });

      setAttachedFiles([]); // Clear attached files

      fetchTickets();
      setModalOpened(false);
    } catch (err) {
      console.error('Error creating ticket:', err);
      setError('Failed to create ticket. Please try again.');
    } finally {
      setCreateLoading(false);
    }
  };

  async function CheckOrCreateFolderAndUpload(
    folderName: string,
    files: { file: File }[],
    token: string
  ) {
    try {
      // Crear la carpeta directamente
      const createResponse = await axios.post(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/SG:/children`,
        {
          name: folderName,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'replace'
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (createResponse.status !== 201) {
        throw new Error('Error al crear la carpeta.');
      }

      const folderId = createResponse.data.id;

      if (files && files.length > 0) {
        const uploadPromises = files.map((file: { file: File }) =>
          axios.put(
            `${process.env.MICROSOFTGRAPHUSERROUTE}items/${folderId}:/${file.file.name}:/content`,
            file.file,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': file.file.type,
              },
            }
          )
        );

        const results = await Promise.all(uploadPromises);

        results.forEach((response, index) => {
          if (response.status === 201 || response.status === 200) {
            console.log(`Archivo subido: ${files[index].file.name}`, response.data);
          } else {
            console.log(`Error al subir el archivo: ${files[index].file.name}`);
          }
        });
      } else {
        console.log('No hay archivos seleccionados para subir.');
      }
    } catch (error) {
      console.error('Error en CheckOrCreateFolderAndUpload:', error);
      throw error;
    }
  }

  const sendRequestEmailNotification = async (requestId: number, subject: string, processId: number): Promise<boolean> => {
    if (!process.env.API_EMAIL) {
      console.error('Error: La variable de entorno API_EMAIL no está configurada');
      return false;
    }

    try {
      // Find the email of the assigned user for this process
      const selectedProcess = processCategories.find(p => p.value === processId.toString());
      const assignedEmail = selectedProcess?.email;

      if (!assignedEmail) {
        console.log('No email found for assigned user, skipping email notification');
        return true;
      }

      const message = `Nueva Solicitud Asignada #${requestId} - ${subject}`;

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'ID de Solicitud': requestId,
          Asunto: subject,
          'Creado por': userName,
        },
      ];

      const outro = `Este es un mensaje automático del sistema de Solicitudes Generales. Se le ha asignado una nueva solicitud. Si tiene alguna pregunta, por favor contacte al administrador del sistema.`;

      const result = await sendMessage(
        message,
        assignedEmail,
        table,
        outro,
        'https://farmalogica.com.co/imagenes/logos/logo20.png',
        []
      );

      console.log('Notificación por correo de solicitud enviada exitosamente:', result);
      return true;
    } catch (error) {
      console.error('Error al enviar la notificación por correo de solicitud:', error);
      return false;
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

            <Button
              onClick={() => setModalOpened(true)}
              size='lg'
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
            >
              Crear Nueva Solicitud
            </Button>
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
                    // Clear all filters first
                    const clearedFilters = {
                      status: '',
                      company: '',
                      date_from: '',
                      date_to: '',
                      assigned_to: '',
                    };
                    setFilters(clearedFilters);

                    // Clear any existing errors
                    setError(null);

                    // Wait a moment for state to update, then fetch all tickets
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
                        router.push(`/process/request-general/view-request?id=${ticket.id}`);
                      }}
                    >
                      <Table.Td>
                        <Badge variant='light' color='blue' size='sm'>
                          #{ticket.id}
                        </Badge>
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
                          {ticket.created_at && !isNaN(new Date(ticket.created_at).getTime())
                            ? new Date(ticket.created_at).toISOString().split("T")[0]
                            : "Fecha inválida"}
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

        {/* Enhanced Modal for creating request */}
        <Modal
          opened={modalOpened}
          onClose={() => {
            setModalOpened(false);
            setFormErrors({});
            setAttachedFiles([]);
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
          <LoadingOverlay visible={createLoading || formDataLoading} />

          {formDataError && (
            <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md'>
              {formDataError}
            </Alert>
          )}

          <Stack>
            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Empresa Solicitante'
                  placeholder='Seleccione la empresa'
                  data={companies}
                  value={formData.company}
                  onChange={(value) => {
                    handleFormChange('company', value || '');
                  }}
                  error={formErrors.company}
                  required
                  leftSection={<IconBuilding size={16} />}
                  disabled={formDataLoading}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label='Asunto'
                  placeholder='Ingrese el asunto de la solicitud'
                  value={formData.subject}
                  onChange={(e) => {
                    setFormData({ ...formData, subject: e.target.value });
                    if (formErrors.subject) {
                      setFormErrors({ ...formErrors, subject: '' });
                    }
                  }}
                  error={formErrors.subject}
                  required
                  maxLength={254}
                  leftSection={<IconFileDescription size={16} />}
                />
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Categoría'
                  placeholder='Seleccione la categoría'
                  data={categories}
                  value={formData.category}
                  onChange={(value) => {
                    handleFormChange('category', value || '');
                  }}
                  error={formErrors.category}
                  required
                  leftSection={<IconTag size={16} />}
                  disabled={formDataLoading}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Proceso'
                  placeholder='Seleccione el proceso'
                  data={filteredProcesses}
                  value={formData.process}
                  onChange={(value) => {
                    handleFormChange('process', value || '');
                  }}
                  error={formErrors.process}
                  required
                  leftSection={<IconProgress size={16} />}
                  disabled={!formData.category || formDataLoading}
                />
              </Grid.Col>
            </Grid>

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
              maxLength={254}
              description='Mínimo 10 caracteres, máximo 254 caracteres'
              autosize
            />

            <Divider />

            {/* File Upload Section */}
            <div>
              <Text fw={600} mb='xs'>
                Archivos Adjuntos (Opcional)
              </Text>
              <FileUpload
                ticketId={0} // Dummy ID since request doesn't exist yet
                onFilesChange={setAttachedFiles}
                autoUpload={false}
                maxFiles={10}
                disabled={formDataLoading}
              />
            </div>

            <Divider />

            <Group justify='flex-end' gap='md'>
              <Button
                variant='outline'
                onClick={() => {
                  setModalOpened(false);
                  setFormErrors({});
                  setAttachedFiles([]);
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
    <Suspense fallback={<div>Cargando...</div>}>
      <RequestBoard />
    </Suspense>
  );
}
