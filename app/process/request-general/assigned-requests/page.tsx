'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
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
  IconUserCheck,
  IconTag,
  IconCalendarEvent,
  IconDownload,
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../components/ui/FileUpload';
import { createPrerenderSearchParamsForClientPage } from 'next/dist/server/request/search-params';

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
}

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

  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
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
    status: '',
    company: '',
    date_from: '',
    date_to: '',
    assigned_to: '',
  });
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
            fetchTicketsWithUserId(id, filters);
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
    await fetchTicketsWithUserId(userId, filters);
  };

  const fetchTicketsWithUserId = async (userIdToUse: number, filtersToUse?: typeof filters) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('idUser', userIdToUse.toString());

      if (filtersToUse) {
        if (filtersToUse.id) params.append('id', filtersToUse.id); 
        if (filtersToUse.status) params.append('status', filtersToUse.status);
        if (filtersToUse.company) params.append('company', filtersToUse.company);
        if (filtersToUse.date_from) params.append('date_from', filtersToUse.date_from);
        if (filtersToUse.date_to) params.append('date_to', filtersToUse.date_to);
        if (filtersToUse.assigned_to) params.append('assigned_to', filtersToUse.assigned_to);
      }

      const url = `/api/requests-general/request-assigned?${params.toString()}`;

      const response = await fetch(url);

      if (!response.ok) throw new Error('Failed to fetch assigned tickets');

      const data = await response.json();
      console.log('fetchTicketsWithUserId: Tickets asignados recibidos:', data.length, 'tickets');
      setTickets(data);
    } catch (err) {
      console.error('Error fetching assigned tickets:', err);
      setError('Unable to load assigned tickets. Please try again.');
    } finally {
      setLoading(false);
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
        return 'blue';
      case 'cancelado':
        return 'red';
      case 'resuelto':
        return 'green';
      default:
        return 'gray';
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
      <span key={index} className='text-gray-500'>
        {item.title}
      </span>
    )
  );

  async function exportToExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Datos');

    type TicketKeys = keyof Ticket;

    const columnMapOrdered: { key: TicketKeys; header: string }[] = [
      { key: "requester", header: "nombre_solicitante" },
      { key: "subject", header: "cargo_solicitante" },
      { key: "description", header: "conocimiento_experiencia" },
      { key: "email", header: "correo_electronico_firmante_1" }
    ];
    
    worksheet.columns = columnMapOrdered;

    tickets.forEach((row) => worksheet.addRow(row));

    tickets.forEach(item => {
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

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
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
                Solicitudes Asignadas
              </Title>
              <Text size='lg' c='gray.6'>
                Gestión de solicitudes asignadas a ti
              </Text>
            </div>
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconTicket size={24} className='text-blue-600' />
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
                      Pendiente
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
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
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
                      { value: '1', label: 'Abierto' },
                      { value: '3', label: 'Cancelado' },
                      { value: '2', label: 'Resuelto' },
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
                  onClick={() => {
                    const clearedFilters = {
                      id: '',
                      status: '',
                      company: '',
                      date_from: '',
                      date_to: '',
                      assigned_to: '',
                    };
                    setFilters(clearedFilters);
                    if (userId) {
                      fetchTicketsWithUserId(userId, clearedFilters);
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

        <Card shadow='sm' radius='md' withBorder className='bg-white overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconTicket size={20} />
            Lista de Solicitudes Asignadas
          </Title>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Fecha de Solicitud</Table.Th>
                  <Table.Th>Solicitado por</Table.Th>
                  <Table.Th>Asignado a</Table.Th>
                  <Table.Th>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tickets.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconTicket size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          No se encontraron solicitudes asignadas
                        </Text>
                        <Text size='sm' c='gray.5'>
                          No tienes solicitudes asignadas actualmente
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
                        router.push(
                          `/process/request-general/view-request?id=${ticket.id}&from=assigned-requests`
                        );
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
                        <Text size='sm' className='max-w-xs truncate'>
                          {ticket.process}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} className='flex'>
                          <IconBuilding size={12} className='text-gray-400' />

                          <Text size='sm' className='max-w-xs truncate'>
                            {ticket.company}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' c='gray.7'>
                          {new Date(ticket.created_at).toISOString().split('T')[0]}
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
                        <Badge color={getStatusColor(ticket.status)} variant='light' size='sm'>
                          {ticket.status}
                        </Badge>
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

export default function TicketsBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <RequestBoard />
    </Suspense>
  );
}
