'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
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
  IconUpload,
  IconFile,
  IconFileText,
  IconFileSpreadsheet,
  IconPhoto,
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../components/ui/FileUpload';

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

interface FolderFile {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
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
  const [folderContents, setFolderContents] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [showResolution, setShowResolution] = useState(false);
  const [resolutionData, setResolutionData] = useState({
    estado: '',
    correo: '',
    resolucion: '',
    notificarPorCorreo: false,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [originalTicket, setOriginalTicket] = useState<Ticket | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<number | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);

  const [noteData, setNoteData] = useState({
    correo: '',
    notificarPorCorreo: false,
  });

  const isTicketResolved = () => {
    return ticket?.id_status_case === 2 || ticket?.status?.toLowerCase() === 'resuelto';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

  // Load attached files from localStorage
  useEffect(() => {
    if (ticket?.id_case) {
      const storedFiles = localStorage.getItem(`ticket-${ticket.id_case}-files`);
      if (storedFiles) {
        try {
          const parsedFiles = JSON.parse(storedFiles);
          setAttachedFiles(parsedFiles);
        } catch (error) {
          console.error('Error loading stored files:', error);
        }
      }
    }
  }, [ticket?.id_case]);

  // Save attached files to localStorage whenever they change
  useEffect(() => {
    if (ticket?.id_case && attachedFiles.length > 0) {
      localStorage.setItem(`ticket-${ticket.id_case}-files`, JSON.stringify(attachedFiles));
    } else if (ticket?.id_case) {
      // Clear localStorage if no files
      localStorage.removeItem(`ticket-${ticket.id_case}-files`);
    }
  }, [attachedFiles, ticket?.id_case]);

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
  }, [status, userName, userId, getUserIdByName]);

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

