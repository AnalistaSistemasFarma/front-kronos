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
  Modal,
  ActionIcon,
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
  IconPlus,
  IconTrash,
  IconUser,
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

  // Estados para el modal de agregar tareas
  const [addTaskModalOpened, setAddTaskModalOpened] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({
    task: '',
    id_assigned_user: '',
    cost: 0,
    cost_center: '',
  });

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

  // Funciones para manejar tareas nuevas
  const handleAddTask = () => {
    if (!newTaskForm.task.trim()) return;

    const newTask: Task = {
      id: Date.now() * -1, // ID negativo para identificar que es nueva
      task: newTaskForm.task,
      active: 1,
      cost: newTaskForm.cost || 0,
      cost_center: newTaskForm.cost_center,
      assigned_user: users.find(u => u.value === newTaskForm.id_assigned_user)?.label || '',
      id_assigned_user: newTaskForm.id_assigned_user,
    };

    setEditedTasks([...editedTasks, newTask]);
    setNewTaskForm({ task: '', id_assigned_user: '', cost: 0, cost_center: '' });
    setAddTaskModalOpened(false);
  };

  const handleRemoveTask = (taskId: number) => {
    setEditedTasks(editedTasks.filter(t => t.id !== taskId));
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
      // Detectar qué cambió comparando con los valores originales
      const processChanged = 
        originalRequest?.process !== editedWorkflow.process ||
        originalRequest?.description !== editedWorkflow.description ||
        originalRequest?.active !== editedWorkflow.active ||
        originalRequest?.id_status_process !== editedWorkflow.id_status_process ||
        originalRequest?.id_assigned_process_category !== editedWorkflow.id_assigned_process_category;

      // Detectar tareas nuevas (ID negativo)
      const newTasks = editedTasks.filter(task => task.id < 0);
      
      // Detectar tareas eliminadas (están en originalTasks pero no en editedTasks)
      const deletedTaskIds = originalTasks
        .filter(origTask => !editedTasks.find(et => et.id === origTask.id))
        .map(t => t.id);
      
      // Detectar tareas actualizadas (ID positivo y cambiaron)
      const updatedTasks = editedTasks.filter(task => {
        if (task.id < 0) return false; // Es nueva, ya se procesó
        const originalTask = originalTasks.find(ot => ot.id === task.id);
        if (!originalTask) return false;
        return (
          originalTask.task !== task.task ||
          originalTask.active !== task.active ||
          originalTask.cost !== task.cost ||
          originalTask.cost_center !== task.cost_center ||
          originalTask.id_assigned_user !== task.id_assigned_user
        );
      });

      const tasksChanged = newTasks.length > 0 || deletedTaskIds.length > 0 || updatedTasks.length > 0;

      // Preparar el cuerpo de la petición
      const requestBody: any = {
        id_process: editedWorkflow.id,
      };

      // Solo incluir datos del proceso si cambió
      if (processChanged) {
        requestBody.process = editedWorkflow.process;
        requestBody.description = editedWorkflow.description;
        requestBody.active = editedWorkflow.active;
        requestBody.id_status = editedWorkflow.id_status_process;
        requestBody.id_user_assigned = editedWorkflow.id_assigned_process_category;
        requestBody.updateProcess = true;
      } else {
        requestBody.updateProcess = false;
      }

      // Solo incluir tareas si cambiaron
      if (tasksChanged) {
        const tasksToProcess = [
          // Tareas nuevas
          ...newTasks.map((task) => ({
            task: task.task,
            active: task.active,
            cost: task.cost,
            cost_center: task.cost_center,
            id_user_assigned: task.id_assigned_user,
            action: 'create',
          })),
          // Tareas actualizadas
          ...updatedTasks.map((task) => ({
            id: task.id,
            task: task.task,
            active: task.active,
            cost: task.cost,
            cost_center: task.cost_center,
            id_user_assigned: task.id_assigned_user,
            action: 'update',
          })),
          // Tareas eliminadas
          ...deletedTaskIds.map((id) => ({
            id,
            action: 'delete',
          })),
        ];
        requestBody.tasks = tasksToProcess;
        requestBody.updateTasks = true;
      } else {
        requestBody.updateTasks = false;
      }

      // Si nada cambió, mostrar mensaje y salir
      if (!processChanged && !tasksChanged) {
        setUpdateMessage({ type: 'success', text: 'No se detectaron cambios para guardar' });
        setIsEditing(false);
        setEditedWorkflow(null);
        setEditedTasks([]);
        return;
      }

      // Llamar al endpoint unificado
      const response = await fetch('/api/requests-general/update-workflow-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar los cambios');
      }

      const result = await response.json();

      // Actualizar estados locales
      setWorkflow(editedWorkflow);
      setTasks(editedTasks);
      
      // Mostrar mensaje específico según lo que se actualizó
      setUpdateMessage({ 
        type: 'success', 
        text: result.message || 'Cambios guardados correctamente' 
      });
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
              <Group mb='md' justify='space-between'>
                <Group>
                  <Box
                    className='bg-amber-500 p-2 rounded-lg'
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <IconListCheck size={24} color='white' />
                  </Box>
                  <Title order={2} className='text-amber-700'>
                    Flujo de Actividades
                  </Title>
                </Group>
                <Group>
                  <Badge color='amber' size='lg' variant='light'>
                    {isEditing ? editedTasks.length : tasks.length} {((isEditing ? editedTasks.length : tasks.length) === 1) ? 'tarea' : 'tareas'}
                  </Badge>
                  {isEditing && (
                    <Button
                      size='sm'
                      leftSection={<IconPlus size={16} />}
                      onClick={() => setAddTaskModalOpened(true)}
                      color='blue'
                      variant='light'
                    >
                      Agregar Tarea
                    </Button>
                  )}
                </Group>
              </Group>

              <LoadingOverlay
                visible={loadingTasks}
                zIndex={1000}
                overlayProps={{ radius: 'sm', blur: 2 }}
              />

              {(isEditing ? editedTasks.length === 0 : tasks.length === 0) && !loadingTasks ? (
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  title='Sin tareas'
                  color='gray'
                  variant='light'
                >
                  Este flujo de trabajo no tiene tareas asignadas.
                  {isEditing && (
                    <Button
                      size='xs'
                      mt='sm'
                      leftSection={<IconPlus size={14} />}
                      onClick={() => setAddTaskModalOpened(true)}
                      color='blue'
                      variant='light'
                    >
                      Agregar primera tarea
                    </Button>
                  )}
                </Alert>
              ) : (
                <ScrollArea>
                  <div className='space-y-0'>
                    {(isEditing ? editedTasks : tasks).map((task, index) => (
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
                            ${task.id < 0 ? 'border-blue-400 border-dashed' : ''}
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

                            <Grid.Col span={{ base: 12, md: 10 }}>
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
                                  {isEditing && (
                                    <ActionIcon
                                      color='red'
                                      variant='subtle'
                                      size='lg'
                                      onClick={() => handleRemoveTask(task.id)}
                                      title='Eliminar tarea'
                                    >
                                      <IconTrash size={18} />
                                    </ActionIcon>
                                  )}
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

                        {index < (isEditing ? editedTasks.length : tasks.length) - 1 && (
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

        {/* Modal para agregar nueva tarea */}
        <Modal
          opened={addTaskModalOpened}
          onClose={() => {
            setAddTaskModalOpened(false);
            setNewTaskForm({ task: '', id_assigned_user: '', cost: 0, cost_center: '' });
          }}
          title={
            <Group gap='sm'>
              <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100'>
                <IconPlus size={20} className='text-blue-600' />
              </div>
              <div>
                <Text size='lg' fw={600} className='text-gray-900'>
                  Agregar Nueva Tarea
                </Text>
                <Text size='xs' c='gray.5'>
                  Complete los campos para agregar una tarea
                </Text>
              </div>
            </Group>
          }
          size='lg'
          radius='lg'
          overlayProps={{ blur: 4 }}
          centered
          classNames={{
            header: 'border-b border-gray-100 pb-4',
            body: 'pt-4',
          }}
        >
          <Stack gap='lg'>
            <Grid>
              <Grid.Col span={12}>
                <TextInput
                  label='Nombre de la Tarea'
                  placeholder='Ingrese el nombre de la tarea'
                  value={newTaskForm.task}
                  onChange={(e) => setNewTaskForm({ ...newTaskForm, task: e.target.value })}
                  required
                  leftSection={<IconListCheck size={16} />}
                  size='lg'
                  classNames={{
                    label: 'text-sm font-medium text-gray-700 mb-2',
                    input: 'min-h-[48px] text-base',
                  }}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Asignado a'
                  placeholder='Seleccione un usuario'
                  data={users}
                  value={newTaskForm.id_assigned_user}
                  onChange={(value) => setNewTaskForm({ ...newTaskForm, id_assigned_user: value || '' })}
                  leftSection={<IconUser size={16} />}
                  searchable
                  clearable
                  size='lg'
                  classNames={{
                    label: 'text-sm font-medium text-gray-700 mb-2',
                    input: 'min-h-[48px] text-base',
                  }}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <NumberInput
                  label='Costo'
                  placeholder='0'
                  value={newTaskForm.cost || undefined}
                  onChange={(value) => setNewTaskForm({ ...newTaskForm, cost: Number(value) || 0 })}
                  min={0}
                  decimalScale={2}
                  hideControls
                  leftSection={<IconCoin size={16} />}
                  size='lg'
                  classNames={{
                    label: 'text-sm font-medium text-gray-700 mb-2',
                    input: 'min-h-[48px] text-base',
                  }}
                />
              </Grid.Col>

              <Grid.Col span={12}>
                <Select
                  label='Centro de Costo'
                  placeholder='Seleccione el centro de costo'
                  data={[
                    { value: 'Abastecimiento y Comex', label: 'Abastecimiento y Comex' },
                    { value: 'Asuntos Regulatorios', label: 'Asuntos Regulatorios' },
                    { value: 'Diseño Grafico', label: 'Diseño Grafico' },
                    { value: 'Oficial de Cumplimiento', label: 'Oficial de Cumplimiento' },
                    { value: 'Operaciones y Finanzas', label: 'Operaciones y Finanzas' },
                    { value: 'Planeación', label: 'Planeación' },
                    { value: 'Dirección General', label: 'Dirección General' },
                    { value: 'Proyectos', label: 'Proyectos' },
                    { value: 'SST', label: 'SST' },
                    { value: 'Talento Humano', label: 'Talento Humano' },
                    { value: 'Tecnica', label: 'Tecnica' },
                    { value: 'Tecnología', label: 'Tecnología' }
                  ]}
                  value={newTaskForm.cost_center}
                  onChange={(value) => setNewTaskForm({ ...newTaskForm, cost_center: value || '' })}
                  leftSection={<IconMapPin size={16} />}
                  clearable
                  size='lg'
                  classNames={{
                    label: 'text-sm font-medium text-gray-700 mb-2',
                    input: 'min-h-[48px] text-base',
                  }}
                />
              </Grid.Col>
            </Grid>

            <Group justify='flex-end' gap='sm' mt='md'>
              <Button
                variant='outline'
                onClick={() => {
                  setAddTaskModalOpened(false);
                  setNewTaskForm({ task: '', id_assigned_user: '', cost: 0, cost_center: '' });
                }}
                className='cursor-pointer hover:bg-gray-50 transition-colors duration-200'
              >
                Cancelar
              </Button>
              <Button
                onClick={handleAddTask}
                disabled={!newTaskForm.task.trim()}
                className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
              >
                Agregar Tarea
              </Button>
            </Group>
          </Stack>
        </Modal>
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
