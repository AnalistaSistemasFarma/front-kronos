'use client';

import { Suspense, useEffect, useState } from 'react';
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
} from '@tabler/icons-react';
import Link from 'next/link';

interface Request {
  id: number;
  category: string;
  user: string;
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

function ViewRequestPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const [request, setRequest] = useState<Request | null>(null);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [originalRequest, setOriginalRequest] = useState<Request | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);

  useEffect(() => {
    const storedRequest = sessionStorage.getItem('selectedRequest');
    if (storedRequest) {
      const requestData = JSON.parse(storedRequest);
      setRequest(requestData);
      setOriginalRequest(requestData);
      setLoading(false);
    } else if (id) {
      fetch(`/api/requests-general/view-request?id=${id}`)
        .then((res) => {
          if (!res.ok) throw new Error('Error al cargar la solicitud');
          return res.json();
        })
        .then((data) => {
          setRequest(data);
          setOriginalRequest(data);
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
      fetchCompanies();
    }
  }, [request]);

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

  const fetchCompanies = async () => {
    try {
      setLoadingOptions(true);
      const response = await fetch('/api/requests-general/consult-request');

      if (response.ok) {
        const companiesData: { id_company: number; company: string }[] =
          await response.json();
        setCompanies(
          companiesData.map((comp) => ({ value: comp.id_company.toString(), label: comp.company }))
        );
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleFormChange = (field: string, value: string) => {
    setRequest((prev) => {
      if (!prev) return prev;
      const updatedRequest = { ...prev, [field]: value };
      return updatedRequest;
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
    if (originalRequest) {
      setRequest(originalRequest);
    }
    setIsEditing(false);
    setFormErrors({});
    setUpdateMessage(null);
  };

  const validateFields = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!request?.category) {
      errors.category = 'La categoría es requerida';
    }
    if (!request?.user) {
      errors.user = 'El usuario asignado es requerido';
    }
    if (!request?.id_company) {
      errors.id_company = 'La empresa es requerida';
    }
    if (!request?.description) {
      errors.description = 'La descripción es requerida';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleUpdateRequest = async () => {
    if (!validateFields()) {
      return;
    }

    setIsUpdating(true);
    setUpdateMessage(null);

    try {
      const updateData = {
        id: request?.id,
        status: request?.status,
        user: request?.user,
        id_company: request?.id_company,
        category: request?.category,
        descripcion: request?.description,
      };

      const response = await fetch('/api/requests-general/update-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al actualizar la solicitud');
      }

      const result = await response.json();
      setUpdateMessage({ type: 'success', text: 'Solicitud actualizada exitosamente' });
      
      setOriginalRequest(request);
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating request:', error);
      setUpdateMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error al actualizar la solicitud'
      });
    } finally {
      setIsUpdating(false);
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
                <IconFileDescription size={32} className='text-blue-6' />
                Solicitud #{request.id}
              </Title>
              <Text size='lg'>
                {request.category}
              </Text>
            </div>

            <Group>
              <Badge color={getStatusColor(request.status)} size='lg' radius='sm' variant='light'>
                {request.status}
              </Badge>
            </Group>
          </Flex>
        </Card>

        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card shadow='sm' p='xl' radius='md' withBorder className='bg-white h-full'>
              <Title order={3} mb='md' className='flex items-center gap-2'>
                <IconNote size={20} />
                Detalles de la Solicitud
              </Title>

              <Stack>
                <div>
                  <Text fw={600} mb='xs'>
                    Empresa
                  </Text>
                  <Select
                    label='Empresa Solicitante'
                    data={companies}
                    value={request?.id_company?.toString() || ''}
                    onChange={(val) => handleFormChange('id_company', val ?? '')}
                    leftSection={<IconBuilding size={16} />}
                    disabled={!isEditing || loadingOptions}
                    error={formErrors.id_company}
                  />
                </div>

                <div>
                  <Text fw={600} mb='xs'>
                    Descripción de la Solicitud
                  </Text>
                  <Card withBorder radius='md' p='md' bg='gray.0'>
                    <Text size='sm' className='whitespace-pre-line text-gray-700'>
                      {request?.description}
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
                      <Select
                        label='Categoría'
                        data={[{ value: request?.category || '', label: request?.category || '' }]}
                        value={request?.category || ''}
                        onChange={(val) => handleFormChange('category', val ?? '')}
                        leftSection={<IconTag size={16} />}
                        disabled={!isEditing}
                        error={formErrors.category}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Asignado a'
                        data={[
                          { value: 'Catalina Sanchez', label: 'Catalina Sanchez' },
                          { value: 'Camila Murillo', label: 'Camila Murillo' },
                          { value: 'Lina Ramirez', label: 'Lina Ramirez' },
                        ]}
                        value={request?.user || ''}
                        onChange={(val) => handleFormChange('user', val ?? '')}
                        leftSection={<IconUserCheck size={16} />}
                        disabled={!isEditing}
                        error={formErrors.user}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Estado'
                        data={[
                          { value: 'Pendiente', label: 'Pendiente' },
                          { value: 'En Progreso', label: 'En Progreso' },
                          { value: 'Completada', label: 'Completada' },
                        ]}
                        value={request?.status || ''}
                        onChange={(val) => handleFormChange('status', val ?? '')}
                        leftSection={<IconFlag size={16} />}
                        disabled={!isEditing}
                        error={formErrors.status}
                      />
                    </Grid.Col>
                  </Grid>
                </div>
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap='md'>
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
                      {new Date(request?.created_at).toISOString().split('T')[0]}
                    </Text>
                  </div>

                  <div>
                    <Text size='sm' color='gray.6'>
                      Solicitante
                    </Text>
                    <Text fw={500}>
                      {request?.requester}
                    </Text>
                  </div>

                  <div>
                    <Text size='sm' color='gray.6'>
                      Empresa
                    </Text>
                    <Text fw={500}>
                      {request?.company}
                    </Text>
                  </div>
                </Stack>
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
                  leftSection={<IconFileDescription size={16} />}
                >
                  Editar Solicitud
                </Button>
              ) : (
                <>
                  <Button
                    color='green'
                    onClick={handleUpdateRequest}
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
            </Group>

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
