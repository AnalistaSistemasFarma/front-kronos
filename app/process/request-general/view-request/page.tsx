'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
import { useSession } from 'next-auth/react';

// Extend the session type to include role
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
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../components/ui/FileUpload';

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
  assignedUserId?: number;
  assignedUserName?: string;
  id_process_category?: number;
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

interface FolderFile {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
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
      fetchFolderContents();
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
      // Check if user has admin privileges
      const userRole = session.user?.role;
      const hasAdminRole = userRole === 'admin' || userRole === 'super_user';

      // For client-side, we'll use the role from session
      // Server-side verification should be done for critical operations
      setIsAdmin(hasAdminRole);

      // Check if user is assigned to this request
      const isAssignedUser = request.user === userName;

      // User can edit if they are admin or assigned to the request
      const hasEditPermission = hasAdminRole || isAssignedUser;

      setCanEdit(hasEditPermission);
      console.log('Permission check:', {
        userName,
        assignedUserName: request.user,
        isAssignedUser,
        hasAdminRole,
        canEdit: hasEditPermission,
      });
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

  useEffect(() => {
    if (request?.category) {
      const filtered = processCategories.filter(
        (p) => p.id_category_request === parseInt(request.category)
      );
      setFilteredProcesses(filtered);
    } else {
      setFilteredProcesses([]);
    }
  }, [request?.category, processCategories, request?.process]);

