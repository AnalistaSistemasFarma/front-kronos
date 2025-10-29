'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
} from '@tabler/icons-react';
import Link from 'next/link';

interface Ticket {
  id_case: number;
  case_type: string;
  subject_case: string;
  priority: string;
  category: string;
  subcategory: string;
  activity: string;
  department: string;
  place?: string;
  description: string;
  status: string;
  id_department?: string;
  id_category?: string;
  id_subcategory?: string;
  id_activity?: string;
  id_technical?: string;
  creation_date: string;
  nombreTecnico: string;
  subprocess_id: number;
}

interface Option {
  value: string;
  label: string;
}

interface Subcategory {
  id_subcategory: number;
  subcategory: string;
  id_category: number | null;
}

interface Activity {
  id_activity: number;
  activity: string;
  id_subcategory: number | null;
}

function ViewTicketPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [categories, setCategories] = useState<Option[]>([]);
  const [subcategories, setSubcategories] = useState<Option[]>([]);
  const [activities, setActivities] = useState<Option[]>([]);
  const [technicals, setTechnicals] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [showResolution, setShowResolution] = useState(false);
  const [resolutionData, setResolutionData] = useState({
    estado: '',
    correo: '',
    resolucion: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const storedTicket = sessionStorage.getItem('selectedTicket');
    if (storedTicket) {
      setTicket(JSON.parse(storedTicket));
      setLoading(false);
    } else if (id) {
      fetch(`/api/help-desk/tickets?id=${id}`)
        .then((res) => {
          if (!res.ok) throw new Error('Error al cargar el caso');
          return res.json();
        })
        .then((data) => {
          setTicket(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Error fetching ticket:', err);
          setError('No se pudo cargar el caso. Por favor intente nuevamente.');
          setLoading(false);
        });
    }
  }, [id]);

  // Cuando se carga el ticket por primera vez
  useEffect(() => {
    if (ticket) {
      fetchOptions();
      fetchSubprocessUsers();
    }
  }, [ticket]);

  // Cuando cambia la categoría
  useEffect(() => {
    if (ticket?.category) {
      fetchSubcategories(ticket.category);
    }
  }, [ticket?.category]);

  useEffect(() => {
    if (ticket?.id_category) {
      fetchSubcategories(ticket.id_category);
    }
  }, [ticket?.id_category]);

  useEffect(() => {
    if (ticket?.id_subcategory) {
      fetchActivities(ticket.id_subcategory);
    }
  }, [ticket?.id_subcategory]);

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
    try {
      const response = await fetch(`/api/help-desk/subcategories?category_id=${categoryId}`);
      if (response.ok) {
        const data: Subcategory[] = await response.json();
        setSubcategories(
          data.map((sub) => ({
            value: sub.id_subcategory.toString(),
            label: sub.subcategory,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching subcategories:', error);
    }
  };

  const fetchSubprocessUsers = async () => {
    console.log('Frontend - fetchSubprocessUsers called');
    try {
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

        setTechnicals(
          data.map((item) => ({
            value: item.id_subprocess_user_company.toString(),
            label: item.name,
          }))
        );
      } else {
        console.error('Frontend - fetchSubprocessUsers failed with status:', response.status);
      }
    } catch (error) {
      console.error('Error fetching subprocess users:', error);
    }
  };

  const fetchActivities = async (subcategoryId: string) => {
    try {
      const response = await fetch(`/api/help-desk/activities?subcategory_id=${subcategoryId}`);
      if (response.ok) {
        const data: Activity[] = await response.json();
        setActivities(
          data.map((act) => ({
            value: act.id_activity.toString(),
            label: act.activity,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    setNotes((prev) => [...prev, newNote.trim()]);
    setNewNote('');
  };

  const handleUpdateCase = () => {
    // Actualizacion Caso
    console.log('Actualizar caso con:', resolutionData);
  };

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
      case 'en progreso':
        return 'blue';
      case 'cerrado':
        return 'gray';
      case 'resuelto':
        return 'teal';
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

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Mesa de Ayuda', href: '/process/help-desk/create-ticket' },
    { title: 'Detalle del Caso', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-6 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <span key={index} className='text-gray-500'>
        {item.title}
      </span>
    )
  );

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <Text size='lg' color='gray.6'>
            Cargando detalles del caso...
          </Text>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <Card shadow='sm' p='xl' radius='md' withBorder className='max-w-md'>
          <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md'>
            {error}
          </Alert>
          <Button
            fullWidth
            onClick={() => router.push('/process/help-desk/create-ticket')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver al Panel de Casos
          </Button>
        </Card>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <Card shadow='sm' p='xl' radius='md' withBorder className='max-w-md'>
          <Text size='lg' fw={500} mb='md' className='text-center'>
            Caso no encontrado
          </Text>
          <Button
            fullWidth
            onClick={() => router.push('/process/help-desk/create-ticket')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver al Panel de Casos
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        {/* Header */}
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
                <IconTicket size={32} className='text-blue-6' />
                Caso #{ticket.id_case}
              </Title>
              <Text size='lg' color='gray.6'>
                {ticket.subject_case}
              </Text>
            </div>

            <Group>
              <Badge color={getStatusColor(ticket.status)} size='lg' radius='sm' variant='light'>
                {ticket.status}
              </Badge>
              <Badge
                color={getPriorityColor(ticket.priority)}
                size='lg'
                radius='sm'
                variant='light'
                leftSection={getPriorityIcon(ticket.priority)}
              >
                {ticket.priority}
              </Badge>
            </Group>
          </Flex>
        </Card>

        {/* Main Content */}
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card shadow='sm' p='xl' radius='md' withBorder className='bg-white h-full'>
              <Title order={3} mb='md' className='flex items-center gap-2'>
                <IconNote size={20} />
                Detalles del Caso
              </Title>

              <Stack>
                <div>
                  <Text fw={600} mb='xs'>
                    Tipo de Solicitud
                  </Text>
                  <Select
                    data={['Incidente', 'Solicitud']}
                    value={ticket.case_type}
                    onChange={(val) => setTicket({ ...ticket, case_type: val ?? '' })}
                    leftSection={<IconTicket size={16} />}
                  />
                </div>

                <div>
                  <Text fw={600} mb='xs'>
                    Descripción del Caso
                  </Text>
                  <Card withBorder radius='md' p='md' bg='gray.0'>
                    <Text size='sm' className='whitespace-pre-line text-gray-700'>
                      {ticket.description}
                    </Text>
                  </Card>
                </div>

                <Divider />

                <div>
                  <Text fw={600} mb='xs'>
                    Categorización
                  </Text>
                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Categoría'
                        data={categories}
                        value={ticket.id_category?.toString() || ''}
                        onChange={(val) =>
                          setTicket({
                            ...ticket,
                            id_category: val ?? '',
                            id_subcategory: '',
                            id_activity: '',
                          })
                        }
                        leftSection={<IconFilter size={16} />}
                        disabled={loadingOptions}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Subcategoría'
                        data={subcategories}
                        value={ticket.id_subcategory?.toString() || ''}
                        onChange={(val) =>
                          setTicket({
                            ...ticket,
                            id_subcategory: val ?? '',
                            id_activity: '',
                          })
                        }
                        leftSection={<IconFilter size={16} />}
                        disabled={!ticket.id_category || loadingOptions}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Actividad'
                        data={activities}
                        value={ticket.id_activity?.toString() || ''}
                        onChange={(val) => setTicket({ ...ticket, id_activity: val ?? '' })}
                        leftSection={<IconFilter size={16} />}
                        disabled={!ticket.id_subcategory || loadingOptions}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Prioridad'
                        data={['Baja', 'Media', 'Alta']}
                        value={ticket.priority}
                        onChange={(val) => setTicket({ ...ticket, priority: val ?? '' })}
                        leftSection={<IconFlag size={16} />}
                      />
                    </Grid.Col>
                  </Grid>
                </div>
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap='md'>
              {/* Información General */}
              <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                <Title order={4} mb='md' className='flex items-center gap-2'>
                  <IconCalendar size={18} />
                  Información General
                </Title>

                <Stack gap='sm'>
                  <div>
                    <Text size='sm' color='gray.6'>
                      Fecha de Creación
                    </Text>
                    <Text fw={500}>
                      {new Date(ticket.creation_date).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </Text>
                  </div>

                  <div>
                    <Text size='sm' color='gray.6'>
                      Departamento
                    </Text>
                    <Select
                      data={departments}
                      value={ticket.id_department?.toString() || ''}
                      onChange={(val) => setTicket({ ...ticket, id_department: val ?? '' })}
                      leftSection={<IconBuilding size={16} />}
                      disabled={loadingOptions}
                    />
                  </div>

                  <div>
                    <Text size='sm' color='gray.6'>
                      Sitio
                    </Text>
                    <Select
                      data={[
                        { value: 'Administrativa', label: 'Administrativa' },
                        { value: 'Planta', label: 'Planta' },
                        { value: 'Celta', label: 'Celta' },
                      ]}
                      value={ticket.place || ''}
                      onChange={(val) => setTicket({ ...ticket, place: val ?? '' })}
                      leftSection={<IconBuilding size={16} />}
                    />
                  </div>

                  <div>
                    <Text size='sm' color='gray.6'>
                      Técnico Asignado
                    </Text>
                    <Select
                      data={technicals}
                      value={ticket.id_technical?.toString() || ''}
                      onChange={(val) => setTicket({ ...ticket, id_technical: val ?? '' })}
                      leftSection={<IconUser size={16} />}
                      disabled={loadingOptions}
                      clearable
                      placeholder='Sin asignar'
                    />
                  </div>
                </Stack>
              </Card>

              {/* Notas */}
              <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                <Title order={4} mb='md' className='flex items-center gap-2'>
                  <IconNote size={18} className='text-blue-6' />
                  Notas del Caso
                </Title>

                {notes.length > 0 ? (
                  <div className='max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3 mb-3 bg-gray-50'>
                    <Stack gap='xs'>
                      {notes.map((note, i) => (
                        <Text key={i} size='sm' className='text-gray-700'>
                          • {note}
                        </Text>
                      ))}
                    </Stack>
                  </div>
                ) : (
                  <Text size='sm' color='dimmed' mb='xs'>
                    No hay notas registradas.
                  </Text>
                )}

                <Group align='flex-end'>
                  <Textarea
                    placeholder='Escribe una nota...'
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    minRows={2}
                    className='flex-1'
                  />
                  <ActionIcon
                    variant='filled'
                    color='blue'
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                  >
                    <IconCheck size={16} />
                  </ActionIcon>
                </Group>
              </Card>

              {/* Resolución */}
              <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                <Group justify='space-between' mb='md'>
                  <Title order={4} className='flex items-center gap-2'>
                    <IconCheck size={18} className='text-green-6' />
                    Resolución del Caso
                  </Title>
                  <ActionIcon variant='subtle' onClick={() => setShowResolution(!showResolution)}>
                    {showResolution ? <IconX size={16} /> : <IconCheck size={16} />}
                  </ActionIcon>
                </Group>

                {showResolution && (
                  <Stack>
                    <Select
                      label='Estado del caso'
                      placeholder='Selecciona estado'
                      data={['Resuelto', 'Cancelado']}
                      value={resolutionData.estado}
                      onChange={(val) =>
                        setResolutionData({ ...resolutionData, estado: val || '' })
                      }
                      error={formErrors.estado}
                    />
                    <TextInput
                      label='Correo electrónico de contacto'
                      placeholder='correo@empresa.com'
                      value={resolutionData.correo}
                      onChange={(e) =>
                        setResolutionData({
                          ...resolutionData,
                          correo: e.currentTarget.value,
                        })
                      }
                      error={formErrors.correo}
                    />
                    <Textarea
                      label='Descripción de la resolución'
                      placeholder='Describe la resolución aplicada...'
                      value={resolutionData.resolucion}
                      onChange={(e) =>
                        setResolutionData({
                          ...resolutionData,
                          resolucion: e.currentTarget.value,
                        })
                      }
                      minRows={3}
                      error={formErrors.resolucion}
                    />

                    <Button
                      fullWidth
                      color='blue'
                      onClick={handleUpdateCase}
                      leftSection={<IconCheck size={16} />}
                    >
                      Actualizar Caso
                    </Button>
                  </Stack>
                )}
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>

        {/* Actions */}
        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Group justify='flex-end'>
            <Button
              variant='outline'
              onClick={() => router.push('/process/help-desk/create-ticket')}
              leftSection={<IconArrowLeft size={16} />}
            >
              Volver al Panel
            </Button>
          </Group>
        </Card>
      </div>
    </div>
  );
}

export default function TicketsViewBoardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ViewTicketPage />
    </Suspense>
  );
}