  //Onedrive 365
  async function GetToken() {
    const token = await getMicrosoftToken();

    // const formData = new FormData();
    // formData.append("file", file);

    try {
      const response = await axios.get(
        `https://graph.microsoft.com/v1.0/drive/special/documents/children`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = response.data;
      console.log(data);
    } catch (error) {
      console.log(error);
    }
  }

  const fetchFolderContents = async () => {
    if (!ticket?.id_case) return;

    const folderName = `Ticket-${ticket.id_case}`;
    try {
      const token = await getMicrosoftToken();
      if (!token) {
        throw new Error('No se pudo obtener el token de acceso.');
      }

      const response = await axios.get(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/MA/${folderName}:/children`,
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

  useEffect(() => {
    if (ticket?.id_case) {
      fetchFolderContents();
    }
  }, [ticket?.id_case]);

  async function CheckOrCreateFolderAndUpload(
    folderName: string,
    files: { file: File }[],
    token: string
  ) {
    let folderId: string;

    try {
      const getResponse = await axios.get(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/MA/${folderName}`,
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

        if (noteData.notificarPorCorreo) {
          await sendNoteEmailNotification();
        }

        // Resetear los datos de nota
        setNoteData({ correo: '', notificarPorCorreo: false });
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
      const message = `Actualización del Caso #${ticket?.id_case} - ${ticket?.subject_case}`;
      const emails = resolutionData.correo;

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'ID del Caso': ticket?.id_case,
          Asunto: ticket?.subject_case,
          Articulo: ticket?.activity,
          Departamento: ticket?.department,
          Empresa: ticket?.company,
          'Fecha de Creación': ticket?.creation_date
            ? new Date(ticket.creation_date).toISOString().split('T')[0]
            : 'N/A',
        },
      ];

      if (resolutionData.resolucion) {
        table.push({
          Resolución: resolutionData.resolucion,
        });
      }

      const outro = `Este es un mensaje automático del sistema de Mesa de Ayuda. El caso #${ticket?.id_case} ha sido actualizado. Si tiene alguna pregunta, por favor contacte al administrador del sistema.`;

      const result = await sendMessage(
        message,
        emails,
        table,
        outro,
        'https://farmalogica.com.co/imagenes/logos/logo20.png', // Logo por defecto
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

  const sendNoteEmailNotification = async (): Promise<boolean> => {
    if (!process.env.API_EMAIL) {
      console.error('Error: La variable de entorno API_EMAIL no está configurada');
      return false;
    }

    try {
      const message = `Nueva Nota en Caso #${ticket?.id_case} - ${ticket?.subject_case}`;
      const emails = noteData.correo;

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'ID del Caso': ticket?.id_case,
          Asunto: ticket?.subject_case,
          Nota: newNote,
          'Creado por': userName,
          'Fecha de Creación': ticket?.creation_date
            ? new Date(ticket.creation_date).toISOString().split('T')[0]
            : 'N/A',
        },
      ];

      const outro = `Este es un mensaje automático del sistema de Mesa de Ayuda. Se ha agregado una nueva nota al caso #${ticket?.id_case}. Si tiene alguna pregunta, por favor contacte al administrador del sistema.`;

      const result = await sendMessage(
        message,
        emails,
        table,
        outro,
        'https://farmalogica.com.co/imagenes/logos/logo20.png',
        []
      );

      console.log('Notificación por correo de nota enviada exitosamente:', result);
      return true;
    } catch (error) {
      console.error('Error al enviar la notificación por correo de nota:', error);
      return false;
    }
  };

  const handleUpdateCase = async () => {
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

        const folderName = `Ticket-${ticket?.id_case}`;
        const filesToUpload = attachedFiles
          .filter((file) => file.status === 'success')
          .map((file) => ({ file: file.file }));

        if (filesToUpload.length > 0) {
          await CheckOrCreateFolderAndUpload(folderName, filesToUpload, token);
        }
      }

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

      let emailSent = true;
      if (resolutionData.notificarPorCorreo) {
        emailSent = await sendEmailNotification();
      }

      if (emailSent) {
        setUpdateMessage({
          type: 'success',
          text: resolutionData.notificarPorCorreo
            ? 'Caso actualizado exitosamente y notificación por correo enviada'
            : 'Caso actualizado exitosamente',
        });
      }

      if (resolutionData.estado) {
        setTicket((prev) => (prev ? { ...prev, status: resolutionData.estado } : null));
      }

      setOriginalTicket(ticket);
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
      console.error('Error updating case:', error);
      setUpdateMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error al actualizar el caso',
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
            <Alert icon={<IconCheck size={16} />} title='Caso Resuelto' color='teal' mb='4'>
              Este caso ha sido marcado como resuelto y no se puede modificar. Si necesita realizar
              cambios, contacte al administrador del sistema.
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
                        disabled={
                          !isEditing || !ticket.id_category || loadingOptions || isTicketResolved()
                        }
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
                        disabled={
                          !isEditing ||
                          !ticket.id_subcategory ||
                          loadingOptions ||
                          isTicketResolved()
                        }
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
                        <div
                          key={note.id_note}
                          className='border-b border-gray-200 pb-2 last:border-b-0'
                        >
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
                      ))}
                    </Stack>
                  </div>
                ) : (
                  <Text size='sm' color='dimmed' mb='xs'>
                    {loadingNotes ? 'Cargando notas...' : 'No hay notas registradas.'}
                  </Text>
                )}

                <Stack gap='sm'>
                  <Textarea
                    placeholder='Escribe una nota...'
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    minRows={2}
                    disabled={!userId || loadingUserId || isTicketResolved()}
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
                    disabled={!userId || loadingUserId || isTicketResolved()}
                    mb='sm'
                  />
                  {noteData.notificarPorCorreo && (
                    <TextInput
                      label='Correo electrónico de contacto'
                      placeholder='correo@empresa.com'
                      value={noteData.correo}
                      onChange={(e) =>
                        setNoteData({
                          ...noteData,
                          correo: e.currentTarget.value,
                        })
                      }
                      disabled={!userId || loadingUserId || isTicketResolved()}
                      required
                    />
                  )}
                  <Group justify='flex-end'>
                    <ActionIcon
                      variant='filled'
                      color='blue'
                      onClick={handleAddNote}
                      disabled={!userId || loadingUserId || !newNote.trim() || isTicketResolved()}
                    >
                      <IconCheck size={16} />
                    </ActionIcon>
                  </Group>
                </Stack>
                {isTicketResolved() && (
                  <Text size='xs' color='dimmed' mt='xs'>
                    No se pueden agregar notas a casos resueltos.
                  </Text>
                )}
                {(!userId || loadingUserId) && !isTicketResolved() && (
                  <Text size='xs' color='orange.6' mt='xs'>
                    {loadingUserId
                      ? 'Cargando información del usuario...'
                      : 'No se pudo identificar al usuario actual'}
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
                      <Text fw={600}>Información de Resolución</Text>
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
                      disabled={!isEditing}
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
                        disabled={!isEditing}
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
                      disabled={!isEditing}
                    />
                  </Stack>
                )}
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>

        {/* File Attachments */}
        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconUpload size={20} />
            Archivos Adjuntos
          </Title>

          {/* Archivos existentes */}
          {folderContents.length > 0 && (
            <Stack gap='sm' mb='md'>
              <Text size='sm' fw={500}>
                Archivos existentes en el ticket ({folderContents.length})
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

          {/* Componente de carga de archivos */}
          <FileUpload
            ticketId={ticket.id_case}
            onFilesChange={setAttachedFiles}
            disabled={isTicketResolved()}
          />
        </Card>

        {/* Actions */}
        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          {/* Mensaje de actualización */}
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