  const fetchFormData = async () => {
    try {
      setLoadingOptions(true);
      const response = await fetch('/api/requests-general/consult-request');

      if (response.ok) {
        const data: ConsultResponse = await response.json();
        setCompanies(
          data.companies.map((c: CompanyData) => ({
            value: c.id_company.toString(),
            label: c.company,
          }))
        );
        setCategories(
          data.categories.map((c: CategoryData) => ({ value: c.id.toString(), label: c.category }))
        );
        setProcessCategories(
          data.processCategories.map((p: ProcessCategoryData) => ({
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

  const fetchFolderContents = async () => {
    if (!request?.id) return;

    const folderName = `Request-${request.id}`;
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

  const handleFormChange = (field: string, value: string) => {
    setRequest((prev) => {
      if (!prev) return prev;
      const updatedRequest = { ...prev, [field]: value };

      if (field === 'category' && value) {
        const filtered = processCategories.filter((p) => p.id_category_request === parseInt(value));
        updatedRequest.process = '';
      }

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

    if (!request?.subject || request.subject.trim() === '') {
      errors.subject = 'El asunto es requerido';
    }
    if (!request?.category) {
      errors.category = 'La categoría es requerida';
    }
    if (!request?.process) {
      errors.process = 'El proceso es requerido';
    }
    if (!request?.description || request.description.trim() === '') {
      errors.description = 'La descripción es requerida';
    }

    if (resolutionData.estado) {
      if (!resolutionData.resolucion || resolutionData.resolucion.trim() === '') {
        errors.resolucion =
          'La descripción de la resolución es requerida cuando se cambia el estado';
      }
    }

    if (resolutionData.notificarPorCorreo) {
      if (!resolutionData.correo || resolutionData.correo.trim() === '') {
        errors.correo =
          'El correo electrónico es requerido cuando se selecciona notificar por correo';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolutionData.correo)) {
        errors.correo = 'Por favor ingrese un correo electrónico válido';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const sendEmailNotification = async (): Promise<boolean> => {
    if (!process.env.API_EMAIL) {
      console.error('Error: La variable de entorno API_EMAIL no está configurada');
      setUpdateMessage({
        type: 'error',
        text: 'Error de configuración: No se puede enviar la notificación por correo. Contacte al administrador.',
      });
      return false;
    }

    try {
      const message = `Actualización de la Solicitud #${request?.id} - ${request?.subject}`;
      const emails = resolutionData.correo;

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'ID de la Solicitud': request?.id,
          Asunto: request?.subject,
          Categoría: request?.category,
          Proceso: request?.process,
          Empresa: request?.company,
          'Fecha de Creación': request?.created_at
            ? new Date(request.created_at).toISOString().split('T')[0]
            : 'N/A',
        },
      ];

      if (resolutionData.resolucion) {
        table.push({
          Resolución: resolutionData.resolucion,
        });
      }

      const outro = `Este es un mensaje automático del sistema de Solicitudes Generales. La solicitud #${request?.id} ha sido actualizada. Si tiene alguna pregunta, por favor contacte al administrador del sistema.`;

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
    if (!validateFields()) {
      return;
    }

    setIsUpdating(true);
    setUpdateMessage(null);

    try {
      if (attachedFiles.length > 0) {
        const token = await getMicrosoftToken();
        if (!token) {
          throw new Error('No se pudo obtener el token de acceso para subir archivos.');
        }

        const folderName = `Request-${request?.id}`;
        const filesToUpload = attachedFiles
          .filter((file) => file.status === 'success')
          .map((file) => ({ file: file.file }));

        if (filesToUpload.length > 0) {
          await CheckOrCreateFolderAndUpload(folderName, filesToUpload, token);
        }
      }

      const updateData = {
        id: request?.id,
        subject: request?.subject,
        description: request?.description,
        category: request?.category,
        process: request?.process,
        status: resolutionData.estado || request?.status,
        resolucion: resolutionData.resolucion,
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

      let emailSent = true;
      if (resolutionData.notificarPorCorreo) {
        emailSent = await sendEmailNotification();
      }

      if (emailSent) {
        setUpdateMessage({
          type: 'success',
          text: resolutionData.notificarPorCorreo
            ? 'Solicitud actualizada exitosamente y notificación por correo enviada'
            : 'Solicitud actualizada exitosamente',
        });
      }

      if (resolutionData.estado) {
        setRequest((prev) => (prev ? { ...prev, status: resolutionData.estado } : null));
      }

      setOriginalRequest(request);
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
    return request?.status?.toLowerCase() === 'completada';
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

  useEffect(() => {
    if (request?.id) {
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
  }, [request?.id]);

  useEffect(() => {
    if (request?.id && attachedFiles.length > 0) {
      localStorage.setItem(`request-${request.id}-files`, JSON.stringify(attachedFiles));
    } else if (request?.id) {
      localStorage.removeItem(`request-${request.id}-files`);
    }
  }, [attachedFiles, request?.id]);

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
          <Text size='lg'>Cargando detalles de la solicitud...</Text>
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

          {isRequestResolved() && (
            <Alert icon={<IconCheck size={16} />} title='Solicitud Completada' color='teal' mb='4'>
              Esta solicitud ha sido marcada como completada y no se puede modificar.
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

          <div className='w-full lg:w-150 order-1 lg:order-2'>
            <Card shadow='sm' p='xl' radius='md' withBorder className='bg-white'>
              <Title order={4} mb='md' className='flex items-center gap-2'>
                <IconFileDescription size={18} />
                Detalles de la Solicitud
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
                      new Date(request.created_at).getTime() + 5 * 60 * 60 * 1000 // +5 horas
                    )
                  )}
                </Text>
              </div>

              <div className='pb-2'>
                <Text size='sm' color='gray.6' fw={500}>
                  Solicitante
                </Text>
                <Text size='sm'>{request.requester}</Text>
              </div>

              <div className='pb-2'>
                <Text size='sm' color='gray.6' fw={500}>
                  Asignado a
                </Text>
                <Text size='sm'>{request.user}</Text>
              </div>

              <Stack gap='md'>
                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Compañia
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
                  <Text size='sm' color='gray.6' fw={500}>
                    Asunto
                  </Text>
                  {isEditing ? (
                    <TextInput
                      value={request?.subject || ''}
                      onChange={(e) => handleFormChange('subject', e.target.value)}
                      error={formErrors.subject}
                      disabled={isRequestResolved() || !canEdit}
                    />
                  ) : (
                    <Card withBorder radius='md' p='md' bg='gray.0'>
                      <Group>
                        <IconFileDescription size={16} />
                        <Text size='sm'>{request?.subject}</Text>
                      </Group>
                    </Card>
                  )}
                </div>

                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Descripción
                  </Text>
                  {isEditing ? (
                    <Textarea
                      value={request?.description || ''}
                      onChange={(e) => handleFormChange('description', e.target.value)}
                      minRows={3}
                      error={formErrors.description}
                      disabled={isRequestResolved() || !canEdit}
                    />
                  ) : (
                    <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
                      <Text size='sm' className='whitespace-pre-line text-gray-700'>
                        {request.description}
                      </Text>
                    </Card>
                  )}
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
                            {isEditing ? (
                              <Select
                                data={categories}
                                value={request?.category?.toString() || ''}
                                onChange={(val) => handleFormChange('category', val ?? '')}
                                error={formErrors.category}
                                disabled={isRequestResolved() || !canEdit}
                              />
                            ) : (
                              <Text size='sm'>
                                {categories.find((c) => c.value === request?.category)?.label ||
                                  request?.category}
                              </Text>
                            )}
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
                            {isEditing ? (
                              <Select
                                data={filteredProcesses}
                                value={request?.process?.toString() || ''}
                                onChange={(val) => handleFormChange('process', val ?? '')}
                                error={formErrors.process}
                                disabled={isRequestResolved() || !canEdit}
                              />
                            ) : (
                              <Text size='sm'>
                                {processCategories.find((p) => p.value === request?.process)
                                  ?.label || request?.process}
                              </Text>
                            )}
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                  </Grid>
                </div>

                {/* Resolución */}
                <div>
                  <Group justify='space-between' mb='md'>
                    <Title order={4} className='flex items-center gap-2'>
                      <IconCheck size={18} className='text-green-6' />
                      Resolución de la Solicitud
                    </Title>
                    {!isRequestResolved() && isEditing && canEdit && (
                      <ActionIcon
                        variant='subtle'
                        onClick={() => setShowResolution(!showResolution)}
                      >
                        {showResolution ? <IconX size={16} /> : <IconCheck size={16} />}
                      </ActionIcon>
                    )}
                  </Group>

                  {/* Formulario de resolución para solicitudes no resueltas */}
                  {!isRequestResolved() && isEditing && showResolution && canEdit && (
                    <Stack>
                      <Select
                        label='Estado de la solicitud'
                        placeholder='Selecciona estado'
                        data={[
                          { value: 'Completada', label: 'Completada' },
                          { value: 'Cancelada', label: 'Cancelada' },
                        ]}
                        value={resolutionData.estado}
                        onChange={(val) =>
                          setResolutionData({ ...resolutionData, estado: val || '' })
                        }
                        error={formErrors.estado}
                      />
                      <Checkbox
                        label='¿Notificar por correo electrónico?'
                        checked={resolutionData.notificarPorCorreo}
                        onChange={(e) =>
                          setResolutionData({
                            ...resolutionData,
                            notificarPorCorreo: e.currentTarget.checked,
                            correo: e.currentTarget.checked ? resolutionData.correo : '',
                          })
                        }
                        mb='sm'
                      />
                      {resolutionData.notificarPorCorreo && (
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
                          required
                        />
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
            <IconUpload size={20} />
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
                        href={file['@microsoft.graph.downloadUrl']}
                        target='_blank'
                        rel='noopener noreferrer'
                        aria-label={`Descargar archivo ${file.name}`}
                      >
                        <IconUpload size={16} />
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
                  disabled={isRequestResolved() || !canEdit || loadingPermissions}
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
              {isRequestResolved() && (
                <Text size='sm' color='dimmed'>
                  Las solicitudes completadas no se pueden modificar.
                </Text>
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
