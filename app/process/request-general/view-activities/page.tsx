'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
import { useSession } from 'next-auth/react';

declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
    };
  }
}
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
  Modal,
  Box,
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
  IconTag,
  IconUserCheck,
  IconFileDescription,
  IconProgress,
  IconUpload,
  IconFile,
  IconFileText,
  IconFileSpreadsheet,
  IconPhoto,
  IconEye,
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../components/ui/FileUpload';

interface Request {
  id: number;
  id_task: number;
  task: string;
  id_request_general: number;
  description: string;
  subject_request: string;
  id_company: number;
  company: string;
  created_at: string;
  id_requester: number;
  name_requester: string;
  status_req: number;
  id_status: number;
  status_task: string;
  assigned: string;
  category: string;
  process: string;
  assignedUserId?: number;
  assignedUserName?: string;
  id_process_category?: number | null;
  user?: string;
  resolution?: string;
  date_resolution?: string;
  start_date?:string;
  executor_final: string;
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

interface FolderFile {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string; 
  '@microsoft.graph.downloadUrl'?: string;
}

interface ViewTasksRequestGeneral {
  id: number;
  id_request_general: number;
  id_task: number;
  task: string;
  id_status: number;
  status: string;
  id_assigned: number;
  name: string;
  start_date: string;
  end_date: string;
  resolution: string;
  date_resolution: string;
  description: string;
  id_company: number;
  company: string;
  created_at: string;
  id_requester: number;
  name_requester: string;
  status_req: number;
}

function ViewRequestPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const from = searchParams.get('from') || searchParams.get('mode') || 'assigned-activities';
  const [request, setRequest] = useState<Request | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [originalRequest, setOriginalRequest] = useState<Request | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [folderContents, setFolderContents] = useState([]);
  const [showResolution, setShowResolution] = useState(false);
  const [resolutionData, setResolutionData] = useState({
    estado: '',
    correo: '',
    resolucion: '',
    notificarPorCorreo: false,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [noteData, setNoteData] = useState({
    correo: '',
    notificarPorCorreo: false,
  });

  const [modalTasksOpened, setModalTasksOpened] = useState(false);
  const [loadingTaskRG, setLoadingTaskRG] = useState(false);
  const [taskRQ, setTaskRQ] = useState<ViewTasksRequestGeneral[]>([]);

  useEffect(() => {
    const storedRequest = sessionStorage.getItem('selectedRequest');
    if (storedRequest) {
      const requestData = JSON.parse(storedRequest);
      setRequest(requestData);
      setOriginalRequest(requestData);
      setLoading(false);
    } else if (id) {
      fetch(`/api/requests-general/view-activities?id=${id}`)
        .then((res) => {
          if (!res.ok) throw new Error('Error al cargar la tarea');
          return res.json();
        })
        .then((data) => {
          const mappedData = {
            ...data,
            resolution: data.resolutioncase || null,
            date_resolution: data.date_resolution || null,
          };
          setRequest(mappedData);
          setOriginalRequest(mappedData);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Error fetching request:', err);
          setError('No se pudo cargar la tarea. Por favor intente nuevamente.');
          setLoading(false);
        });
    }
  }, [id]);

  useEffect(() => {
    if (request) {
      fetchNotes();
      fetchFolderContents();
      fetchTasksRG();
    }
  }, [request]);

  useEffect(() => {
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

  const checkEditPermissions = async () => {
    if (!session?.user?.email || !request) {
      setCanEdit(false);
      setIsAdmin(false);
      setLoadingPermissions(false);
      return;
    }

    try {
      const userRole = session.user?.role;
      const hasAdminRole = userRole === 'admin' || userRole === 'super_user';

      setIsAdmin(hasAdminRole);

      const isAssignedUser = request.assigned === userName;

      const hasEditPermission = hasAdminRole || isAssignedUser;

      setCanEdit(hasEditPermission);
    } catch (error) {
      console.error('Error checking permissions:', error);
      setCanEdit(false);
      setIsAdmin(false);
    } finally {
      setLoadingPermissions(false);
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
  }, [status, userName, userId, getUserIdByName]);

  useEffect(() => {
    if (request && session) {
      setLoadingPermissions(true);
      checkEditPermissions();
    }
  }, [request, session, userName]);

  const fetchNotes = async () => {
    if (!request?.id_request_general) return;
    try {
      setLoadingNotes(true);
      const response = await fetch(`/api/requests-general/notes?id_request=${request.id_request_general}`);

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

  const fetchFolderContents = async () => {
    if (!request?.id_request_general) return;

    const folderName = `Request-${request.id_request_general}`;
    try {
      const token = await getMicrosoftToken();
      if (!token) {
        throw new Error('No se pudo obtener el token de acceso.');
      }

      const response = await axios.get(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/SG/${folderName}:/children`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const files = response.data.value.filter(
        (item: Record<string, unknown>) => 'file' in item && !!item.file
      );
      setFolderContents(files);
      console.log('Archivos existentes listados exitosamente:', files);
    } catch (error) {
      console.error('Error al listar los archivos de la carpeta:', error);
      setFolderContents([]);
    }
  };

  const fetchRequestData = async () => {
    if (!id) return;
    try {
      const response = await fetch(`/api/requests-general/view-activities?id=${id}`);
      if (!response.ok) throw new Error('Error al cargar la tarea');
      const data = await response.json();
      const mappedData = {
        ...data,
        resolution: data.resolution || null,
        date_resolution: data.date_resolution || null,
      };
      setRequest(mappedData);
      setOriginalRequest(mappedData);
    } catch (err) {
      console.error('Error refreshing request data:', err);
    }
  };

  const fetchTasksRG = async () => {
    if (!request?.id) return;
    try {
      setLoadingTaskRG(true);
      const response = await fetch(`/api/requests-general/view-tasks_request-general?idReq=${request.id_request_general}`);

      if (response.ok) {
        const data: ViewTasksRequestGeneral[] = await response.json();
        setTaskRQ(data);
      } else {
        console.error('Error al cargar tareas de la solicitud');
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoadingTaskRG(false);
    }
  };

  async function CheckOrCreateFolderAndUpload(
    folderName: string,
    files: { file: File }[],
    token: string
  ) {
    let folderId: string;

    try {
      const getResponse = await axios.get(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/SG/${folderName}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (getResponse.status === 200) {
        folderId = (getResponse.data as { id: string }).id;
      } else {
        throw new Error('Error al verificar la existencia de la carpeta.');
      }
    } catch (getError: unknown) {
      if (getError instanceof Error) {
        console.error(getError.message);
      } else {
        console.error(getError);
      }
    }

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
  }

  const handleStartEditing = () => {
    setOriginalRequest(request);
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

  const sendNoteEmailNotification = async (): Promise<boolean> => {
    if (!process.env.API_EMAIL) {
      console.error('Error: La variable de entorno API_EMAIL no está configurada');
      setUpdateMessage({
        type: 'error',
        text: 'Error de configuración: No se puede enviar la notificación por correo. Contacte al administrador.',
      });
      return false;
    }

    try {
      const message = `Nueva Nota en la Solicitud #${request?.id_request_general} - ${request?.subject_request}`;
      const emails = noteData.correo;

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'ID de la Solicitud': request?.id_request_general,
          Asunto: request?.subject_request,
          Categoría: request?.category,
          Proceso: request?.process,
          Actividad: request?.task,
          Empresa: request?.company,
          'Fecha de Creación': request?.created_at
            ? new Date(request.created_at).toISOString().split('T')[0]
            : 'N/A',
        },
      ];

      if (newNote) {
        table.push({
          Nota: newNote,
        });
      }

      const outro = `Este es un mensaje automático del sistema de Solicitudes Generales. Se ha agregado una nueva nota a la solicitud #${request?.id_request_general}. Si tiene alguna pregunta, por favor contacte al administrador del sistema.`;

      const result = await sendMessage(
        message,
        emails,
        table,
        outro,
        'https://farmalogica.com.co/imagenes/logos/logo20.png',
        []
      );

      console.log('Notificación por correo enviada exitosamente:', result);
      return true;
    } catch (error) {
      console.error('Error al enviar la notificación por correo:', error);
      setUpdateMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error al enviar la notificación por correo',
      });
      return false;
    }
  };

  const handleUpdateRequest = async () => {
  
    {/*
    if (!validateFields()) {
      return;
    }
    */}

    const currentStatus = resolutionData.estado 
      ? Number(resolutionData.estado) 
      : request?.id_status;
    
    if (resolutionData.resolucion && resolutionData.resolucion.trim() !== '' && currentStatus !== 2) {
      setUpdateMessage({
        type: 'error',
        text: `No puede agregar resolución porque el caso está en estado "${request?.status_task}". Solo puede agregar resolución cuando el estado es "Resuelto".`,
      });
      return;
    }

    setIsUpdating(true);
    setUpdateMessage(null);

    const processChanged =
      originalRequest?.id_process_category !== request?.id_process_category;

    const statusChangedFrom4To1 =
      originalRequest?.id_status === 4 &&
      Number(resolutionData.estado) === 1;

    if (processChanged) {
      await addSystemNote('Se ha cambiado la categoría de la solicitud');
    }

    if (statusChangedFrom4To1) {
      await addSystemNote('El funcionario ha comenzado a ejecutar esta tarea');
    }

    try {
      if (attachedFiles.length > 0) {
        const token = await getMicrosoftToken();
        if (!token) {
          throw new Error('No se pudo obtener el token de acceso para subir archivos.');
        }

        const folderName = `Request-${request?.id_request_general}`;
        const filesToUpload = attachedFiles
          .filter((file) => file.status === 'success')
          .map((file) => ({ file: file.file }));

        if (filesToUpload.length > 0) {
          await CheckOrCreateFolderAndUpload(folderName, filesToUpload, token);
        }
      }

      const updateData = {
        id: request?.id,

        id_status: resolutionData.estado
          ? Number(resolutionData.estado)
          : request?.id_status,

        id_assigned: userId,

        start_date: resolutionData.estado === '1' && !request?.start_date
          ? new Date().toISOString()
          : request?.start_date || null,

        end_date: resolutionData.estado === '2'
          ? new Date().toISOString()
          : null,

        resolution: resolutionData.resolucion || null,
      };

      const response = await fetch('/api/requests-general/update-activities', {
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

      // Refrescar datos desde el servidor
      await fetchRequestData();

      setIsEditing(false);

      if (attachedFiles.length > 0) {
        setTimeout(() => fetchFolderContents(), 2000);
      }

      if (resolutionData.estado) {
        setResolutionData({
          ...resolutionData,
          estado: '',
          resolucion: '',
          notificarPorCorreo: false,
        });
        setShowResolution(false);
      }
    } catch (error) {
      console.error('Error updating request:', error);
      setUpdateMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error al actualizar la solicitud',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isRequestResolved = () => {
    return request?.status_task?.toLowerCase() === 'completada' || Boolean(request?.resolution && request.resolution.trim() !== '');
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !request?.id_request_general || !userId) return;

    try {
      const response = await fetch('/api/requests-general/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_request: request.id_request_general,
          note: newNote.trim(),
          created_by: userId,
        }),
      });

      if (response.ok) {
        setNewNote('');
        await fetchNotes();

        if (noteData.notificarPorCorreo) {
          const emailSent = await sendNoteEmailNotification();
          if (emailSent) {
            setUpdateMessage({
              type: 'success',
              text: 'Nota agregada exitosamente y notificación por correo enviada',
            });
          }
        }

      } else {
        const errorData = await response.json();
        console.error('Error al agregar nota:', errorData.error);
      }
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  const addSystemNote = async (text: string) => {
    if (!request?.id_request_general || !userId) return;

    try {
      const response = await fetch('/api/requests-general/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_request: request.id_request_general,
          note: text,
          created_by: userId,
        }),
      });

      if (response.ok) {
        await fetchNotes();
      } else {
        const errorData = await response.json();
        console.error('Error al agregar nota:', errorData.error);
      }
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  useEffect(() => {
    if (request?.id_request_general) {
      const storedFiles = localStorage.getItem(`request-${request.id}-files`);
      if (storedFiles) {
        try {
          const parsedFiles = JSON.parse(storedFiles);
          setAttachedFiles(parsedFiles);
        } catch (error) {
          console.error('Error loading stored files:', error);
        }
      }
    }
  }, [request?.id_request_general]);

  useEffect(() => {
    if (request?.id_request_general && attachedFiles.length > 0) {
      localStorage.setItem(`request-${request.id_request_general}-files`, JSON.stringify(attachedFiles));
    } else if (request?.id_request_general) {
      localStorage.removeItem(`request-${request.id_request_general}-files`);
    }
  }, [attachedFiles, request?.id]);

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'sin empezar':
        return 'gray';
      case 'abierto':
        return 'blue';
      case 'resuelto':
        return 'green';
      default:
        return 'red';
    }
  };

  const getBreadcrumbHref = (from: string) => {
    switch (from) {
      case 'assigned-activities':
      default:
        return '/process/request-general/assigned-activities';
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Tareas Asignadas', href: getBreadcrumbHref(from) },
    { title: 'Detalle de la Tarea', href: '#' },
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
          <Text size='lg'>Cargando detalles de la tarea...</Text>
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
            onClick={() => router.push('/process/request-general/assigned-activities')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver al Panel de Tareas
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
            Tarea no encontrada
          </Text>
          <Button
            fullWidth
            onClick={() => router.push('/process/request-general/assigned-activities')}
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver al Panel de Tareas
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

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3'
              >
                <IconFileDescription size={32} className='text-blue-6' />
                Tarea #{request.id} - Solicitud #{request.id_request_general}
              </Title>
              <Text size='lg'>{request.task}</Text>
            </div>

            <Group>
              <Badge color={getStatusColor(request.status_task)} size='lg' radius='sm' variant='light'>
                {request.status_task}
              </Badge>
            </Group>
          </Flex>

          {isRequestResolved() && (
            <Alert icon={<IconCheck size={16} />} title='Tarea Resuelta' color='teal' mb='4'>
              Esta tarea ha sido resuelta y no se puede modificar.
            </Alert>
          )}
        </Card>

        <div className='flex flex-col lg:flex-row gap-6'>
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
                                    new Date(note.creation_date).getTime() + 5 * 60 * 60 * 1000 
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

              <div className='border-t pt-4'>
                <Stack gap='sm'>
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
                  <Checkbox
                    label='¿Notificar por correo electrónico?'
                    checked={noteData.notificarPorCorreo}
                    onChange={(e) =>
                      setNoteData({
                        ...noteData,
                        notificarPorCorreo: e.currentTarget.checked,
                        correo: e.currentTarget.checked ? noteData.correo : '',
                      })
                    }
                    mb='sm'
                  />
                  {noteData.notificarPorCorreo && (
                    <TextInput
                      label='Correo electrónico de contacto'
                      placeholder='Ejemplo: correo@farmalogica.com; correo2@farmalogica.com'
                      value={noteData.correo}
                      onChange={(e) =>
                        setNoteData({
                          ...noteData,
                          correo: e.currentTarget.value,
                        })
                      }
                      required
                    />
                  )}
                  <Group align='flex-end'>
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
                </Stack>
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

          <div className='w-full lg:w-150 order-1 lg:order-2'>
            <Card shadow='sm' p='xl' radius='md' withBorder className='bg-white'>
              <Title order={4} mb='md' className='flex items-center gap-2'>
                <IconFileDescription size={18} />
                Detalles de la Tarea
              </Title>

              <div className='pb-2'>
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
                      new Date(request.created_at).getTime() + 5 * 60 * 60 * 1000 
                    )
                  )}
                </Text>
              </div>

              {request?.start_date && (
                <div className='pb-2'>
                  <Text size='sm' color='gray.6' fw={500}>
                    Fecha de Inicio de Ejecución
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
                        new Date(request.start_date).getTime() 
                      )
                    )}
                  </Text>
                </div>
              )}

              <div className='pb-2'>
                <Text size='sm' color='gray.6' fw={500}>
                  Solicitante
                </Text>
                <Text size='sm'>{request.name_requester}</Text>
              </div>

              <div className='pb-2'>
                <Text size='sm' color='gray.6' fw={500}>
                  Asignado a
                </Text>

                <Text size='sm'>{request.assigned}</Text>
              </div>

              <Stack gap='md'>
                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Compañia
                  </Text>
                  <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
                    <Group>
                      <IconBuilding size={16} />
                      <Text size='sm'>
                        {request?.company}
                      </Text>
                    </Group>
                  </Card>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Asunto
                  </Text>

                  <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
                    <Group>
                      <IconFileDescription size={16} />
                      <Text size='sm'>{request?.subject_request}</Text>
                    </Group>
                  </Card>
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Descripción
                  </Text>

                  <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
                    <Text size='sm' className='whitespace-pre-line text-gray-700'>
                      {request?.description}
                    </Text>
                  </Card>
                </div>

                <Divider />

                {request?.resolution && request.resolution.trim() !== '' && (
                  <div>
                    <Text fw={600} mb='xs'>
                      Resolución de la Tarea
                    </Text>
                    <Card withBorder radius='md' p='md' bg='teal.0' className='border-teal-300'>
                      <Stack gap='sm'>
                        <Group>
                          <IconCheck size={20} className='text-teal-6' />
                          <Text size='sm' fw={500} className='text-teal-7'>
                            Resolución Aplicada
                          </Text>
                        </Group>
                        <Text size='sm' className='whitespace-pre-line text-gray-700'>
                          {request.resolution}
                        </Text>
                        {request.date_resolution && (
                          <Group>
                            <IconCalendar size={16} className='text-gray-5' />
                            <Text size='xs' color='gray.6'>
                              Fecha de Resolución: {
                                (() => {
                                  try {
                                    const date = new Date(request.date_resolution);
                                    if (isNaN(date.getTime())) {
                                      return 'Fecha inválida';
                                    }
                                    return new Intl.DateTimeFormat('es-CO', {
                                      day: 'numeric',
                                      month: 'long',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: true,
                                    }).format(
                                      new Date(date.getTime() + 5 * 60 * 60 * 1000) 
                                    );
                                  } catch (error) {
                                    console.error('Error formatting date:', error);
                                    return 'Fecha inválida';
                                  }
                                })()
                              }
                            </Text>
                            <Text size='xs' color='gray.6'>
                              Resuelto Por: {request.executor_final}
                            </Text>
                          </Group>
                        )}
                      </Stack>
                    </Card>
                  </div>
                )}

                <div>
                  <Text fw={600} mb='xs'>
                    Información de la Tarea
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
                               {request.category || 'Sin categoría'}
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
                              {request.process || 'Sin proceso'}
                            </Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                  </Grid>
                </div>

                <div>
                  <Title order={4} mb='md' className='flex items-center gap-2'>
                    <IconProgress size={18} className='text-blue-6' />
                    Cambiar Estado de la Tarea
                  </Title>

                  {isEditing && canEdit ? (
                    <Stack>
                      <Select
                        label='Estado de la Tarea'
                        placeholder='Selecciona estado'
                        data={[
                          { value: '1', label: 'En progreso' },
                          { value: '2', label: 'Resuelto' },
                        ]}
                        value={resolutionData.estado}
                        onChange={(val) =>
                          setResolutionData({ ...resolutionData, estado: val || '' })
                        }
                        error={formErrors.estado}
                      />
                    </Stack>
                  ) : (
                    <Card withBorder radius='md' p='md' bg='gray.0'>
                      <Group>
                        <IconProgress size={16} />
                        <div>
                          <Text size='xs' color='gray.6'>
                            Estado Actual
                          </Text>
                          <Badge color={getStatusColor(request.status_task)} size='lg' radius='sm' variant='light'>
                            {request.status_task}
                          </Badge>
                        </div>
                      </Group>
                    </Card>
                  )}
                </div>

                <Divider />

                <div>
                  <Group justify='space-between' mb='md'>
                    <Title order={4} className='flex items-center gap-2'>
                      <IconCheck size={18} className='text-green-6' />
                      Resolución de la Tarea
                    </Title>
                    {isEditing && canEdit && (
                      <ActionIcon
                        variant='subtle'
                        onClick={() => setShowResolution(!showResolution)}
                      >
                        {showResolution ? <IconX size={16} /> : <IconCheck size={16} />}
                      </ActionIcon>
                    )}
                  </Group>

                  {isEditing && showResolution && canEdit && (
                    <Stack>
                      {/* Validación: solo permitir resolución si el estado es 2 */}
                      {resolutionData.resolucion && resolutionData.estado !== '2' && !resolutionData.estado ? (
                        <Alert icon={<IconAlertCircle size={16} />} title='Estado no válido' color='red' mb='md'>
                          No puede agregar resolución porque el caso está en estado &quot;{request.status_task}&quot;. 
                          Solo puede agregar resolución cuando el estado es &quot;Resuelto&quot;.
                        </Alert>
                      ) : null}
                      
                      {resolutionData.resolucion && resolutionData.estado && resolutionData.estado !== '2' && (
                        <Alert icon={<IconAlertCircle size={16} />} title='Estado no válido' color='red' mb='md'>
                          No puede agregar resolución porque el estado seleccionado es &quot;
                          {resolutionData.estado === '1' ? 'En progreso' : resolutionData.estado === '3' ? 'Cancelado' : 'Desconocido'}&quot;. 
                          Solo puede agregar resolución cuando el estado es &quot;Resuelto&quot;.
                        </Alert>
                      )}

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
                        disabled={resolutionData.estado !== '2' && resolutionData.estado !== ''}
                        description={
                          resolutionData.estado && resolutionData.estado !== '2'
                            ? 'Solo puede agregar resolución cuando el estado es "Resuelto"'
                            : undefined
                        }
                      />
                    </Stack>
                  )}
                </div>
              </Stack>
            </Card>
          </div>
        </div>

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconEye size={20} />
            Archivos Adjuntos
          </Title>

          {folderContents.length > 0 && (
            <Stack gap='sm' mb='md'>
              <Text size='sm' fw={500}>
                Archivos existentes en la solicitud ({folderContents.length})
              </Text>
              {folderContents.map((file: FolderFile) => (
                <Card key={file.id} withBorder p='sm' bg='gray.0'>
                  <Flex align='center' gap='sm'>
                    <Box c='blue'>
                      {file.name.toLowerCase().endsWith('.pdf') && <IconFileText size={20} />}
                      {(file.name.toLowerCase().endsWith('.doc') ||
                        file.name.toLowerCase().endsWith('.docx')) && <IconFileText size={20} />}
                      {(file.name.toLowerCase().endsWith('.xls') ||
                        file.name.toLowerCase().endsWith('.xlsx')) && (
                        <IconFileSpreadsheet size={20} />
                      )}
                      {(file.name.toLowerCase().endsWith('.png') ||
                        file.name.toLowerCase().endsWith('.jpg') ||
                        file.name.toLowerCase().endsWith('.jpeg')) && <IconPhoto size={20} />}
                      {!file.name
                        .toLowerCase()
                        .match(/\.(pdf|doc|docx|xls|xlsx|png|jpg|jpeg)$/) && <IconFile size={20} />}
                    </Box>
                    <Box style={{ flex: 1 }}>
                      <Text size='sm' fw={500} lineClamp={1}>
                        {file.name}
                      </Text>
                      <Text size='xs' c='dimmed'>
                        {file.size ? formatFileSize(file.size) : 'Tamaño desconocido'}
                      </Text>
                      {file.lastModifiedDateTime && (
                        <Text size='xs' c='dimmed'>
                          Subido: {new Date(file.lastModifiedDateTime).toLocaleDateString('es-CO')}
                        </Text>
                      )}
                    </Box>
                    <Group gap='xs'>
                      <Badge color='teal' size='sm'>
                        Almacenado
                      </Badge>
                      <ActionIcon
                        variant='subtle'
                        color='blue'
                        size='sm'
                        component='a'
                        href={file.webUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                        aria-label={`Descargar archivo ${file.name}`}
                      >
                        <IconEye size={16} />
                      </ActionIcon>
                    </Group>
                  </Flex>
                </Card>
              ))}
            </Stack>
          )}

          <FileUpload
            ticketId={request.id}
            onFilesChange={setAttachedFiles}
            disabled={isRequestResolved()}
            storagePath='SG'
            entityType='Request'
          />
        </Card>

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
            <Group>
              {!isEditing ? (
                <Button
                  color='blue'
                  onClick={handleStartEditing}
                  leftSection={<IconTicket size={16} />}
                  disabled={!canEdit || loadingPermissions || isRequestResolved()}
                >
                  Editar Tarea
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
              {isRequestResolved() && (
                <Text size='sm' color='dimmed'>
                  Esta tarea tiene una resolución registrada. El estado aún puede modificarse.
                </Text>
              )}

              <Button
                color='blue'
                onClick={() => setModalTasksOpened(true)}
                leftSection={<IconTicket size={16} />}
              >
                Ver Tareas
              </Button>
            </Group>

            {!canEdit && (
              <Button
                variant='outline'
                onClick={() => router.push('/process/request-general/assigned-activities')}
                leftSection={<IconArrowLeft size={16} />}
              >
                Volver al Panel
              </Button>
            )}

            {canEdit && (
              <Button
                variant='outline'
                onClick={() => router.push('/process/request-general/assigned-activities')}
                leftSection={<IconArrowLeft size={16} />}
              >
                Volver al Panel
              </Button>
            )}
          </Group>
        </Card>

        <Modal
          opened={modalTasksOpened}
          onClose={() => setModalTasksOpened(false)}
          title={
            <Text fw={600} size="lg">
              Tareas Asignadas - Solicitud #{request?.id_request_general}
            </Text>
          }
          size="xl"
          centered
        >
          {loadingTaskRG ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <Text>Cargando tareas...</Text>
            </div>
          ) : taskRQ.length > 0 ? (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tarea</Table.Th>
                  <Table.Th>Asignado</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha Inicio</Table.Th>
                  <Table.Th>Fecha Fin</Table.Th>
                  <Table.Th>Resolución</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {taskRQ.map((task) => (
                  <Table.Tr key={task.id}>
                    <Table.Td>{task.task}</Table.Td>
                    <Table.Td>{task.name}</Table.Td>
                    <Table.Td>
                      <Badge color={getStatusColor(task.status)} size="sm">
                        {task.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {task.start_date
                        ? new Intl.DateTimeFormat('es-CO', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          }).format(
                            new Date(
                              new Date(task.start_date).getTime()
                            )
                          )
                        : 'N/A'}
                    </Table.Td>
                    <Table.Td>
                      {task.end_date
                        ? new Intl.DateTimeFormat('es-CO', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          }).format(
                            new Date(
                              new Date(task.end_date).getTime()
                            )
                          )
                        : 'N/A'}
                    </Table.Td>
                    <Table.Td>
                      {task.resolution}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <Text color="gray">No hay tareas asignadas a esta solicitud</Text>
            </div>
          )}
        </Modal>
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
