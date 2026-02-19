'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Title,
  Text,
  Badge,
  Button,
  Group,
  Card,
  Stack,
  Grid,
  Alert,
  LoadingOverlay,
  Breadcrumbs,
  Anchor,
  Flex,
  Table,
  Divider,
  ScrollArea,
  Box,
  Select,
  Textarea,
  TextInput,
  NumberInput,
  Switch,
} from '@mantine/core';
import {
  IconBuilding,
  IconChevronRight,
  IconAlertCircle,
  IconArrowLeft,
  IconCategory,
  IconProgress,
  IconListCheck,
  IconUserCheck,
  IconTicket,
  IconCoin,
  IconMapPin,
  IconCheck,
  IconX,
} from '@tabler/icons-react';
import Link from 'next/link';

interface WorkFlow {
  id: number;
  id_category: number;
  category: string;
  process: string;
  description: string;
  active: number;
  id_status_process: number;
  status_process: string;
  assigned_category: string;
  assigned_process_category: string;
  company: string;
  id_assigned_process_category: string;
}

interface Task {
  id: number;
  task: string;
  active: number;
  cost: number;
  cost_center: string;
  assigned_user: string;
  id_assigned_user: string;
}

function ViewWorkFlowPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const from = searchParams.get('from') || 'workflows';

  const [workflow, setWorkflow] = useState<WorkFlow | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [originalRequest, setOriginalRequest] = useState<WorkFlow | null>(null);
  const [originalTasks, setOriginalTasks] = useState<Task[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [canEdit, setCanEdit] = useState(false);

  // Estados para edición
  const [editedWorkflow, setEditedWorkflow] = useState<WorkFlow | null>(null);
  const [editedTasks, setEditedTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [statusOptions, setStatusOptions] = useState<{ value: string; label: string }[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const storedWorkflow = sessionStorage.getItem('selectedRequest');
    if (storedWorkflow) {
      const workflowData = JSON.parse(storedWorkflow);
      setWorkflow(workflowData);
      setLoading(false);
    } else if (id) {
      setError('No se encontraron datos del flujo de trabajo');
      setLoading(false);
    } else {
      setError('No se especificó un flujo de trabajo');
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (workflow?.id) {
      fetchTasks(workflow.id);
    }
  }, [workflow?.id]);

  // Cargar usuarios y estados al montar el componente
  useEffect(() => {
    fetchUsers();
    fetchStatusOptions();
  }, []);

  const fetchTasks = async (processId: number) => {
    try {
      setLoadingTasks(true);
      const response = await fetch(`/api/requests-general/workflow-tasks?id_process=${processId}`);

      if (!response.ok) {
        throw new Error('Error al cargar las tareas');
      }

      const data = await response.json();
      setTasks(data);
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/requests-general/consult-worflow');
      if (response.ok) {
        const data = await response.json();
        
        if (data.assignedUsers) {
          setUsers(
            data.assignedUsers.map((u: { id: number; name: string }) => ({
            value: u.id.toString(),
            label: u.name,
          }))
          );
        }
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const fetchStatusOptions = async () => {
    // Estados disponibles según la base de datos
    setStatusOptions([
      { value: '1', label: 'Activo' },
      { value: '2', label: 'Pendiente' },
      { value: '3', label: 'En progreso' },
      { value: '4', label: 'Completado' },
      { value: '5', label: 'Cancelado' },
      { value: '6', label: 'En borrador' },
    ]);
  };

  const handleStartEditing = () => {
    setOriginalRequest(workflow);
    setOriginalTasks([...tasks]);
    if (workflow) {
      setEditedWorkflow({ ...workflow });
    }
    setEditedTasks([...tasks]);
    setIsEditing(true);
    setUpdateMessage(null);
  };

  const handleCancelEditing = () => {
    if (originalRequest) {
      setWorkflow(originalRequest);
    }
    if (originalTasks.length > 0) {
      setTasks(originalTasks);
    }
    setEditedWorkflow(null);
    setEditedTasks([]);
    setIsEditing(false);
    setFormErrors({});
    setUpdateMessage(null);
  };

  const handleSaveChanges = async () => {
    if (!editedWorkflow) return;

    setIsSaving(true);
    try {
      // Guardar cambios del workflow
      const workflowResponse = await fetch('/api/requests-general/update-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_process: editedWorkflow.id,
          process: editedWorkflow.process,
          description: editedWorkflow.description,
          active: editedWorkflow.active,
          id_status: editedWorkflow.id_status_process,
          id_user_assigned: editedWorkflow.assigned_process_category,
        }),
      });

      if (!workflowResponse.ok) {
        const errorData = await workflowResponse.json();
        throw new Error(errorData.error || 'Error al guardar el workflow');
      }

      // Guardar cambios de las tareas
      const tasksToUpdate = editedTasks.map((task) => ({
        id: task.id,
        task: task.task,
        active: task.active,
        cost: task.cost,
        cost_center: task.cost_center,
        id_user_assigned: task.assigned_user,
        action: 'update',
      }));

      const tasksResponse = await fetch('/api/requests-general/update-workflow-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_process: editedWorkflow.id,
          tasks: tasksToUpdate,
        }),
      });

      if (!tasksResponse.ok) {
        const errorData = await tasksResponse.json();
        throw new Error(errorData.error || 'Error al guardar las tareas');
      }

      // Actualizar estados locales
      setWorkflow(editedWorkflow);
      setTasks(editedTasks);
      setUpdateMessage({ type: 'success', text: 'Cambios guardados correctamente' });
      setIsEditing(false);
      setEditedWorkflow(null);
      setEditedTasks([]);
    } catch (err: any) {
      console.error('Error saving changes:', err);
      setUpdateMessage({ type: 'error', text: err.message || 'Error al guardar los cambios' });
    } finally {
      setIsSaving(false);
    }
  };

  const getActiveColor = (active: number) => {
    return active === 1 ? 'green' : 'gray';
  };

  const getActiveText = (active: number) => {
    return active === 1 ? 'Activo' : 'Inactivo';
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pendiente':
        return 'yellow';
      case 'en progreso':
        return 'blue';
      case 'completado':
        return 'green';
      case 'cancelado':
        return 'red';
      default:
        return 'gray';
    }
  };

  const getCostCenter = (cost_center: string) => {
    switch (cost_center) {
      case '1':
        return 'Contabilidad';
      default:
        return 'Otro';
    }
  };

  const getBreadcrumbHref = (from: string) => {
    switch (from) {
      case 'workflows':
        return '/process/request-general/workflows';
      default:
        return '/process/request-general/workflows';
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Flujos de Trabajo', href: getBreadcrumbHref(from) },
    { title: 'Detalle del Flujo', href: '#' },
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
          <Text size='lg'>Cargando detalles del flujo de trabajo...</Text>
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
            onClick={() => router.push('/process/request-general/workflows')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver a Flujos de Trabajo
          </Button>
        </Card>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <Card shadow='sm' p='xl' radius='md' withBorder className='max-w-md'>
          <Text size='lg' fw={500} mb='md' className='text-center'>
            Flujo de trabajo no encontrado
          </Text>
          <Button
            fullWidth
            onClick={() => router.push('/process/request-general/workflows')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver a Flujos de Trabajo
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' className='bg-white'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3'
              >
                <IconProgress size={32} className='text-blue-6' />
                Flujo de Trabajo #{workflow.id}
              </Title>
              <Text size='lg' c='gray.7'>
                {workflow.process}
              </Text>
            </div>

            <Group>
              <Badge color={getActiveColor(workflow.active)} size='lg' radius='sm' variant='light'>
                {getActiveText(workflow.active)}
              </Badge>
              <Badge
                color={getStatusColor(workflow.status_process)}
                size='lg'
                radius='sm'
                variant='light'
              >
                {workflow.status_process}
              </Badge>
            </Group>
          </Flex>
        </Card>

        <Grid gutter='lg'>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap='lg'>
              <Card
                shadow='sm'
                p='xl'
                radius='md'
                withBorder
                className='bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200'
              >
                <Group mb='md'>
                  <Box
                    className='bg-indigo-500 p-2 rounded-lg'
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <IconCategory size={24} color='white' />
                  </Box>
                  <Title order={2} className='text-indigo-700'>
                    Categoría
                  </Title>
                </Group>

                <Stack gap='md'>
                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Group>
                        <IconBuilding size={18} className='text-gray-500' />
                        <Text size='sm' c='gray.6' fw={500}>
                          Empresa
                        </Text>
                      </Group>
                      <Text size='lg' fw={600} c='gray.8'>
                        {workflow.company}
                      </Text>
                    </Stack>
                  </Card>

                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Group>
                        <IconCategory size={18} className='text-gray-500' />
                        <Text size='sm' c='gray.6' fw={500}>
                          Nombre de Categoría
                        </Text>
                      </Group>
                      <Text size='lg' fw={600} c='gray.8'>
                        {workflow.category}
                      </Text>
                    </Stack>
                  </Card>
                </Stack>
              </Card>

              <Flex justify='center' align='center'>
                <div className='w-1 h-8 bg-gradient-to-b from-indigo-300 to-teal-300 rounded-full'></div>
              </Flex>

              <Card
                shadow='sm'
                p='xl'
                radius='md'
                withBorder
                className='bg-gradient-to-r from-teal-50 to-green-50 border-teal-200'
              >
                <Group mb='md'>
                  <Box
                    className='bg-teal-500 p-2 rounded-lg'
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <IconProgress size={24} color='white' />
                  </Box>
                  <Title order={2} className='text-teal-700'>
                    Proceso
                  </Title>
                </Group>

                <Stack gap='md'>
                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Group>
                        <IconProgress size={18} className='text-gray-500' />
                        <Text size='sm' c='gray.6' fw={500}>
                          Nombre del Proceso
                        </Text>
                      </Group>
                      <Text size='lg' fw={600} c='gray.8'>
                        {workflow.process}
                      </Text>
                    </Stack>
                  </Card>

                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Group>
                        <IconUserCheck size={18} className='text-gray-500' />
                        <Text size='sm' c='gray.6' fw={500}>
                          Usuario Asignado al Proceso
                        </Text>
                      </Group>
                      {isEditing ? (
                        <Select
                          value={editedWorkflow?.id_assigned_process_category || ''}
                          onChange={(value) =>
                            setEditedWorkflow((prev) =>
                              prev ? { ...prev, id_assigned_process_category: value || '' } : prev
                            )
                          }
                          data={users}
                          placeholder='Seleccionar usuario'
                          searchable
                          clearable
                        />
                      ) : (
                        <Text size='lg' fw={600} c='gray.8'>
                          {workflow.assigned_process_category}
                        </Text>
                      )}
                    </Stack>
                  </Card>

                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Text size='sm' c='gray.6' fw={500}>
                        Descripción
                      </Text>
                      {isEditing ? (
                        <Textarea
                          value={editedWorkflow?.description || ''}
                          onChange={(e) =>
                            setEditedWorkflow((prev) =>
                              prev ? { ...prev, description: e.target.value } : prev
                            )
                          }
                          placeholder='Ingrese la descripción'
                          minRows={3}
                          autosize
                        />
                      ) : (
                        <Text size='md' c='gray.8' className='whitespace-pre-line'>
                          {workflow.description || 'Sin descripción'}
                        </Text>
                      )}
                    </Stack>
                  </Card>

                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Text size='sm' c='gray.6' fw={500}>
                        Estado del Proceso
                      </Text>
                      <Badge
                        color={getStatusColor(workflow.status_process)}
                        size='lg'
                        variant='light'
                      >
                        {workflow.status_process}
                      </Badge>
                    </Stack>
                  </Card>

                  <Card withBorder radius='md' p='md' bg='white'>
                    <Stack gap='sm'>
                      <Text size='sm' c='gray.6' fw={500}>
                        Activo
                      </Text>
                      {isEditing ? (
                        <Switch
                          checked={editedWorkflow?.active === 1}
                          onChange={(e) =>
                            setEditedWorkflow((prev) =>
                              prev ? { ...prev, active: e.target.checked ? 1 : 0 } : prev
                            )
                          }
                          label={editedWorkflow?.active === 1 ? 'Sí' : 'No'}
                          color='green'
                        />
                      ) : (
                        <Group gap='xs'>
                          {workflow.active === 1 ? (
                            <>
                              <IconCheck size={18} className='text-green-500' />
                              <Badge color='green' size='lg' variant='light'>
                                Sí
                              </Badge>
                            </>
                          ) : (
                            <>
                              <IconX size={18} className='text-gray-400' />
                              <Badge color='gray' size='lg' variant='light'>
                                No
                              </Badge>
                            </>
                          )}
                        </Group>
                      )}
                    </Stack>
                  </Card>
                </Stack>
              </Card>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card
              shadow='sm'
              p='xl'
              radius='md'
              withBorder
              className='bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 h-full'
            >
              <Group mb='md'>
                <Box
                  className='bg-amber-500 p-2 rounded-lg'
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <IconListCheck size={24} color='white' />
                </Box>
                <Title order={2} className='text-amber-700'>
                  Flujo de Actividades
                </Title>
                <Badge color='amber' size='lg' variant='light' ml='auto'>
                  {tasks.length} {tasks.length === 1 ? 'tarea' : 'tareas'}
                </Badge>
              </Group>

              <LoadingOverlay
                visible={loadingTasks}
                zIndex={1000}
                overlayProps={{ radius: 'sm', blur: 2 }}
              />

              {tasks.length === 0 && !loadingTasks ? (
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  title='Sin tareas'
                  color='gray'
                  variant='light'
                >
                  Este flujo de trabajo no tiene tareas asignadas.
                </Alert>
              ) : (
                <ScrollArea>
                  <div className='space-y-0'>
                    {tasks.map((task, index) => (
                      <div key={task.id} className='relative'>
                        <Card
                          shadow='sm'
                          p='md'
                          radius='lg'
                          withBorder
                          className={`
                            transition-all duration-200 ease-in-out
                            ${
                              task.active === 1
                                ? 'bg-white border-amber-300 hover:border-amber-400 hover:shadow-md'
                                : 'bg-gray-50 border-gray-200 opacity-75'
                            }
                            cursor-pointer
                          `}
                        >
                          <Grid>
                            <Grid.Col span={{ base: 12, md: 1 }}>
                              <div
                                className={`
                                  w-12 h-12 rounded-full flex items-center justify-center
                                  transition-all duration-200
                                  ${
                                    task.active === 1
                                      ? 'bg-amber-500 text-white shadow-lg shadow-amber-200'
                                      : 'bg-gray-300 text-gray-600'
                                  }
                                `}
                              >
                                <Text size='lg' fw={700}>
                                  {index + 1}
                                </Text>
                              </div>
                            </Grid.Col>

                            <Grid.Col span={{ base: 12, md: 11 }}>
                              <Stack gap='xs'>
                                <Group justify='space-between' align='flex-start'>
                                  <div style={{ flex: 1 }}>
                                    {isEditing ? (
                                      <TextInput
                                        value={editedTasks[index]?.task || ''}
                                        onChange={(e) => {
                                          const newTasks = [...editedTasks];
                                          newTasks[index] = { ...newTasks[index], task: e.target.value };
                                          setEditedTasks(newTasks);
                                        }}
                                        placeholder='Nombre de la tarea'
                                      />
                                    ) : (
                                      <Text size='md' fw={600} c='gray.9' className='mb-1'>
                                        {task.task}
                                      </Text>
                                    )}
                                  </div>
                                </Group>

                                <Grid mt='sm'>
                                  <Grid.Col span={{ base: 12, sm: 4 }}>
                                    <div className='bg-gray-50 rounded-lg p-3 transition-colors duration-200 hover:bg-gray-100'>
                                      <Group gap='xs' mb='1'>
                                        <IconUserCheck size={16} className='text-gray-500' />
                                        <Text size='xs' c='gray.6' fw={500} className='uppercase'>
                                          Asignado a
                                        </Text>
                                      </Group>
                                      {isEditing ? (
                                        <Select
                                          value={editedTasks[index]?.id_assigned_user || ''}
                                          onChange={(value) => {
                                            const newTasks = [...editedTasks];
                                            newTasks[index] = { ...newTasks[index], id_assigned_user: value || '' };
                                            setEditedTasks(newTasks);
                                          }}
                                          data={users}
                                          placeholder='Seleccionar usuario'
                                          searchable
                                          clearable
                                          size='sm'
                                        />
                                      ) : (
                                        <Text size='sm' fw={500} c='gray.8'>
                                          {task.assigned_user || 'Sin asignar'}
                                        </Text>
                                      )}
                                    </div>
                                  </Grid.Col>

                                  <Grid.Col span={{ base: 12, sm: 4 }}>
                                    <div className='bg-gray-50 rounded-lg p-3 transition-colors duration-200 hover:bg-gray-100'>
                                      <Group gap='xs' mb='1'>
                                        <IconCoin size={16} className='text-green-600' />
                                        <Text size='xs' c='gray.6' fw={500} className='uppercase'>
                                          Costo
                                        </Text>
                                      </Group>
                                      {isEditing ? (
                                        <NumberInput
                                          value={editedTasks[index]?.cost || 0}
                                          onChange={(value) => {
                                            const newTasks = [...editedTasks];
                                            newTasks[index] = { ...newTasks[index], cost: Number(value) || 0 };
                                            setEditedTasks(newTasks);
                                          }}
                                          placeholder='Costo'
                                          min={0}
                                          size='sm'
                                          hideControls
                                        />
                                      ) : (
                                        <Text size='sm' fw={600} c='green-700'>
                                          {task.cost ? `$${task.cost.toLocaleString('es-CO')}` : '$0'}
                                        </Text>
                                      )}
                                    </div>
                                  </Grid.Col>

                                  <Grid.Col span={{ base: 12, sm: 4 }}>
                                    <div className='bg-gray-50 rounded-lg p-3 transition-colors duration-200 hover:bg-gray-100'>
                                      <Group gap='xs' mb='1'>
                                        <IconMapPin size={16} className='text-gray-500' />
                                        <Text size='xs' c='gray.6' fw={500} className='uppercase'>
                                          Centro de Costo
                                        </Text>
                                      </Group>
                                      {isEditing ? (
                                        <>
                                        <Select
                                          value={editedTasks[index]?.cost_center || ''}
                                          onChange={(value) => {
                                            const newTasks = [...editedTasks];
                                            newTasks[index] = { ...newTasks[index], cost_center: value || '' };
                                            setEditedTasks(newTasks);
                                          }}
                                          data={[{ value: '1', label: 'Contabilidad' }]}
                                          placeholder='Seleccione el centro de costo'
                                          searchable
                                          clearable
                                          size='sm'
                                        />
                                        </>
                                      ) : (
                                        <Text size='sm' fw={500} c='gray.8'>
                                          {getCostCenter(task.cost_center) || 'N/A'}
                                        </Text>
                                      )}
                                    </div>
                                  </Grid.Col>
                                </Grid>
                              </Stack>
                            </Grid.Col>
                          </Grid>
                        </Card>

                        {index < tasks.length - 1 && (
                          <div className='flex justify-center py-3'>
                            <div
                              className={`
                                w-1 h-12 rounded-full transition-all duration-300
                                ${
                                  task.active === 1
                                    ? 'bg-gradient-to-b from-amber-400 to-amber-200'
                                    : 'bg-gray-300'
                                }
                              `}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </Card>
          </Grid.Col>
        </Grid>

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          {updateMessage && (
            <Alert
              color={updateMessage.type === 'success' ? 'green' : 'red'}
              mb='md'
              icon={
                updateMessage.type === 'success' ? (
                  <IconCheck size={16} />
                ) : (
                  <IconAlertCircle size={16} />
                )
              }
            >
              {updateMessage.text}
            </Alert>
          )}
          
          <Group justify='space-between'>
            {!isEditing ? (
              <Button
                color='blue'
                onClick={handleStartEditing}
                leftSection={<IconTicket size={16} />}
              >
                Editar Flujo de Trabajo
              </Button>
            ) : (
              <>
                <Button
                  color='green'
                  onClick={handleSaveChanges}
                  leftSection={<IconCheck size={16} />}
                  loading={isSaving}
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

            <Button
              variant='outline'
              onClick={() => router.push('/process/request-general/workflows')}
              leftSection={<IconArrowLeft size={16} />}
            >
              Volver a Flujos de Trabajo
            </Button>
          </Group>
        </Card>
      </div>
    </div>
  );
}

export default function ViewWorkFlowPageWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ViewWorkFlowPage />
    </Suspense>
  );
}
