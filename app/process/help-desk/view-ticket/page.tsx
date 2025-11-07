'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  id_status_case: number;
  resolution?: string;
  end_date?: string;
  company?: string;
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [showResolution, setShowResolution] = useState(false);
  const [resolutionData, setResolutionData] = useState({
    estado: '',
    correo: '',
    resolucion: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [originalTicket, setOriginalTicket] = useState<Ticket | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);

  const isTicketResolved = () => {
    return ticket?.id_status_case === 2 || ticket?.status?.toLowerCase() === 'resuelto';
  };

  useEffect(() => {
    const storedTicket = sessionStorage.getItem('selectedTicket');
    if (storedTicket) {
      const ticketData = JSON.parse(storedTicket);
      setTicket(ticketData);
      setOriginalTicket(ticketData);
      setLoading(false);
    } else if (id) {
      fetch(`/api/help-desk/tickets?id=${id}`)
        .then((res) => {
          if (!res.ok) throw new Error('Error al cargar el caso');
          return res.json();
        })
        .then((data) => {
          setTicket(data);
          setOriginalTicket(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Error fetching ticket:', err);
          setError('No se pudo cargar el caso. Por favor intente nuevamente.');
          setLoading(false);
        });
    }
  }, [id]);

  useEffect(() => {
    if (ticket) {
      fetchOptions();
      fetchSubprocessUsers();
      fetchNotes();
    }
  }, [ticket]);

  useEffect(() => {
    if (ticket?.id_category && !isEditing) {
      fetchSubcategories(ticket.id_category);
    }
    if (ticket?.id_subcategory && !isEditing) {
      fetchActivities(ticket.id_subcategory);
    }
  }, [ticket?.id_category, ticket?.id_subcategory, isEditing]);

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
        userName: userName.trim()
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

  useEffect(() => {
    if (status === 'authenticated' && userName && !userId) {
      getUserIdByName(userName).then(id => {
        if (id) {
          setUserId(id);
          console.log('ID de usuario obtenido:', id);
        }
      });
    }
  }, [status, userName, userId]);

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

  const fetchNotes = async () => {
    if (!ticket?.id_case) return;
    
    try {
      setLoadingNotes(true);
      const response = await fetch(`/api/help-desk/notes?id_case=${ticket.id_case}`);
      
      if (response.ok) {
        const data: Note[] = await response.json();
        setNotes(data);
      } else {
        console.error('Error al cargar notas');
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !ticket?.id_case || !userId) return;
    
    try {
      const response = await fetch('/api/help-desk/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_case: ticket.id_case,
          note: newNote.trim(),
          created_by: userId,
        }),
      });

      if (response.ok) {
        setNewNote('');
        await fetchNotes();
      } else {
        const errorData = await response.json();
        console.error('Error al agregar nota:', errorData.error);
      }
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  const handleFormChange = (field: string, value: string) => {
    setTicket((prev) => {
      if (!prev) return prev;
      const updatedTicket = { ...prev, [field]: value };

      if (field === 'id_category' && value) {
        fetchSubcategories(value);
        updatedTicket.id_subcategory = '';
        updatedTicket.id_activity = '';
        setSubcategories([]);
        setActivities([]);
      } else if (field === 'id_subcategory' && value) {
        fetchActivities(value);
        updatedTicket.id_activity = '';
        setActivities([]);
      }

      return updatedTicket;
    });

    if (formErrors[field]) {
      setFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };


  const handleStartEditing = () => {
    setIsEditing(true);
    setUpdateMessage(null);
  };

  const handleCancelEditing = () => {
    if (originalTicket) {
      setTicket(originalTicket);
    }
    setIsEditing(false);
    setFormErrors({});
    setUpdateMessage(null);
  };

  const validateFields = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!ticket?.case_type) {
      errors.case_type = 'El tipo de caso es requerido';
    }
    if (!ticket?.priority) {
      errors.priority = 'La prioridad es requerida';
    }
    if (!ticket?.id_category) {
      errors.id_category = 'La categoría es requerida';
    }
    if (!ticket?.id_subcategory) {
      errors.id_subcategory = 'La subcategoría es requerida';
    }
    if (!ticket?.id_activity) {
      errors.id_activity = 'La actividad es requerida';
    }
    if (!ticket?.id_department) {
      errors.id_department = 'El departamento es requerido';
    }

    if (resolutionData.estado) {
      if (!resolutionData.resolucion || resolutionData.resolucion.trim() === '') {
        errors.resolucion = 'La descripción de la resolución es requerida cuando se cambia el estado';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleUpdateCase = async () => {
    if (!validateFields()) {
      return;
    }

    setIsUpdating(true);
    setUpdateMessage(null);

    try {
      const updateData = {
        id_case: ticket?.id_case,
        status: resolutionData.estado || ticket?.id_status_case,
        priority: ticket?.priority,
        case_type: ticket?.case_type,
        id_category: ticket?.id_category,
        place: ticket?.place,
        id_subcategory: ticket?.id_subcategory,
        id_activity: ticket?.id_activity,
        id_department: ticket?.id_department,
        id_technical: ticket?.id_technical,
        resolucion: resolutionData.resolucion,
      };

      const response = await fetch('/api/help-desk/update_ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al actualizar el caso');
      }

      const result = await response.json();
      setUpdateMessage({ type: 'success', text: 'Caso actualizado exitosamente' });
      
      if (resolutionData.estado) {
        setTicket(prev => prev ? { ...prev, status: resolutionData.estado } : null);
      }
      
      setOriginalTicket(ticket);
      setIsEditing(false);
      
      if (resolutionData.estado) {
        setResolutionData({ ...resolutionData, estado: '', resolucion: '' });
        setShowResolution(false);
      }
    } catch (error) {
      console.error('Error updating case:', error);
      setUpdateMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error al actualizar el caso'
      });
    } finally {
      setIsUpdating(false);
    }
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

          {/* Alerta de caso resuelto */}
          {isTicketResolved() && (
            <Alert
              icon={<IconCheck size={16} />}
              title='Caso Resuelto'
              color='teal'
              mb='4'
            >
              Este caso ha sido marcado como resuelto y no se puede modificar. Si necesita realizar cambios, contacte al administrador del sistema.
            </Alert>
          )}
        </Card>

        {/* Main Content */}
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card shadow='sm' p='xl' radius='md' withBorder className='bg-white h-full'>
              <Title order={3} mb='md' className='flex items-center gap-2'>
                <IconNote size={20} />
                Detalles del Caso - {ticket.company}
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
                    disabled={!isEditing || isTicketResolved()}
                    error={formErrors.case_type}
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
                        onChange={(val) => handleFormChange('id_category', val ?? '')}
                        leftSection={<IconFilter size={16} />}
                        disabled={!isEditing || loadingOptions || isTicketResolved()}
                        error={formErrors.id_category}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Subcategoría'
                        data={subcategories}
                        value={ticket.id_subcategory?.toString() || ''}
                        onChange={(val) => handleFormChange('id_subcategory', val ?? '')}
                        leftSection={<IconFilter size={16} />}
                        disabled={!isEditing || !ticket.id_category || loadingOptions || isTicketResolved()}
                        error={formErrors.id_subcategory}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Actividad'
                        data={activities}
                        value={ticket.id_activity?.toString() || ''}
                        onChange={(val) => handleFormChange('id_activity', val ?? '')}
                        leftSection={<IconFilter size={16} />}
                        disabled={!isEditing || !ticket.id_subcategory || loadingOptions || isTicketResolved()}
                        error={formErrors.id_activity}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Prioridad'
                        data={['Baja', 'Media', 'Alta']}
                        value={ticket.priority}
                        onChange={(val) => setTicket({ ...ticket, priority: val ?? '' })}
                        leftSection={<IconFlag size={16} />}
                        disabled={!isEditing || isTicketResolved()}
                        error={formErrors.priority}
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
                      {new Date(ticket.creation_date).toISOString().split('T')[0]}
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
                      disabled={!isEditing || loadingOptions || isTicketResolved()}
                      error={formErrors.id_department}
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
                      disabled={!isEditing || isTicketResolved()}
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
                      disabled={!isEditing || loadingOptions || isTicketResolved()}
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
                      {notes.map((note) => (
                        <div key={note.id_note} className='border-b border-gray-200 pb-2 last:border-b-0'>
                          <Text size='sm' className='text-gray-700 mb-1'>
                            {note.note}
                          </Text>
                          <div className='flex justify-between items-center'>
                            <Text size='xs' color='gray.6'>
                              Creado por: {note.createdBy}
                            </Text>
                            {note.creation_date && (
                              <Text size='xs' color='gray.6'>
                                {new Intl.DateTimeFormat('es-CO', {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true
                                }).format(
                                  new Date(
                                    new Date(note.creation_date).getTime() + (5 * 60 * 60 * 1000) // +5 horas
                                  )
                                )}
                              </Text>
                            )}
                          </div>
                        </div>
                      ))}
                    </Stack>
                  </div>
                ) : (
                  <Text size='sm' color='dimmed' mb='xs'>
                    {loadingNotes ? 'Cargando notas...' : 'No hay notas registradas.'}
                  </Text>
                )}

                <Group align='flex-end'>
                  <Textarea
                    placeholder='Escribe una nota...'
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    minRows={2}
                    className='flex-1'
                    disabled={!userId || loadingUserId || isTicketResolved()}
                  />
                  <ActionIcon
                    variant='filled'
                    color='blue'
                    onClick={handleAddNote}
                    disabled={!userId || loadingUserId || !newNote.trim() || isTicketResolved()}
                  >
                    <IconCheck size={16} />
                  </ActionIcon>
                </Group>
                {isTicketResolved() && (
                  <Text size='xs' color='dimmed' mt='xs'>
                    No se pueden agregar notas a casos resueltos.
                  </Text>
                )}
                {(!userId || loadingUserId) && !isTicketResolved() && (
                  <Text size='xs' color='orange.6' mt='xs'>
                    {loadingUserId ? 'Cargando información del usuario...' : 'No se pudo identificar al usuario actual'}
                  </Text>
                )}
              </Card>

              {/* Resolución */}
              <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                <Group justify='space-between' mb='md'>
                  <Title order={4} className='flex items-center gap-2'>
                    <IconCheck size={18} className='text-green-6' />
                    Resolución del Caso
                  </Title>
                  {!isTicketResolved() && (
                    <ActionIcon variant='subtle' onClick={() => setShowResolution(!showResolution)}>
                      {showResolution ? <IconX size={16} /> : <IconCheck size={16} />}
                    </ActionIcon>
                  )}
                </Group>

                {/* Mostrar información de resolución si el caso está resuelto */}
                {isTicketResolved() && (
                  <Card withBorder radius='md' p='md' bg='teal.0' mb='md'>
                    <Stack gap='sm'>
                      <Text fw={600}>
                        Información de Resolución
                      </Text>
                      <Text size='sm' className='whitespace-pre-line text-gray-700'>
                        {ticket.resolution}
                      </Text>
                      {ticket.end_date && (
                        <Text size='xs'>
                          Fecha de resolución: {new Date(ticket.end_date).toLocaleDateString()}
                        </Text>
                      )}
                    </Stack>
                  </Card>
                )}

                {/* Formulario de resolución para casos no resueltos */}
                {!isTicketResolved() && showResolution && (
                  <Stack>
                    <Select
                      label='Estado del caso'
                      placeholder='Selecciona estado'
                      data={[
                        { value: '2', label: 'Resuelto' },
                        { value: '3', label: 'Cancelado' },
                      ]}
                      value={resolutionData.estado}
                      onChange={(val) =>
                        setResolutionData({ ...resolutionData, estado: val || '' })
                      }
                      error={formErrors.estado}
                      disabled={!isEditing}
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
                      disabled={!isEditing}
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
                      disabled={!isEditing}
                    />

                    {isEditing && (
                      <Button
                        fullWidth
                        color='blue'
                        onClick={handleUpdateCase}
                        leftSection={<IconCheck size={16} />}
                        loading={isUpdating}
                      >
                        Actualizar Caso
                      </Button>
                    )}
                  </Stack>
                )}
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>

        {/* Actions */}
        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          {/* Mensaje de actualización */}
          {updateMessage && (
            <Alert
              color={updateMessage.type === 'success' ? 'green' : 'red'}
              mb='md'
              icon={updateMessage.type === 'success' ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
            >
              {updateMessage.text}
            </Alert>
          )}

          <Group justify='space-between'>
            <Group>
              {!isEditing ? (
                <Button
                  color='blue'
                  onClick={handleStartEditing}
                  leftSection={<IconTicket size={16} />}
                  disabled={isTicketResolved()}
                >
                  Editar Caso
                </Button>
              ) : (
                <>
                  <Button
                    color='green'
                    onClick={handleUpdateCase}
                    leftSection={<IconCheck size={16} />}
                    loading={isUpdating}
                  >
                    Guardar Cambios
                  </Button>
                  <Button
                    variant='outline'
                    color='gray'
                    onClick={handleCancelEditing}
                    leftSection={<IconX size={16} />}
                  >
                    Cancelar
                  </Button>
                </>
              )}
              {isTicketResolved() && (
                <Text size='sm' color='dimmed'>
                  Los casos resueltos no se pueden modificar.
                </Text>
              )}
            </Group>

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
