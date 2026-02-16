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
}

interface Task {
  id: number;
  task: string;
  active: number;
  cost: number;
  cost_center: string;
  assigned_user: string;
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

  useEffect(() => {
    const storedWorkflow = sessionStorage.getItem('selectedRequest');
    if (storedWorkflow) {
      const workflowData = JSON.parse(storedWorkflow);
      setWorkflow(workflowData);
      setLoading(false);
    } else if (id) {
      // Si no hay datos en sessionStorage, podríamos hacer fetch aquí
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
        {/* Header con Breadcrumbs */}
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
              <Badge 
                color={getActiveColor(workflow.active)} 
                size='lg' 
                radius='sm' 
                variant='light'
              >
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

        {/* Contenido Principal - Esquema Jerárquico */}
        <Stack gap='lg'>
          
          {/* NIVEL 1: CATEGORÍA */}
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

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder radius='md' p='md' bg='white' className='h-full'>
                  <Stack gap='sm'>
                    <Group>
                      <IconBuilding size={18} className='text-gray-500' />
                      <Text size='sm' c='gray.6' fw={500}>Empresa</Text>
                    </Group>
                    <Text size='lg' fw={600} c='gray.8'>
                      {workflow.company}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder radius='md' p='md' bg='white' className='h-full'>
                  <Stack gap='sm'>
                    <Group>
                      <IconCategory size={18} className='text-gray-500' />
                      <Text size='sm' c='gray.6' fw={500}>Nombre de Categoría</Text>
                    </Group>
                    <Text size='lg' fw={600} c='gray.8'>
                      {workflow.category}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12 }}>
                <Card withBorder radius='md' p='md' bg='white'>
                  <Stack gap='sm'>
                    <Group>
                      <IconUserCheck size={18} className='text-gray-500' />
                      <Text size='sm' c='gray.6' fw={500}>Usuario Asignado a Categoría</Text>
                    </Group>
                    <Text size='lg' fw={600} c='gray.8'>
                      {workflow.assigned_category}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>
          </Card>

          {/* Conector visual */}
          <Flex justify='center' align='center'>
            <div className='w-1 h-8 bg-gradient-to-b from-indigo-300 to-teal-300 rounded-full'></div>
          </Flex>

          {/* NIVEL 2: PROCESO */}
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

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder radius='md' p='md' bg='white' className='h-full'>
                  <Stack gap='sm'>
                    <Group>
                      <IconProgress size={18} className='text-gray-500' />
                      <Text size='sm' c='gray.6' fw={500}>Nombre del Proceso</Text>
                    </Group>
                    <Text size='lg' fw={600} c='gray.8'>
                      {workflow.process}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder radius='md' p='md' bg='white' className='h-full'>
                  <Stack gap='sm'>
                    <Group>
                      <IconUserCheck size={18} className='text-gray-500' />
                      <Text size='sm' c='gray.6' fw={500}>Usuario Asignado al Proceso</Text>
                    </Group>
                    <Text size='lg' fw={600} c='gray.8'>
                      {workflow.assigned_process_category}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12 }}>
                <Card withBorder radius='md' p='md' bg='white'>
                  <Stack gap='sm'>
                    <Text size='sm' c='gray.6' fw={500}>Descripción</Text>
                    <Text size='md' c='gray.8' className='whitespace-pre-line'>
                      {workflow.description || 'Sin descripción'}
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder radius='md' p='md' bg='white'>
                  <Stack gap='sm'>
                    <Text size='sm' c='gray.6' fw={500}>Estado del Proceso</Text>
                    <Badge 
                      color={getStatusColor(workflow.status_process)} 
                      size='lg' 
                      variant='light'
                    >
                      {workflow.status_process}
                    </Badge>
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder radius='md' p='md' bg='white'>
                  <Stack gap='sm'>
                    <Text size='sm' c='gray.6' fw={500}>Activo</Text>
                    <Group gap='xs'>
                      {workflow.active === 1 ? (
                        <>
                          <IconCheck size={18} className='text-green-500' />
                          <Badge color='green' size='lg' variant='light'>Sí</Badge>
                        </>
                      ) : (
                        <>
                          <IconX size={18} className='text-gray-400' />
                          <Badge color='gray' size='lg' variant='light'>No</Badge>
                        </>
                      )}
                    </Group>
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>
          </Card>

          {/* Conector visual */}
          <Flex justify='center' align='center'>
            <div className='w-1 h-8 bg-gradient-to-b from-teal-300 to-amber-300 rounded-full'></div>
          </Flex>

          {/* NIVEL 3: TAREAS */}
          <Card 
            shadow='sm' 
            p='xl' 
            radius='md' 
            withBorder 
            className='bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200'
          >
            <Group mb='md'>
              <Box 
                className='bg-amber-500 p-2 rounded-lg'
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <IconListCheck size={24} color='white' />
              </Box>
              <Title order={2} className='text-amber-700'>
                Tareas
              </Title>
              <Badge color='amber' size='lg' variant='light' ml='auto'>
                {tasks.length} tareas
              </Badge>
            </Group>

            <LoadingOverlay visible={loadingTasks} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />

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
                <Table 
                  striped 
                  highlightOnHover 
                  withTableBorder 
                  withColumnBorders
                  className='bg-white'
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>#</Table.Th>
                      <Table.Th>Tarea</Table.Th>
                      <Table.Th>Asignado</Table.Th>
                      <Table.Th>Costo</Table.Th>
                      <Table.Th>Centro de Costo</Table.Th>
                      <Table.Th>Estado</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {tasks.map((task, index) => (
                      <Table.Tr key={task.id}>
                        <Table.Td>
                          <Text size='sm' fw={600} c='gray.7'>
                            {index + 1}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' fw={500}>
                            {task.task}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap='xs'>
                            <IconUserCheck size={14} className='text-gray-400' />
                            <Text size='sm'>
                              {task.assigned_user || 'Sin asignar'}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Group gap='xs'>
                            <IconCoin size={14} className='text-green-500' />
                            <Text size='sm' fw={500}>
                              {task.cost ? `$${task.cost.toLocaleString('es-CO')}` : '$0'}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Group gap='xs'>
                            <IconMapPin size={14} className='text-gray-400' />
                            <Text size='sm'>
                              {task.cost_center || 'N/A'}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge 
                            color={task.active === 1 ? 'green' : 'gray'} 
                            size='sm' 
                            variant='light'
                          >
                            {task.active === 1 ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Card>
        </Stack>

        {/* Footer con acciones */}
        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Group justify='space-between'>
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
