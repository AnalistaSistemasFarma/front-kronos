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
  Modal,
  Stack,
  TextInput,
  Select,
  Grid,
  Alert,
  LoadingOverlay,
  Breadcrumbs,
  Anchor,
  Flex,
  ActionIcon,
  Textarea,
  Box,
  Collapse,
  Table,
  Divider,
  NumberInput,
  ScrollArea,
  Tooltip,
} from '@mantine/core';
import {
  IconUser,
  IconPlus,
  IconBuilding,
  IconChevronRight,
  IconAlertCircle,
  IconCheck,
  IconX,
  IconFlag,
  IconTicket,
  IconFilter,
  IconRefresh,
  IconProgress,
  IconUserCheck,
  IconFileDescription,
  IconTag,
  IconTrash,
  IconList,
  IconListCheck,
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../components/email/utils/sendMessage';

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

function RequestBoard() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [userIdInitialized, setUserIdInitialized] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [workFlows, setWorkFlow] = useState<WorkFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    company: '',
    usuario: '',
    descripcion: '',
    category: '',
    process: '',
    costCenter: '',
    assignedProcess: '',
  });

  const [companies, setCompany] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [processes, setProcess] = useState<{ value: string; label: string }[]>([]);
  const [categoriesWF, setCategoriesWF] = useState<{ value: string; label: string }[]>([]);
  const [processesWF, setProcessWF] = useState<{ value: string; label: string }[]>([]);
  const [modalOpened, setModalOpened] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [createLoading, setCreateLoading] = useState(false);
  const [formDataLoading, setFormDataLoading] = useState(false);
  const [formDataError, setFormDataError] = useState<string | null>(null);

  const [assignedUsers, setAssignedUsers] = useState<{ value: string; label: string }[]>([]);

  const [idUser, setIdUser] = useState('');

  const [filters, setFilters] = useState({
    status: '',
    company: '',
    category: '',
    process: '',
    active: '',
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Estados para el manejo de tareas
  const [tasks, setTasks] = useState<
    Array<{
      id: string;
      tarea: string;
      asignado: string;
      costo: number;
      centroCosto: string;
    }>
  >([]);
  const [taskForm, setTaskForm] = useState({
    tarea: '',
    asignado: '',
    costo: '',
    centroCosto: '',
  });

  // Funciones para manejar tareas
  const addTask = () => {
    if (!taskForm.tarea.trim()) return;

    setTasks([
      ...tasks,
      {
        id: Date.now().toString(),
        tarea: taskForm.tarea,
        asignado: taskForm.asignado,
        costo: parseFloat(taskForm.costo) || 0,
        centroCosto: taskForm.centroCosto,
      },
    ]);

    setTaskForm({ tarea: '', asignado: '', costo: '', centroCosto: '' });
  };

  const removeTask = (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id));
  };

  const [workflowData, setWorkflowData] = useState<{
    categories: Array<{
      id_company: number;
      id_category: number;
      company: string;
      category: string;
      id_assigned_category: number;
      assigned_category: string;
    }>;
    processCategories: Array<{
      id_process_category: number;
      process: string;
      id_assigned: number;
      assigned_process: string;
    }>;
    assignedUsers: Array<{ id: number; name: string }>;
  }>({ categories: [], processCategories: [], assignedUsers: [] });

  // Estados para modales de creación
  const [categoryModalOpened, setCategoryModalOpened] = useState(false);
  const [processModalOpened, setProcessModalOpened] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryAssigned, setNewCategoryAssigned] = useState('');
  const [newProcessName, setNewProcessName] = useState('');
  const [newProcessAssigned, setNewProcessAssigned] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingProcess, setCreatingProcess] = useState(false);

  // Estado para el asignado de categoría automático
  const [assignedCategoryInfo, setAssignedCategoryInfo] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Función para obtener datos de workflow por empresa
  const fetchWorkflowData = async (companyId?: string) => {
    try {
      setFormDataLoading(true);
      const url = companyId
        ? `/api/requests-general/consult-worflow?companyId=${companyId}`
        : '/api/requests-general/consult-worflow';

      const response = await fetch(url);
      const data = await response.json();

      setWorkflowData(data);

      // Mapear categorías para el Select
      if (data.categories && data.categories.length > 0) {
        setCategoriesWF(
          data.categories.map((c: { id_category: number; category: string }) => ({
            value: c.id_category.toString(),
            label: c.category,
          }))
        );
      } else {
        setCategoriesWF([]);
      }

      // Mapear procesos para el Select
      if (data.processCategories && data.processCategories.length > 0) {
        setProcessWF(
          data.processCategories.map((p: { id_process: number; process: string }) => ({
            value: p.id_process.toString(),
            label: p.process,
          }))
        );
      } else {
        setProcessWF([]);
      }

      // Mapear usuarios asignados
      if (data.assignedUsers) {
        setAssignedUsers(
          data.assignedUsers.map((u: { id: number; name: string }) => ({
            value: u.id.toString(),
            label: u.name,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching workflow data:', error);
    } finally {
      setFormDataLoading(false);
    }
  };

  const handleCompanyChange = (value: string | null) => {
    const companyValue = value || '';
    setFormData({
      ...formData,
      company: companyValue,
      category: '',
      process: '',
    });
    setAssignedCategoryInfo(null);
    setCategoriesWF([]);
    setProcessWF([]);

    if (companyValue) {
      fetchWorkflowData(companyValue);
    }
  };

  // Función para manejar cambio de categoría
  const handleCategoryChange = (value: string | null) => {
    const categoryValue = value || '';
    const selectedCategory = workflowData.categories.find(
      (c) => c.id_category.toString() === categoryValue
    );

    setFormData({
      ...formData,
      category: categoryValue,
      process: '',
    });

    if (selectedCategory) {
      setAssignedCategoryInfo({
        id: selectedCategory.id_assigned_category.toString(),
        name: selectedCategory.assigned_category,
      });
    } else {
      setAssignedCategoryInfo(null);
    }
  };

  // Función para crear categoría
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !newCategoryAssigned || !formData.company) return;

    console.log('asignado categoria' + newCategoryAssigned);

    setCreatingCategory(true);

    const assignedUserId = newCategoryAssigned;

    console.log('asignado categoria' + assignedUserId);

    try {
      const response = await fetch('/api/requests-general/create-category-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: newCategoryName,
          id_user: assignedUserId,
          id_company: parseInt(formData.company),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error al crear la categoría');
      }

      // Cerrar modal y limpiar campos
      setCategoryModalOpened(false);
      setNewCategoryName('');
      setNewCategoryAssigned('');

      // Refrescar categorías
      await fetchWorkflowData(formData.company);

      // Seleccionar la nueva categoría automáticamente
      // El ID vendría en la respuesta del endpoint
      if (data.id_request) {
        setFormData((prev) => ({
          ...prev,
          category: data.id_request.toString(),
        }));
        // Actualizar el asignado de categoría usando el valor guardado
        const assignedUser = assignedUsers.find((u) => u.value === assignedUserId);
        if (assignedUser) {
          setAssignedCategoryInfo({
            id: assignedUser.value,
            name: assignedUser.label,
          });
        }
      }
    } catch (error) {
      console.error('Error creating category:', error);
      setFormDataError(error instanceof Error ? error.message : 'Error al crear la categoría');
    } finally {
      setCreatingCategory(false);
    }
  };

  // Función para crear proceso (placeholder - el usuario implementará el endpoint)
  const handleCreateProcess = async () => {
    if (!newProcessName.trim()) return;

    setCreatingProcess(true);
    // Placeholder: Aquí iría la llamada al endpoint para crear proceso
    // Por ahora solo cerramos el modal y refrescamos
    console.log(
      'Crear proceso:',
      newProcessName,
      'asignado a:',
      newProcessAssigned,
      'para categoría:',
      formData.category
    );

    // Simular creación exitosa
    setTimeout(() => {
      setProcessModalOpened(false);
      setNewProcessName('');
      setNewProcessAssigned('');
      fetchWorkflowData(formData.company); // Refrescar procesos
      setCreatingProcess(false);
    }, 500);
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchCompanies();
    fetchConsultsWorkFlows();
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
            fetchWorkFlowsWithUserId(id, filters);
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

  const fetchWorkFlows = async () => {
    if (!userId) {
      console.log('fetchWorkFlows: No se puede ejecutar sin userId');
      return;
    }
    await fetchWorkFlowsWithUserId(userId, filters);
  };

  const fetchWorkFlowsWithUserId = async (userIdToUse: number, filtersToUse?: typeof filters) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('idUser', userIdToUse.toString());

      if (filtersToUse) {
        if (filtersToUse.status) params.append('status', filtersToUse.status);
        if (filtersToUse.company) params.append('company', filtersToUse.company);
        if (filtersToUse.category) params.append('category', filtersToUse.category);
        if (filtersToUse.process) params.append('process', filtersToUse.process);
        if (filtersToUse.active) params.append('active', filtersToUse.active);
      }

      const url = `/api/requests-general/workflow-assigned?${params.toString()}`;

      const response = await fetch(url);

      if (!response.ok) throw new Error('Failed to fetch assigned workflows');

      const data = await response.json();
      console.log(
        'fetchWorkFlowsWithUserId: Flujos de trabajo asignados recibidos:',
        data.length,
        'workFlows'
      );
      setWorkFlow(data);
    } catch (err) {
      console.error('Error fetching assigned workflows:', err);
      setError('Unable to load assigned workflows. Please try again.');
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

        if (data.companies && Array.isArray(data.companies)) {
          setCompany(
            data.companies.map((sub: { id_company: number; company: string }) => ({
              value: sub.id_company.toString(),
              label: sub.company,
            }))
          );
        } else {
          console.error('Frontend - fetchCompanies: companies data is not an array or missing');
          setCompany([]);
        }
        if (data.processCategories && Array.isArray(data.processCategories)) {
          setProcess(
            data.processCategories.map((sub: { id_process: number; process: string }) => ({
              value: sub.id_process.toString(),
              label: sub.process,
            }))
          );
        } else {
          console.error(
            'Frontend - fetchCompanies: processCategories data is not an array or missing'
          );
          setProcess([]);
        }
        if (data.categories && Array.isArray(data.categories)) {
          setCategories(
            data.categories.map((sub: { id: number; category: string }) => ({
              value: sub.id.toString(),
              label: sub.category,
            }))
          );
        } else {
          console.error('Frontend - fetchCompanies: categories data is not an array or missing');
          setCategories([]);
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

  const fetchConsultsWorkFlows = async () => {
    try {
      setLoading(true);

      const response = await fetch(`/api/requests-general/consult-worflow`);

      if (response.ok) {
        const data = await response.json();

        if (data.assignedUsers) {
          setAssignedUsers(
            data.assignedUsers.map((u: { id: number; name: string }) => ({
              value: u.id.toString(),
              label: u.name,
            }))
          );
        }
        if (data.processCategories && Array.isArray(data.processCategories)) {
          setProcessWF(
            data.processCategories.map((sub: { id_process: number; process: string }) => ({
              value: sub.id_process.toString(),
              label: sub.process,
            }))
          );
        } else {
          console.error(
            'Frontend - fetchCompanies: processCategories data is not an array or missing'
          );
          setProcessWF([]);
        }
        if (data.categories && Array.isArray(data.categories)) {
          setCategoriesWF(
            data.categories.map((sub: { id_category: number; category: string }) => ({
              value: sub.id_category.toString(),
              label: sub.category,
            }))
          );
        } else {
          console.error('Frontend - fetchCompanies: categories data is not an array or missing');
          setCategoriesWF([]);
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

  const handleCreateWorkFlowWithValidation = async () => {
    {
      /*
    if (!validateForm()) {
        return;
    }
    */
    }
    await handleCreateWorkFlow();
  };

  const handleCreateWorkFlow = async () => {
    try {
      setCreateLoading(true);

      // Preparar las tareas para enviar
      const tasksToSend = tasks.map((task) => ({
        id: task.id,
        task: task.tarea,
        id_user: task.asignado || null,
        cost: task.costo || 0,
        cost_center: task.centroCosto || null,
      }));

      console.log('asignados tareas ' + tasksToSend);

      console.log('asignado procesos ' + formData.assignedProcess);

      const response = await fetch('/api/requests-general/create-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_company: parseInt(formData.company),
          id_category: parseInt(formData.category),
          process: formData.process,
          task: tasksToSend.length > 0 ? tasksToSend : null,
          cost_center_pc: formData.costCenter || null,
          id_user: formData.assignedProcess ? formData.assignedProcess : userId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al crear el flujo de trabajo');
      }

      const result = await response.json();

      // Limpiar formulario
      setFormData({
        company: '',
        category: '',
        usuario: '',
        process: '',
        descripcion: '',
        costCenter: '',
        assignedProcess: '',
      });
      setTasks([]);
      setTaskForm({ tarea: '', asignado: '', costo: '', centroCosto: '' });
      setAssignedCategoryInfo(null);

      // Refrescar lista y cerrar modal
      fetchWorkFlows();
      setModalOpened(false);
    } catch (err) {
      console.error('Error creating workflow:', err);
      setError(err instanceof Error ? err.message : 'Error al crear el flujo de trabajo');
    } finally {
      setCreateLoading(false);
    }
  };

  const sendRequestEmailNotification = async (
    requestId: number,
    subject: string,
    processId: number
  ): Promise<boolean> => {
    if (!process.env.API_EMAIL) {
      console.error('Error: La variable de entorno API_EMAIL no está configurada');
      return false;
    }

    try {
      const selectedProcess = processes.find((p) => p.value === processId.toString());
      const assignedEmail = selectedProcess;

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
      case 'en borrador':
        return 'gray';
      case 'abierto':
        return 'green';
      case 'por autorizar':
        return 'yellow';
      default:
        return 'red';
    }
  };

  const getActiveColor = (active: number) => {
    switch (active) {
      case 1:
        return 'green';
      default:
        return 'red';
    }
  };

  const getActive = (active: number) => {
    switch (active) {
      case 1:
        return 'Activo';
      default:
        return 'Inactivo';
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Flujos de Trabajo', href: '#' },
    { title: 'Proceso', href: '#' },
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
                Flujos de Trabajo Asignados
              </Title>
              <Text size='lg' c='gray.6'>
                Gestión de Flujos de Trabajo asignados a ti
              </Text>
            </div>

            <Button
              onClick={() => setModalOpened(true)}
              size='lg'
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
            >
              Crear Flujo De Trabajo
            </Button>
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconTicket size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' c='blue.6'>
                      Total de Flujos de Trabajo
                    </Text>
                    <Text size='lg' fw={600}>
                      {workFlows.length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-gray-50 border-blue-200'>
                <Group>
                  <IconProgress size={24} className='text-gray-500' />
                  <div>
                    <Text size='xs' c='blue.6'>
                      En Borrador
                    </Text>
                    <Text size='lg' fw={600}>
                      {
                        workFlows.filter((t) => t.status_process?.toLowerCase() === 'en borrador')
                          .length
                      }
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-yellow-50 border-blue-200'>
                <Group>
                  <IconProgress size={24} className='text-yellow-500' />
                  <div>
                    <Text size='xs' c='blue.6'>
                      Por Autorizar
                    </Text>
                    <Text size='lg' fw={600}>
                      {
                        workFlows.filter((t) => t.status_process?.toLowerCase() === 'por autorizar')
                          .length
                      }
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
                      Abiertos
                    </Text>
                    <Text size='lg' fw={600}>
                      {
                        workFlows.filter((t) => t.status_process?.toLowerCase() === 'abierto')
                          .length
                      }
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
                      { value: '0', label: 'Todos' },
                      { value: '1', label: 'Abierto' },
                      { value: '3', label: 'Cancelado' },
                      { value: '6', label: 'En Borrador' },
                      { value: '5', label: 'Por Autorizar' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '')}
                    leftSection={<IconFlag size={16} />}
                    size='md'
                    classNames={{
                      label: 'text-sm font-medium text-gray-700 mb-2',
                      input: 'min-h-[44px] text-base',
                    }}
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
                    size='md'
                    classNames={{
                      label: 'text-sm font-medium text-gray-700 mb-2',
                      input: 'min-h-[44px] text-base',
                    }}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Categoria'
                    placeholder='Todas las categorias'
                    clearable
                    data={categories}
                    value={filters.category}
                    onChange={(value) => handleFilterChange('category', value || '')}
                    leftSection={<IconBuilding size={16} />}
                    size='md'
                    classNames={{
                      label: 'text-sm font-medium text-gray-700 mb-2',
                      input: 'min-h-[44px] text-base',
                    }}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Proceso'
                    placeholder='Todas los procesos'
                    clearable
                    data={processes}
                    value={filters.process}
                    onChange={(value) => handleFilterChange('process', value || '')}
                    leftSection={<IconBuilding size={16} />}
                    size='md'
                    classNames={{
                      label: 'text-sm font-medium text-gray-700 mb-2',
                      input: 'min-h-[44px] text-base',
                    }}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Vigencia'
                    placeholder='Activo / Inactivo'
                    clearable
                    data={[
                      { value: '1', label: 'Activo' },
                      { value: '0', label: 'Inactivo' },
                    ]}
                    value={filters.active}
                    onChange={(value) => handleFilterChange('active', value || '')}
                    leftSection={<IconFlag size={16} />}
                    size='md'
                    classNames={{
                      label: 'text-sm font-medium text-gray-700 mb-2',
                      input: 'min-h-[44px] text-base',
                    }}
                  />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={() => {
                    const clearedFilters = {
                      status: '',
                      company: '',
                      category: '',
                      process: '',
                      active: '',
                    };
                    setFilters(clearedFilters);
                    if (userId) {
                      fetchWorkFlowsWithUserId(userId, clearedFilters);
                    }
                  }}
                  leftSection={<IconX size={16} />}
                >
                  Limpiar Filtros
                </Button>
                <Button onClick={fetchWorkFlows} leftSection={<IconRefresh size={16} />}>
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
            Lista de Flujos de Trabajo Asignados
          </Title>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Categoria</Table.Th>
                  <Table.Th>Asignado Categoria</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Asignado Proceso</Table.Th>
                  <Table.Th>Activo</Table.Th>
                  <Table.Th>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {workFlows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconTicket size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          No se encontraron flujos de trabajo asignados
                        </Text>
                        <Text size='sm' c='gray.5'>
                          No tienes flujos de trabajo asignados actualmente
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  workFlows.map((workflow) => (
                    <Table.Tr
                      key={workflow.id}
                      className='cursor-pointer hover:bg-gray-50 transition-colors'
                      onClick={() => {
                        sessionStorage.setItem('selectedRequest', JSON.stringify(workflow));
                        router.push(
                          `/process/request-general/view-workflows?id=${workflow.id}&from=workflows`
                        );
                      }}
                    >
                      <Table.Td>
                        <Text size='xs' color='blue' className='max-w-xs truncate' lineClamp={2}>
                          {workflow.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} className='flex'>
                          <IconBuilding size={12} className='text-gray-400' />
                          <Text size='sm' className='max-w-xs truncate'>
                            {workflow.company}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' className='max-w-xs truncate'>
                          {workflow.category}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconUserCheck size={14} className='text-gray-400' />
                          <Text size='sm'>{workflow.assigned_category}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' c='gray.7'>
                          {workflow.process}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <IconUserCheck size={14} className='text-gray-400' />
                          <Text size='sm'>{workflow.assigned_process_category}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getActiveColor(workflow.active)} variant='light' size='sm'>
                          {getActive(workflow.active)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={getStatusColor(workflow.status_process)}
                          variant='light'
                          size='sm'
                        >
                          {workflow.status_process}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>

        <Modal
          opened={modalOpened}
          onClose={() => {
            setModalOpened(false);
            setCurrentStep(1);
            setFormErrors({});
            setTasks([]);
            setTaskForm({ tarea: '', asignado: '', costo: '', centroCosto: '' });
          }}
          title={
            <Group gap='sm'>
              <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100'>
                <IconPlus size={20} className='text-blue-600' />
              </div>
              <div>
                <Text size='lg' fw={600} className='text-gray-900'>
                  Crear Flujo de Trabajo
                </Text>
                <Text size='xs' c='gray.5'>
                  Complete los campos obligatorios marcados con *
                </Text>
              </div>
            </Group>
          }
          size='70%'
          radius='lg'
          overlayProps={{ blur: 4 }}
          centered
          classNames={{
            header: 'border-b border-gray-100 pb-4',
            body: 'pt-4',
          }}
        >
          <LoadingOverlay visible={createLoading || formDataLoading} />

          {formDataError && (
            <Alert
              icon={<IconAlertCircle size={20} />}
              title='Error'
              color='red'
              mb='md'
              className='border-red-200 bg-red-50'
            >
              {formDataError}
            </Alert>
          )}

          {/* Stepper */}
          <div className='flex items-center justify-between mb-6 px-4 pt-4'>
            {[1, 2, 3].map((step) => (
              <div key={step} className='flex items-center flex-1'>
                <div className='flex items-center gap-3'>
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full border-2 font-semibold transition-all duration-200 ${
                      currentStep === step
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : currentStep > step
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'bg-white border-gray-300 text-gray-400'
                    }`}
                  >
                    {currentStep > step ? <IconCheck size={18} /> : step}
                  </div>
                  <div className='flex flex-col'>
                    <Text
                      size='sm'
                      fw={600}
                      className={
                        currentStep === step
                          ? 'text-blue-600'
                          : currentStep > step
                          ? 'text-green-600'
                          : 'text-gray-400'
                      }
                    >
                      {step === 1
                        ? 'Información General'
                        : step === 2
                        ? 'Categoría y Proceso'
                        : 'Tareas'}
                    </Text>
                    <Text size='xs' c='gray.5'>
                      {step === 1 ? 'Paso 1 de 3' : step === 2 ? 'Paso 2 de 3' : 'Paso 3 de 3'}
                    </Text>
                  </div>
                </div>
                {step < 3 && (
                  <div
                    className={`flex-1 h-0.5 mx-4 transition-colors duration-200 ${
                      currentStep > step ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <ScrollArea.Autosize mah='calc(100vh - 400px)'>
            {/* Paso 1: Información General */}
            {currentStep === 1 && (
              <div className='space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300'>
                <div className='bg-white rounded-lg border border-gray-200 p-6'>
                  <div className='mb-4'>
                    <Group gap='sm' mb={3}>
                      <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50'>
                        <IconFileDescription size={16} className='text-blue-600' />
                      </div>
                      <Text fw={600} size='md' className='text-gray-900'>
                        Paso 1: Información General
                      </Text>
                    </Group>
                    <Text size='sm' c='gray.6'>
                      Seleccione la empresa solicitante para comenzar el flujo de trabajo.
                    </Text>
                  </div>

                  <Grid>
                    <Grid.Col span={{ base: 12, md: 8 }}>
                      <Select
                        label='Empresa Solicitante *'
                        placeholder='Seleccione la empresa'
                        data={companies}
                        value={formData.company}
                        onChange={handleCompanyChange}
                        error={formErrors.company}
                        required
                        leftSection={<IconBuilding size={16} />}
                        disabled={formDataLoading}
                        size='lg'
                        classNames={{
                          label: 'text-sm font-medium text-gray-700 mb-2',
                          input: 'min-h-[48px] text-base',
                        }}
                      />
                    </Grid.Col>
                  </Grid>
                </div>
              </div>
            )}

            {/* Paso 2: Categoría y Proceso */}
            {currentStep === 2 && (
              <div className='space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300'>
                <div className='bg-white rounded-lg border border-gray-200 p-6 space-y-6'>
                  <div className='mb-2'>
                    <Group gap='sm' mb={3}>
                      <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50'>
                        <IconTag size={16} className='text-blue-600' />
                      </div>
                      <Text fw={600} size='md' className='text-gray-900'>
                        Paso 2: Categoría y Proceso
                      </Text>
                    </Group>
                    <Text size='sm' c='gray.6'>
                      Configure la categoría, proceso y asignados para este flujo de trabajo.
                    </Text>
                  </div>

                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <div className='flex gap-3'>
                        <div className='flex-1'>
                          <Select
                            label='Categoría'
                            placeholder={
                              !formData.company
                                ? 'Primero seleccione una empresa'
                                : 'Seleccione la categoría'
                            }
                            data={categoriesWF}
                            value={formData.category}
                            onChange={handleCategoryChange}
                            error={formErrors.category}
                            required
                            leftSection={<IconTag size={16} />}
                            disabled={!formData.company || formDataLoading}
                            size='lg'
                            classNames={{
                              label: 'text-sm font-medium text-gray-700 mb-2',
                              input: 'min-h-[48px] text-base',
                            }}
                          />
                        </div>
                        <Tooltip label='Crear nueva categoría' position='top'>
                          <ActionIcon
                            variant='filled'
                            color='blue'
                            size={48}
                            mt={26}
                            onClick={() => setCategoryModalOpened(true)}
                            disabled={!formData.company}
                            className='cursor-pointer hover:bg-blue-700 transition-colors duration-200'
                          >
                            <IconPlus size={20} />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                    </Grid.Col>

                    {/* <Grid.Col span={{ base: 12, md: 6 }}>
                      <TextInput
                        label='Asignado Categoría'
                        placeholder='Se asignará automáticamente'
                        value={assignedCategoryInfo?.name || ''}
                        readOnly
                        leftSection={<IconUserCheck size={16} />}
                        disabled
                        size='lg'
                        classNames={{
                          label: 'text-sm font-medium text-gray-700 mb-2',
                          input: 'min-h-[48px] bg-gray-50 text-gray-600 text-base',
                        }}
                      />
                    </Grid.Col> */}
                  </Grid>

                  <Divider label='Información del Proceso' labelPosition='left' />

                  <Grid>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <TextInput
                        label='Proceso'
                        placeholder={
                          !formData.category
                            ? 'Primero seleccione una categoría'
                            : 'Escriba el nombre del proceso'
                        }
                        value={formData.process}
                        onChange={(e) => setFormData({ ...formData, process: e.target.value })}
                        error={formErrors.process}
                        required
                        disabled={!formData.category || formDataLoading}
                        size='lg'
                        classNames={{
                          label: 'text-sm font-medium text-gray-700 mb-2',
                          input: 'min-h-[48px] text-base',
                        }}
                      />
                    </Grid.Col>

                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <Select
                        label='Encargado del Proceso '
                        placeholder='Seleccione el asignado'
                        data={assignedUsers}
                        value={formData.assignedProcess}
                        onChange={(value) =>
                          setFormData({ ...formData, assignedProcess: value || '' })
                        }
                        error={formErrors.assignedProcess}
                        leftSection={<IconUserCheck size={16} />}
                        disabled={!formData.process || formDataLoading}
                        size='lg'
                        classNames={{
                          label: 'text-sm font-medium text-gray-700 mb-2',
                          input: 'min-h-[48px] text-base',
                        }}
                      />
                    </Grid.Col>

                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <Select
                        label='Centro de Costo *'
                        placeholder='Seleccione el centro de costo'
                        data={[{ value: '1', label: 'Contabilidad' }]}
                        value={formData.costCenter}
                        onChange={(value) => setFormData({ ...formData, costCenter: value || '' })}
                        error={formErrors.costCenter}
                        leftSection={<IconBuilding size={16} />}
                        disabled={formDataLoading}
                        size='lg'
                        classNames={{
                          label: 'text-sm font-medium text-gray-700 mb-2',
                          input: 'min-h-[48px] text-base',
                        }}
                      />
                    </Grid.Col>
                  </Grid>
                </div>
              </div>
            )}

            {/* Paso 3: Tareas */}
            {currentStep === 3 && (
              <div className='space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300'>
                <div className='bg-white rounded-lg border border-gray-200 p-6 space-y-6'>
                  <div className='flex items-center justify-between mb-2'>
                    <div>
                      <Group gap='sm' mb={3}>
                        <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50'>
                          <IconListCheck size={16} className='text-blue-600' />
                        </div>
                        <Text fw={600} size='md' className='text-gray-900'>
                          Paso 3: Tareas
                        </Text>
                      </Group>
                      <Text size='sm' c='gray.6'>
                        Agregue las tareas que componen este flujo de trabajo (opcional).
                      </Text>
                    </div>
                    {tasks.length > 0 && (
                      <div className='flex items-center gap-3'>
                        <Badge color='blue' variant='light' size='lg' radius='sm'>
                          {tasks.length} {tasks.length === 1 ? 'tarea' : 'tareas'}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Formulario para agregar tarea - Mejorado */}
                  <div className='bg-gray-50 rounded-lg p-6'>
                    <Text fw={600} size='sm' mb={4} className='text-gray-700'>
                      Agregar Nueva Tarea
                    </Text>
                    <Grid>
                      <Grid.Col span={{ base: 12, md: 4 }}>
                        <TextInput
                          label='Tarea *'
                          placeholder='Nombre de la tarea'
                          value={taskForm.tarea}
                          onChange={(e) => setTaskForm({ ...taskForm, tarea: e.target.value })}
                          size='lg'
                          classNames={{
                            label: 'text-sm font-medium text-gray-700 mb-2',
                            input: 'min-h-[48px] text-base',
                          }}
                        />
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, md: 3 }}>
                        <Select
                          label='Asignado'
                          placeholder='Seleccione asignado'
                          data={assignedUsers}
                          value={taskForm.asignado}
                          onChange={(value) => setTaskForm({ ...taskForm, asignado: value || '' })}
                          leftSection={<IconUser size={16} />}
                          size='lg'
                          classNames={{
                            label: 'text-sm font-medium text-gray-700 mb-2',
                            input: 'min-h-[48px] text-base',
                          }}
                        />
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, md: 2 }}>
                        <NumberInput
                          label='Costo'
                          placeholder='0'
                          value={taskForm.costo ? parseFloat(taskForm.costo) : undefined}
                          onChange={(value) =>
                            setTaskForm({ ...taskForm, costo: value?.toString() || '' })
                          }
                          min={0}
                          decimalScale={2}
                          hideControls
                          size='lg'
                          classNames={{
                            label: 'text-sm font-medium text-gray-700 mb-2',
                            input: 'min-h-[48px] text-base',
                          }}
                        />
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, md: 2 }}>
                        <Select
                          label='Centro de Costo'
                          placeholder='Seleccione'
                          data={[{ value: '1', label: 'Contabilidad' }]}
                          value={taskForm.centroCosto}
                          onChange={(value) =>
                            setTaskForm({ ...taskForm, centroCosto: value || '' })
                          }
                          size='lg'
                          classNames={{
                            label: 'text-sm font-medium text-gray-700 mb-2',
                            input: 'min-h-[48px] text-base',
                          }}
                        />
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, md: 1 }}>
                        <Button
                          onClick={addTask}
                          leftSection={<IconPlus size={18} />}
                          variant='filled'
                          color='blue'
                          fullWidth
                          h={48}
                          mt={26}
                          disabled={!taskForm.tarea.trim()}
                          className='cursor-pointer hover:bg-blue-700 transition-colors duration-200'
                          size='lg'
                        >
                          Agregar
                        </Button>
                      </Grid.Col>
                    </Grid>
                  </div>

                  {/* Tabla de tareas agregadas - Mejorada */}
                  {tasks.length > 0 && (
                    <div className='border border-gray-200 rounded-lg overflow-hidden'>
                      <Table highlightOnHover className='w-full'>
                        <Table.Thead className='bg-gray-50'>
                          <Table.Tr>
                            <Table.Th className='py-4 px-5 text-sm font-semibold text-gray-700 uppercase tracking-wider'>
                              Tarea
                            </Table.Th>
                            <Table.Th className='py-4 px-5 text-sm font-semibold text-gray-700 uppercase tracking-wider'>
                              Asignado
                            </Table.Th>
                            <Table.Th className='py-4 px-5 text-sm font-semibold text-gray-700 uppercase tracking-wider'>
                              Costo
                            </Table.Th>
                            <Table.Th className='py-4 px-5 text-sm font-semibold text-gray-700 uppercase tracking-wider'>
                              Centro de Costo
                            </Table.Th>
                            <Table.Th
                              className='py-4 px-5 text-sm font-semibold text-gray-700 uppercase tracking-wider text-center'
                              style={{ width: 100 }}
                            >
                              Acciones
                            </Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {tasks.map((task) => (
                            <Table.Tr
                              key={task.id}
                              className='hover:bg-blue-50/50 transition-colors duration-150'
                            >
                              <Table.Td className='py-4 px-5'>
                                <Text size='base' fw={500} className='text-gray-900'>
                                  {task.tarea}
                                </Text>
                              </Table.Td>
                              <Table.Td className='py-4 px-5'>
                                <Group gap={4}>
                                  <IconUser size={16} className='text-gray-400' />
                                  <Text size='base' className='text-gray-700'>
                                    {task.asignado || 'Sin asignar'}
                                  </Text>
                                </Group>
                              </Table.Td>
                              <Table.Td className='py-4 px-5'>
                                <Text size='base' fw={600} className='text-green-700'>
                                  {task.costo
                                    ? `$${task.costo.toLocaleString('es-CO', {
                                        minimumFractionDigits: 2,
                                      })}`
                                    : '$0.00'}
                                </Text>
                              </Table.Td>
                              <Table.Td className='py-4 px-5'>
                                <Text size='base' className='text-gray-700'>
                                  {task.centroCosto || '-'}
                                </Text>
                              </Table.Td>
                              <Table.Td className='py-4 px-5 text-center'>
                                <ActionIcon
                                  color='red'
                                  variant='subtle'
                                  size={40}
                                  onClick={() => removeTask(task.id)}
                                  title='Eliminar tarea'
                                  className='cursor-pointer hover:bg-red-50 transition-colors duration-150'
                                >
                                  <IconTrash size={18} />
                                </ActionIcon>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </div>
                  )}

                  {tasks.length === 0 && (
                    <div className='text-center py-12 border-2 border-dashed border-gray-200 rounded-lg'>
                      <div className='flex flex-col items-center gap-4'>
                        <div className='flex items-center justify-center w-16 h-16 rounded-full bg-gray-100'>
                          <IconList size={32} className='text-gray-400' />
                        </div>
                        <div>
                          <Text size='md' fw={600} className='text-gray-700'>
                            No hay tareas agregadas
                          </Text>
                          <Text size='sm' c='gray.5' mt={2}>
                            Las tareas son opcionales. Puede agregar tareas o continuar sin ellas.
                          </Text>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </ScrollArea.Autosize>

          {/* Botones de acción */}
          <div className='flex items-center justify-between pt-4 mt-4 border-t border-gray-100'>
            <Button
              variant='outline'
              onClick={() => {
                if (currentStep > 1) {
                  setCurrentStep(currentStep - 1);
                } else {
                  setModalOpened(false);
                  setCurrentStep(1);
                  setFormErrors({});
                  setTasks([]);
                  setTaskForm({ tarea: '', asignado: '', costo: '', centroCosto: '' });
                }
              }}
              size='md'
              className='cursor-pointer hover:bg-gray-50 transition-colors duration-200'
            >
              {currentStep === 1 ? 'Cancelar' : 'Anterior'}
            </Button>

            <div className='flex items-center gap-3'>
              {currentStep < 3 && (
                <Button
                  onClick={() => {
                    if (currentStep === 1 && !formData.company) {
                      setFormErrors({ company: 'Este campo es obligatorio' });
                      return;
                    }
                    if (
                      currentStep === 2 &&
                      (!formData.category ||
                        !formData.process ||
                        !formData.assignedProcess ||
                        !formData.costCenter)
                    ) {
                      setFormErrors({
                        category: !formData.category ? 'Este campo es obligatorio' : '',
                        process: !formData.process ? 'Este campo es obligatorio' : '',
                        assignedProcess: !formData.assignedProcess
                          ? 'Este campo es obligatorio'
                          : '',
                        costCenter: !formData.costCenter ? 'Este campo es obligatorio' : '',
                      });
                      return;
                    }
                    setCurrentStep(currentStep + 1);
                    setFormErrors({});
                  }}
                  size='md'
                  rightSection={<IconChevronRight size={16} />}
                  className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
                >
                  Siguiente
                </Button>
              )}

              {currentStep === 3 && (
                <Button
                  onClick={handleCreateWorkFlowWithValidation}
                  loading={createLoading}
                  size='md'
                  leftSection={<IconPlus size={16} />}
                  className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
                >
                  Crear Flujo de Trabajo
                </Button>
              )}
            </div>
          </div>
        </Modal>

        {/* Modal de Crear Categoría */}
        <Modal
          opened={categoryModalOpened}
          onClose={() => {
            setCategoryModalOpened(false);
            setNewCategoryName('');
            setNewCategoryAssigned('');
          }}
          title={
            <Group gap='sm'>
              <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100'>
                <IconTag size={20} className='text-blue-600' />
              </div>
              <div>
                <Text fw={600} size='lg' className='text-gray-900'>
                  Crear Nueva Categoría
                </Text>
                <Text size='xs' c='gray.5'>
                  Complete los campos obligatorios
                </Text>
              </div>
            </Group>
          }
          size='sm'
          radius='lg'
          centered
          classNames={{
            header: 'border-b border-gray-100 pb-4',
            body: 'pt-4',
          }}
        >
          <Stack gap='lg'>
            <div className='space-y-4'>
              <TextInput
                label='Nombre de la Categoría'
                placeholder='Ingrese el nombre de la categoría'
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                required
                leftSection={<IconTag size={16} />}
                size='lg'
                classNames={{
                  label: 'text-sm font-medium text-gray-700 mb-2',
                  input: 'min-h-[48px] text-base',
                }}
              />
              <Select
                label='Asignado a la Categoría'
                placeholder='Seleccione un usuario'
                data={assignedUsers}
                value={newCategoryAssigned}
                onChange={(value) => setNewCategoryAssigned(value || '')}
                required
                leftSection={<IconUserCheck size={16} />}
                searchable
                size='lg'
                classNames={{
                  label: 'text-sm font-medium text-gray-700 mb-2',
                  input: 'min-h-[48px] text-base',
                }}
              />
            </div>

            <div className='bg-blue-50 rounded-lg p-4'>
              <Group gap='sm'>
                <IconBuilding size={16} className='text-blue-600' />
                <Text size='sm' c='blue.7'>
                  La categoría se creará para la empresa:{' '}
                  <Text fw={600} span>
                    {companies.find((c) => c.value === formData.company)?.label || 'N/A'}
                  </Text>
                </Text>
              </Group>
            </div>

            <Group justify='flex-end' gap='sm' mt='md'>
              <Button
                variant='outline'
                onClick={() => {
                  setCategoryModalOpened(false);
                  setNewCategoryName('');
                  setNewCategoryAssigned('');
                }}
                className='cursor-pointer hover:bg-gray-50 transition-colors duration-200'
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateCategory}
                loading={creatingCategory}
                disabled={!newCategoryName.trim() || !newCategoryAssigned}
                className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
              >
                Crear Categoría
              </Button>
            </Group>
          </Stack>
        </Modal>

        {/* Modal de Crear Proceso */}
        <Modal
          opened={processModalOpened}
          onClose={() => {
            setProcessModalOpened(false);
            setNewProcessName('');
            setNewProcessAssigned('');
          }}
          title={
            <Group gap='sm'>
              <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100'>
                <IconProgress size={20} className='text-blue-600' />
              </div>
              <div>
                <Text fw={600} size='lg' className='text-gray-900'>
                  Crear Nuevo Proceso
                </Text>
                <Text size='xs' c='gray.5'>
                  Complete los campos obligatorios
                </Text>
              </div>
            </Group>
          }
          size='sm'
          radius='lg'
          centered
          classNames={{
            header: 'border-b border-gray-100 pb-4',
            body: 'pt-4',
          }}
        >
          <Stack gap='lg'>
            <div className='space-y-4'>
              <TextInput
                label='Nombre del Proceso'
                placeholder='Ingrese el nombre del proceso'
                value={newProcessName}
                onChange={(e) => setNewProcessName(e.target.value)}
                required
                leftSection={<IconProgress size={16} />}
                size='lg'
                classNames={{
                  label: 'text-sm font-medium text-gray-700 mb-2',
                  input: 'min-h-[48px] text-base',
                }}
              />
            </div>

            <div className='bg-blue-50 rounded-lg p-4'>
              <Group gap='sm'>
                <IconTag size={16} className='text-blue-600' />
                <Text size='sm' c='blue.7'>
                  El proceso se creará para la categoría:{' '}
                  <Text fw={600} span>
                    {categoriesWF.find((c) => c.value === formData.category)?.label || 'N/A'}
                  </Text>
                </Text>
              </Group>
            </div>

            <Group justify='flex-end' gap='sm' mt='md'>
              <Button
                variant='outline'
                onClick={() => {
                  setProcessModalOpened(false);
                  setNewProcessName('');
                }}
                className='cursor-pointer hover:bg-gray-50 transition-colors duration-200'
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateProcess}
                loading={creatingProcess}
                disabled={!newProcessName.trim()}
                className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
              >
                Crear Proceso
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
