'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
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
  Avatar,
  ScrollArea,
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
  IconTag,
  IconUserCheck,
  IconFileDescription,
  IconProgress,
} from '@tabler/icons-react';
import Link from 'next/link';

interface Request {
  id: number;
  subject: string;
  category: string;
  process: string;
  description: string;
  id_company: number;
  company: string;
  created_at: string;
  requester: string;
  status: string;
}

interface Option {
  value: string;
  label: string;
}

interface Note {
  id_note: number;
  note: string;
  createdBy: string;
  creation_date?: string;
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
}

interface ConsultResponse {
  companies: CompanyData[];
  categories: CategoryData[];
  processCategories: ProcessCategoryData[];
}

function ViewRequestPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const [request, setRequest] = useState<Request | null>(null);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [processCategories, setProcessCategories] = useState<
    { value: string; label: string; id_category_request: number }[]
  >([]);
  const [filteredProcesses, setFilteredProcesses] = useState<Option[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedRequest = sessionStorage.getItem('selectedRequest');
    if (storedRequest) {
      const requestData = JSON.parse(storedRequest);
      setRequest(requestData);
      setLoading(false);
    } else if (id) {
      fetch(`/api/requests-general/view-request?id=${id}`)
        .then((res) => {
          if (!res.ok) throw new Error('Error al cargar la solicitud');
          return res.json();
        })
        .then((data) => {
          setRequest(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Error fetching request:', err);
          setError('No se pudo cargar la solicitud. Por favor intente nuevamente.');
          setLoading(false);
        });
    }
  }, [id]);

  useEffect(() => {
    if (request) {
      fetchFormData();
      fetchNotes();
    }
  }, [request]);

  useEffect(() => {
    // Auto-scroll al final del chat cuando se cargan nuevas notas
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [notes]);

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

  useEffect(() => {
    if (status === 'authenticated' && userName && !userId) {
      getUserIdByName(userName).then((id) => {
        if (id) {
          setUserId(id);
          console.log('ID de usuario obtenido:', id);
        }
      });
    }
  }, [status, userName, userId]);

  useEffect(() => {
    if (request?.category) {
      const filtered = processCategories.filter(
        (p) => p.id_category_request === parseInt(request.category)
      );
      setFilteredProcesses(filtered);
    } else {
      setFilteredProcesses([]);
    }
  }, [request?.category, processCategories]);

  const fetchFormData = async () => {
    try {
      setLoadingOptions(true);
      const response = await fetch('/api/requests-general/consult-request');

      if (response.ok) {
        const data: ConsultResponse = await response.json();
        setCompanies(
          data.companies.map((c) => ({ value: c.id_company.toString(), label: c.company }))
        );
        setCategories(data.categories.map((c) => ({ value: c.id.toString(), label: c.category })));
        setProcessCategories(
          data.processCategories.map((p) => ({
            value: p.id_process.toString(),
            label: p.process,
            id_category_request: p.id_category_request,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching form data:', error);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchNotes = async () => {
    if (!request?.id) return;
    try {
      setLoadingNotes(true);
      const response = await fetch(`/api/requests-general/notes?id_request=${request.id}`);

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
    if (!newNote.trim() || !request?.id || !userId) return;

    try {
      const response = await fetch('/api/requests-general/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_request: request.id,
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
    { title: 'Solicitudes Generales', href: '/process/request-general/create-request' },
    { title: 'Detalle de la Solicitud', href: '#' },
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
            Cargando detalles de la solicitud...
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
            onClick={() => router.push('/process/request-general/create-request')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver al Panel de Solicitudes
          </Button>
        </Card>
      </div>
    );
  }

  if (!request) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <Card shadow='sm' p='xl' radius='md' withBorder className='max-w-md'>
          <Text size='lg' fw={500} mb='md' className='text-center'>
            Solicitud no encontrada
          </Text>
          <Button
            fullWidth
            onClick={() => router.push('/process/request-general/create-request')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver al Panel de Solicitudes
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
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
                <IconFileDescription size={32} className='text-blue-6' />
                Solicitud #{request.id}
              </Title>
              <Text size='lg'>{request.subject}</Text>
            </div>

            <Group>
              <Badge color={getStatusColor(request.status)} size='lg' radius='sm' variant='light'>
                {request.status}
              </Badge>
            </Group>
          </Flex>
        </Card>

        {/* Layout de dos columnas para escritorio, una columna para móviles */}
        <div className='flex flex-col lg:flex-row gap-6'>
          {/* Columna izquierda: Historial de interacciones (Chat) */}
          <div className='flex-1 order-2 lg:order-1'>
            <Card
              shadow='sm'
              p='xl'
              radius='md'
              withBorder
              className='bg-white h-full flex flex-col'
            >
              <Title order={3} mb='md' className='flex items-center gap-2'>
                <IconNote size={20} />
                Historial de Interacciones
              </Title>

              {/* Área de chat con scroll */}
              <ScrollArea h={400} className='flex-1 mb-4' offsetScrollbars>
                <div className='space-y-4 p-2'>
                  {notes.length > 0 ? (
                    notes.map((note) => {
                      const isCurrentUser = note.createdBy === userName;
                      return (
                        <div
                          key={note.id_note}
                          className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
                              isCurrentUser
                                ? 'bg-blue-400 text-white rounded-br-none'
                                : 'bg-gray-100 text-gray-800 rounded-bl-none'
                            }`}
                          >
                            <div className='flex items-center gap-2 mb-2'>
                              <Avatar
                                size='sm'
                                radius='xl'
                                color={isCurrentUser ? 'white' : 'gray'}
                              >
                                {note.createdBy.charAt(0).toUpperCase()}
                              </Avatar>
                              <Text
                                size='xs'
                                fw={500}
                                className={
                                  isCurrentUser
                                    ? 'text-blue-100 font-bold'
                                    : 'text-gray-600 font-bold'
                                }
                              >
                                {note.createdBy}
                              </Text>
                            </div>
                            <Text size='sm' className='whitespace-pre-line mb-2'>
                              {note.note}
                            </Text>
                            {note.creation_date && (
                              <Text
                                size='xs'
                                className={isCurrentUser ? 'text-blue-100' : 'text-gray-500'}
                              >
                                {new Intl.DateTimeFormat('es-CO', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                }).format(
                                  new Date(
                                    new Date(note.creation_date).getTime() + 5 * 60 * 60 * 1000 // +5 horas
                                  )
                                )}
                              </Text>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className='text-center py-8'>
                      <Text size='lg' color='gray.5' mb='xs'>
                        No hay interacciones registradas
                      </Text>
                      <Text size='sm' color='gray.4'>
                        Sé el primero en añadir un comentario
                      </Text>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>

              {/* Área de entrada de texto para nuevas notas */}
              <div className='border-t pt-4'>
                <Group align='flex-end'>
                  <Textarea
                    placeholder='Escribe una nota...'
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    minRows={2}
                    className='flex-1'
                    disabled={!userId || loadingUserId}
                    styles={{
                      input: {
                        borderRadius: '12px',
                      },
                    }}
                  />
                  <ActionIcon
                    variant='filled'
                    color='blue'
                    size='lg'
                    radius='xl'
                    onClick={handleAddNote}
                    disabled={!userId || loadingUserId || !newNote.trim()}
                  >
                    <IconCheck size={18} />
                  </ActionIcon>
                </Group>
                {(!userId || loadingUserId) && (
                  <Text size='xs' color='orange.6' mt='xs'>
                    {loadingUserId
                      ? 'Cargando información del usuario...'
                      : 'No se pudo identificar al usuario actual'}
                  </Text>
                )}
              </div>
            </Card>
          </div>

          {/* Columna derecha: Panel de detalles de la solicitud */}
          <div className='w-full lg:w-80 order-1 lg:order-2'>
            <Card shadow='sm' p='xl' radius='md' withBorder className='bg-white'>
              <Title order={4} mb='md' className='flex items-center gap-2'>
                <IconFileDescription size={18} />
                Detalles de la Solicitud
              </Title>

              <Stack gap='md'>
                {/* Información básica */}
                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    ID de Solicitud
                  </Text>
                  <Text size='lg' fw={600}>
                    #{request.id}
                  </Text>
                  <Card withBorder radius='md' p='md' bg='gray.0'>
                    <Group>
                      <IconBuilding size={16} />
                      <Text size='sm'>
                        {companies.find((c) => c.value === request?.id_company?.toString())
                          ?.label || request?.company}
                      </Text>
                    </Group>
                  </Card>
                </div>

                <div>
                  <Text fw={600} mb='xs'>
                    Asunto
                  </Text>
                  <Card withBorder radius='md' p='md' bg='gray.0'>
                    <Group>
                      <IconFileDescription size={16} />
                      <Text size='sm'>{request?.subject}</Text>
                    </Group>
                  </Card>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Fecha y Hora de Creación
                  </Text>
                  <Text size='sm'>
                    {new Intl.DateTimeFormat('es-CO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    }).format(
                      new Date(
                        new Date(request.created_at).getTime() + 5 * 60 * 60 * 1000 // +5 horas
                      )
                    )}
                  </Text>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Estado Actual
                  </Text>
                  <Badge
                    color={getStatusColor(request.status)}
                    size='lg'
                    radius='sm'
                    variant='light'
                    mt='xs'
                  >
                    {request.status}
                  </Badge>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Solicitante
                  </Text>
                  <Text size='sm'>{request.requester}</Text>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Tipo de Solicitud
                  </Text>
                  <Text size='sm'>{request.category}</Text>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Empresa
                  </Text>
                  <Text size='sm'>{request.company}</Text>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Descripción
                  </Text>
                  <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
                    <Text size='sm' className='whitespace-pre-line text-gray-700'>
                      {request.description}
                    </Text>
                  </Card>
                </div>

                <Divider />

                <div>
                  <Text fw={600} mb='xs'>
                    Información de la Solicitud
                  </Text>
                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Card withBorder radius='md' p='md' bg='gray.0'>
                        <Group>
                          <IconTag size={16} />
                          <div>
                            <Text size='xs' color='gray.6'>
                              Categoría
                            </Text>
                            <Text size='sm'>
                              {categories.find((c) => c.value === request?.category)?.label ||
                                request?.category}
                            </Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Card withBorder radius='md' p='md' bg='gray.0'>
                        <Group>
                          <IconProgress size={16} />
                          <div>
                            <Text size='xs' color='gray.6'>
                              Proceso
                            </Text>
                            <Text size='sm'>
                              {processCategories.find((p) => p.value === request?.process)?.label ||
                                request?.process}
                            </Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Card withBorder radius='md' p='md' bg='gray.0'>
                        <Group>
                          <IconFlag size={16} />
                          <div>
                            <Text size='xs' color='gray.6'>
                              Estado
                            </Text>
                            <Text size='sm'>{request?.status}</Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                  </Grid>
                </div>
              </Stack>
            </Card>
          </div>
        </div>

        {/* Actions */}
        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Group justify='flex-end'>
            <Button
              variant='outline'
              onClick={() => router.push('/process/request-general/create-request')}
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

export default function RequestsViewBoardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ViewRequestPage />
    </Suspense>
  );
}
