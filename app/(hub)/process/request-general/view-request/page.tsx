'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
  isClosedStatusId,
  showClosureNotification,
} from '../../../../../lib/notifications/showClosureNotification';
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
  MultiSelect,
  ThemeIcon,
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
  IconLock,
  IconArrowBackUp,
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';

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
  id_requester?: number;
  requester_email?: string;
  status: string;
  assignedUserId?: number;
  assignedUserName?: string;
  id_process_category?: number | null;
  user?: string;
  usuario?: string;
  id_status_case: number;
  status_req?: number;
  id_category: number;
  resolution?: string;
  date_resolution?: string;
  executor_final: string;
  idProceso: number;
  id_assigned_category: number;
  id_assigned_process_category: number;
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
  is_sequential?: boolean;
  locked?: boolean;
  display_order?: number;
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
  webUrl?: string; 
  '@microsoft.graph.downloadUrl'?: string;
}

interface UserEmail {
  value: string;
  label: string;
}

function ViewRequestPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const from = searchParams.get('from') || searchParams.get('mode') || 'create-request';
  const RETURNED_STATUS_ID = 7;
  const OPEN_STATUS_ID = 1;
  const [request, setRequest] = useState<Request | null>(null);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [processCategories, setProcessCategories] = useState<
    { value: string; label: string; id_category_request: number }[]
  >([]);
  const [filteredProcesses, setFilteredProcesses] = useState<Option[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingDownload, setLoadingDownload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [taskRQ, setTaskRQ] = useState<ViewTasksRequestGeneral[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingTaskRG, setLoadingTaskRG] = useState(false);
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingUserId, setLoadingUserId] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const notesViewportRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [originalRequest, setOriginalRequest] = useState<Request | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const hasNotedUpload = useRef(false);
  const [folderContents, setFolderContents] = useState<FolderFile[]>([]);
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
  const [reopenModalOpened, setReopenModalOpened] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenError, setReopenError] = useState('');
  const [availableUsers, setAvailableUsers] = useState<UserEmail[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<UserEmail[]>([]);
  const [updatingAssigneeId, setUpdatingAssigneeId] = useState<number | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [selectedNoteEmails, setSelectedNoteEmails] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [requestFormValues, setRequestFormValues] = useState<
    { id: number; field_label: string; option_label: string | null; value_text: string | null }[]
  >([]);

  useEffect(() => {
    const storedRaw = sessionStorage.getItem('selectedRequest');
    let storedRequest: Request | null = null;

    if (storedRaw) {
      try {
        storedRequest = JSON.parse(storedRaw) as Request;
        setRequest(storedRequest);
        setOriginalRequest(storedRequest);
        setLoading(false);
      } catch {
        sessionStorage.removeItem('selectedRequest');
      }
    }

    if (!id) {
      if (!storedRequest) setLoading(false);
      return;
    }

    fetch(`/api/requests-general/view-request?id=${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Error al cargar la solicitud');
        return res.json();
      })
      .then((data) => {
        // Campos que la API de detalle aporta/normaliza.
        const apiFields: Partial<Request> = {
          subject: data.subject_request ?? data.subject,
          description: data.description,
          category: data.category,
          process: data.process,
          company: data.company,
          id_company: data.id_company,
          id_status_case: data.status_req ?? data.id_status_case,
          status_req: data.status_req ?? data.id_status_case,
          id_process_category: data.id_process_category,
          assignedUserName: data.assignedUserName,
          user: data.user ?? data.assignedUserName ?? data.usuario,
          requester: data.requester,
          id_requester: data.id_requester,
          requester_email: data.requester_email,
          executor_final: data.executor_final,
          resolution: data.resolutioncase || null,
          date_resolution: data.date_resolution || null,
        };

        // Base: datos de la lista (forma que el formulario espera). Si no hay, usar la API.
        const base: Request = storedRequest ?? (data as Request);
        const merged: Request = { ...base };

        // Sobreponer solo valores presentes para no borrar datos buenos con nulos.
        (Object.keys(apiFields) as (keyof Request)[]).forEach((key) => {
          const value = apiFields[key];
          if (value !== undefined && value !== null && value !== '') {
            (merged as unknown as Record<string, unknown>)[key] = value;
          }
        });

        // El correo y el id del solicitante deben venir siempre de la API.
        merged.requester_email = data.requester_email ?? merged.requester_email;
        merged.id_requester = data.id_requester ?? merged.id_requester;

        setRequest(merged);
        setOriginalRequest(merged);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching request:', err);
        if (!storedRequest) {
          setError('No se pudo cargar la solicitud. Por favor intente nuevamente.');
        }
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (!request?.id) return;

    const controller = new AbortController();
    const requestId = request.id;

    const loadRelatedData = async () => {
      await Promise.all([
        fetchNotes(requestId, controller.signal),
        fetchTasksRG(requestId, controller.signal),
        fetchFormValues(requestId, controller.signal),
      ]);
    };

    void fetchFormData();
    void fetchFolderContents();
    void loadRelatedData();

    return () => controller.abort();
  }, [request?.id]);

  const fetchFormValues = async (requestId: number, signal?: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/requests-general/request-form-values?id_request=${requestId}`,
        { signal }
      );
      if (!response.ok) throw new Error('Error al cargar las respuestas del formulario');
      const data = await response.json();
      if (!signal?.aborted) setRequestFormValues(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Error fetching form values:', err);
      if (!signal?.aborted) setRequestFormValues([]);
    }
  };

  useEffect(() => {
    if (notesViewportRef.current) {
      notesViewportRef.current.scrollTop = notesViewportRef.current.scrollHeight;
    }
  }, [notes]);

  const fetchUsersWithEmails = async () => {
    try {
      setLoadingUsers(true);
      const response = await fetch('/api/requests-general/users-emails');
      if (response.ok) {
        const data = await response.json();
        const formattedUsers = data.users.map((user: { name: string; email: string }) => ({
          value: user.email,
          label: `${user.name} - ${user.email}`,
        }));
        setAvailableUsers(formattedUsers);
        const formattedAssignable = data.users.map((user: { id: string; name: string; email: string }) => ({
          value: user.id,
          label: user.name,
        }));
        setAssignableUsers(formattedAssignable);
      } else {
        console.error('Error al cargar usuarios:', response.statusText);
      }
    } catch (error) {
      console.error('Error cargando usuarios:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsersWithEmails();
  }, []);

  const getUserIdByName = async (userName: string): Promise<string | null> => {
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

      // El "solicitado" (asignado al proceso) es quien gestiona y puede editar.
      // NO se incluye `usuario` (rg.[user] = creador/solicitante): el solicitante
      // no debe poder editar la solicitud.
      const normalize = (value?: string | null) => (value || '').trim().toLowerCase();
      const currentUser = normalize(userName);

      // El solicitante (creador) NUNCA puede editar, sin importar su rol (admin, etc.).
      const isRequester =
        (session.user?.id &&
          request.id_requester &&
          String(session.user.id) === String(request.id_requester)) ||
        (currentUser !== '' && normalize(request.requester) === currentUser);

      if (isRequester) {
        setCanEdit(false);
        console.log('Permission check: solicitante — edición bloqueada', {
          userName,
          requester: request.requester,
          id_requester: request.id_requester,
        });
        return;
      }

      // El "solicitado" (asignado al proceso) es quien gestiona y puede editar.
      const assignedCandidates = [request.user, request.assignedUserName].map(normalize);

      const isAssignedUser =
        currentUser !== '' && assignedCandidates.some((name) => name !== '' && name === currentUser);

      const hasEditPermission = hasAdminRole || isAssignedUser;

      setCanEdit(hasEditPermission);
      console.log('Permission check:', {
        userName,
        assignedCandidates,
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
    if (status !== 'authenticated') return;

    const sessionUserId = session?.user?.id;
    if (sessionUserId) {
      setUserId(sessionUserId);
      return;
    }

    if (userName && !userId) {
      getUserIdByName(userName).then((id) => {
        if (id) {
          setUserId(id);
          console.log('ID de usuario obtenido:', id);
        }
      });
    }
  }, [status, userName, userId, session?.user?.id]);

  useEffect(() => {
    if (request && session) {
      setLoadingPermissions(true);
      checkEditPermissions();
    }
  }, [request?.id, request?.id_requester, request?.requester, request?.user, request?.assignedUserName, session, userName, session?.user?.id]);

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

  const fetchNotes = async (requestId: number, signal?: AbortSignal) => {
    try {
      setLoadingNotes(true);
      const response = await fetch(`/api/requests-general/notes?id_request=${requestId}`, {
        signal,
      });

      if (response.ok) {
        const data: Note[] = await response.json();
        if (!signal?.aborted) setNotes(data);
      } else if (!signal?.aborted) {
        console.error('Error al cargar notas');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Error fetching notes:', error);
    } finally {
      if (!signal?.aborted) setLoadingNotes(false);
    }
  };

  const fetchTasksRG = async (requestId: number, signal?: AbortSignal) => {
    try {
      setLoadingTaskRG(true);
      const response = await fetch(
        `/api/requests-general/view-tasks_request-general?idReq=${requestId}`,
        { signal }
      );

      if (response.ok) {
        const data: ViewTasksRequestGeneral[] = await response.json();
        if (!signal?.aborted) setTaskRQ(data);
      } else if (!signal?.aborted) {
        console.error('Error al cargar tareas de la solicitud');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Error fetching tasks:', error);
    } finally {
      if (!signal?.aborted) setLoadingTaskRG(false);
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
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setFolderContents([]);
        return;
      }
      console.error('Error al listar los archivos de la carpeta:', error);
      setFolderContents([]);
    }
  };

  const downloadAllFilesAsZip = async () => {
    setLoadingDownload(true);
    if (!folderContents.length) return;

    try {
      const zip = new JSZip();

      for (const file of folderContents) {
        const url = file["@microsoft.graph.downloadUrl"];

        if (!url) continue;

        const response = await axios.get(url, {
          responseType: 'blob',
        });

        zip.file(file.name, response.data);
      }

      const content = await zip.generateAsync({ type: 'blob' });

      if (!request) return;

      saveAs(content, `Request-${request.id}.zip`);

      setLoadingDownload(false);
    } catch (error) {
      console.error('Error descargando archivos en ZIP:', error);
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
        const filtered = processCategories.filter(
          (p) => p.id_category_request === parseInt(value)
        );

        updatedRequest.id_process_category = null; 
        setFilteredProcesses(filtered);
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

  const validateFields = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!request?.subject || request.subject.trim() === '') {
      errors.subject = 'El asunto es requerido';
    }
    if (!request?.category) {
      errors.category = 'La categoría es requerida';
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
      }
    }

    setFormErrors(errors);
    return errors;
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

      const resolutionSection = resolutionData.resolucion
      ? `
        <div style="margin-top:20px;padding:15px;border-radius:8px;background:#f8f9fa;border:1px solid #e0e0e0;">
          <h3 style="margin:0 0 10px 0;font-size:16px;">Resolución agregada</h3>
          <p style="
            margin:0;
            white-space:pre-wrap;
            word-break:break-word;
            overflow-wrap:break-word;
            line-height:1.6;
            font-size:14px;
          ">
            ${resolutionData.resolucion}
          </p>
        </div>
      `
      : '';

      const outro = `
        ${resolutionSection}

        <p style="margin-top:20px;">
          Este es un mensaje automático del sistema de Solicitudes Generales.
          La solicitud #${request?.id} ha sido actualizada.
          Si tiene alguna pregunta, por favor contacte al administrador del sistema.
        </p>
      `;
      
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
      const message = `Nueva Nota en la Solicitud #${request?.id} - ${request?.subject}`;
      const emails = noteData.correo;

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

      const noteSection = newNote
      ? `
        <div style="margin-top:20px;padding:15px;border-radius:8px;background:#f8f9fa;border:1px solid #e0e0e0;">
          <h3 style="margin:0 0 10px 0;font-size:16px;">📝 Nota agregada</h3>
          <p style="
            margin:0;
            white-space:pre-wrap;
            word-break:break-word;
            overflow-wrap:break-word;
            line-height:1.6;
            font-size:14px;
          ">
            ${newNote}
          </p>
        </div>
      `
      : '';

      const outro = `
        ${noteSection}

        <p style="margin-top:20px;">
          Este es un mensaje automático del sistema de Solicitudes Generales.
          Se ha agregado una nueva nota a la solicitud #${request?.id}.
          Si tiene alguna pregunta, por favor contacte al administrador del sistema.
        </p>
      `;

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
    const validationErrors = validateFields();
    if (Object.keys(validationErrors).length > 0) {
      setUpdateMessage({
        type: 'error',
        text:
          Object.values(validationErrors)[0] ||
          'Faltan campos obligatorios. Revisa el asunto, la categoría, la descripción y la resolución.',
      });
      return;
    }

    setIsUpdating(true);
    setUpdateMessage(null);

    const processChanged =
      originalRequest?.id_process_category !== request?.id_process_category;
      

    if (processChanged) {
      await addSystemNote('Se ha cambiado la categoría de la solicitud');
    }

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

      const isReturning = Number(resolutionData.estado) === RETURNED_STATUS_ID;
      const motivo = resolutionData.resolucion?.trim() || '';

      const updateData = {
        id: request?.id,
        id_technical: userId,
        process_category: request?.id_process_category ? Number(request.id_process_category) : null,
        status: resolutionData.estado !== ''
          ? Number(resolutionData.estado)
          : Number(request?.id_status_case),
        resolucion: isReturning ? null : (resolutionData.resolucion || null),
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
        const chosenStatus = Number(resolutionData.estado);
        const statusLabel =
          chosenStatus === RETURNED_STATUS_ID
            ? 'Devuelta'
            : chosenStatus === 2
            ? 'Resuelto'
            : chosenStatus === 3
            ? 'Cancelado'
            : (request?.status ?? '');
        setRequest((prev) =>
          prev
            ? {
                ...prev,
                status: statusLabel,
                id_status_case: chosenStatus,
                status_req: chosenStatus,
              }
            : null
        );
      }

      setOriginalRequest(request);
      setIsEditing(false);

      if (attachedFiles.length > 0) {
        setTimeout(() => fetchFolderContents(), 2000);
      }

      if (resolutionData.estado) {
        const chosenStatus = Number(resolutionData.estado);

        setResolutionData({
          ...resolutionData,
          estado: '',
          resolucion: '',
          notificarPorCorreo: false,
        });
        setShowResolution(false);

        if (isReturning) {
          // Devolver: nota con el motivo, sin notificación de cierre.
          await addSystemNote(`Solicitud devuelta. Motivo: ${motivo}`);
        } else {
          if (isClosedStatusId(chosenStatus)) {
            showClosureNotification({
              type: 'request',
              id: request?.id,
              subject: request?.subject,
              status: chosenStatus === 3 ? 'cancelled' : 'resolved',
            });
          }
          await addSystemNote('Se ha cerrado la solicitud');
        }
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

  const handleReopenRequest = async () => {
    const motivo = reopenReason.trim();
    if (!motivo) {
      setReopenError('El motivo de la reapertura es obligatorio.');
      return;
    }
    if (!request?.id || !userId) return;

    setReopenSubmitting(true);
    setReopenError('');
    try {
      const response = await fetch('/api/requests-general/update-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: request.id,
          id_technical: userId,
          process_category: request.id_process_category
            ? Number(request.id_process_category)
            : null,
          status: OPEN_STATUS_ID,
          resolucion: null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al reabrir la solicitud');
      }

      await addSystemNote(`Solicitud reabierta. Motivo: ${motivo}`);

      setRequest((prev) =>
        prev
          ? {
              ...prev,
              status: 'En progreso',
              id_status_case: OPEN_STATUS_ID,
              status_req: OPEN_STATUS_ID,
            }
          : null
      );

      setReopenModalOpened(false);
      setReopenReason('');
      setUpdateMessage({
        type: 'success',
        text: 'Solicitud reabierta correctamente',
      });
    } catch (error) {
      console.error('Error reopening request:', error);
      setReopenError(
        error instanceof Error ? error.message : 'Error al reabrir la solicitud'
      );
    } finally {
      setReopenSubmitting(false);
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
    const statusText = request?.status?.toLowerCase() ?? '';
    const statusId = Number(request?.id_status_case ?? request?.status_req);
    // Una solicitud DEVUELTA no se considera cerrada: se puede editar / reabrir.
    if (statusId === RETURNED_STATUS_ID || statusText.includes('devuel')) {
      return false;
    }
    const closedByStatus =
      statusId === 2 ||
      statusId === 3 ||
      statusText.includes('resuelt') ||
      statusText.includes('cancel') ||
      statusText.includes('completad');

    return closedByStatus || Boolean(request?.resolution && request.resolution.trim() !== '');
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
        setSelectedNoteEmails([]);
        await fetchNotes(request.id);

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

  const handleFilesChange = (files: UploadedFile[]) => {
    setAttachedFiles(files);
  };

  useEffect(() => {
    if (!hasNotedUpload.current && attachedFiles.some((f) => f.status === 'success')) {
      hasNotedUpload.current = true;
      void addSystemNote('Se cargaron archivos a la solicitud.');
      void fetchFolderContents();
    }
  }, [attachedFiles]);

  const addSystemNote = async (text: string) => {
    if (!request?.id || !userId) return;

    try {
      const response = await fetch('/api/requests-general/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_request: request.id,
          note: text,
          created_by: userId,
        }),
      });

      if (response.ok) {
        await fetchNotes(request.id);
      } else {
        const errorData = await response.json();
        console.error('Error al agregar nota:', errorData.error);
      }
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  const handleViewTask = (task: ViewTasksRequestGeneral) => {
    sessionStorage.removeItem('selectedRequest');

    router.push(`/process/request-general/view-activities?id=${task.id}`);
  };

  const handleUpdateTaskAssigned = async (taskId: number, newUserId: string | null) => {
    if (!newUserId) return;
    try {
      setUpdatingAssigneeId(taskId);
      const response = await fetch('/api/requests-general/update-task-assigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, id_assigned: newUserId }),
      });
      if (response.ok) {
        toast.success('Asignado actualizado exitosamente');
        if (request?.id) await fetchTasksRG(request.id);
      } else {
        const err = await response.json().catch(() => ({}));
        console.error('Error al actualizar asignado:', err.error || response.statusText);
      }
    } catch (error) {
      console.error('Error updating task assignee:', error);
    } finally {
      setUpdatingAssigneeId(null);
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

  const getStatusColorTask = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'sin empezar':
        return 'gray';
      case 'abierto':
        return 'blue';
      case 'resuelto':
        return 'green';
      case 'cancelado':
        return 'red';
      default:
        return 'red';
    }
  };

  const getStatusTask = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'sin empezar':
        return 'Sin Empezar';
      case 'abierto':
        return 'En Progreso';
      case 'resuelto':
        return 'Resuelto';
      case 'cancelado':
        return 'Cancelado';
      default:
        return status || 'Desconocido';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pendiente':
        return 'orange';
      case 'en progreso':
      case 'abierto':
        return 'blue';
      case 'completada':
        return 'green';
      case 'devuelta':
      case 'devuelto':
        return 'orange';
      default:
        return 'gray';
    }
  };

  const getBreadcrumbHref = (from: string) => {
    switch (from) {
      case 'general-requests':
        return '/process/request-general/general-requests';
      case 'assigned-requests':
        return '/process/request-general/assigned-requests';
      case 'viewer-request':
        return '/process/request-general/viewer-request';
      case 'create-request':
      default:
        return '/process/request-general/create-request';
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Solicitudes Generales', href: getBreadcrumbHref(from) },
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
            <Alert icon={<IconCheck size={16} />} title='Solicitud Resuelta' color='teal' mb='4'>
              Esta solicitud ha sido resuelta y no se puede modificar.
            </Alert>
          )}
        </Card>

        <div className='flex flex-col lg:flex-row gap-6'>
          <div className='flex-1 order-2 lg:order-1 lg:sticky lg:top-6 self-start'>
            <Card
              shadow='sm'
              p='xl'
              radius='md'
              withBorder
              className='bg-white flex flex-col'
            >
              <Title order={3} mb='md' className='flex items-center gap-2'>
                <IconNote size={20} />
                Historial de Interacciones
              </Title>

              <ScrollArea h='calc(100vh - 420px)' className='mb-4' offsetScrollbars viewportRef={notesViewportRef}>
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
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setNoteData({
                        ...noteData,
                        notificarPorCorreo: checked,
                        correo: checked ? noteData.correo : '',
                      });
                      if (!checked) {
                        setSelectedNoteEmails([]);
                      }
                    }}
                    mb='sm'
                  />
                  {noteData.notificarPorCorreo && (
                    <MultiSelect
                      label='Correo electrónico de contacto'
                      placeholder='Buscar y seleccionar usuarios...'
                      data={availableUsers}
                      value={selectedNoteEmails}
                      onChange={(values) => {
                        setSelectedNoteEmails(values);
                        setNoteData({
                          ...noteData,
                          correo: values.join('; '),
                        });
                      }}
                      searchable
                      clearable
                      nothingFoundMessage='No se encontraron usuarios'
                      disabled={loadingUsers}
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
                      new Date(request.created_at).getTime() + 5 * 60 * 60 * 1000 
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
                  <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
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

                  <Card withBorder radius='md' p='md' bg='gray.0' mt='xs'>
                    <Group>
                      <IconFileDescription size={16} />
                      <Text size='sm'>{request?.subject}</Text>
                    </Group>
                  </Card>
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

                {request?.resolution && request.resolution.trim() !== '' && (
                  <div>
                    <Text fw={600} mb='xs'>
                      Resolución de la Solicitud
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
                              {processCategories.find((p) => p.value === request?.process)
                                ?.label || request?.process}
                            </Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                  </Grid>
                </div>

                <div>
                  <Group justify='space-between' mb='md'>
                    <Title order={4} className='flex items-center gap-2'>
                      <IconCheck size={18} className='text-green-6' />
                      Resolución de la Solicitud - Finalizar Solicitud
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

                  {!isRequestResolved() && isEditing && showResolution && canEdit && (
                    <Stack>
                      <Select
                        label='Estado de la solicitud'
                        placeholder='Selecciona estado'
                        data={[
                          { value: '2', label: 'Resuelto' },
                          { value: '3', label: 'Cancelado' },
                          { value: '7', label: 'Devolver' },
                        ]}
                        value={resolutionData.estado}
                        onChange={(val) =>
                          setResolutionData({ ...resolutionData, estado: val || '' })
                        }
                        error={formErrors.estado}
                      />
                      <Checkbox
                        label='¿Notificar por correo electrónico a los usuarios?'
                        checked={resolutionData.notificarPorCorreo}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          if (checked) {
                            const requesterEmail = request?.requester_email?.trim();
                            const defaultEmails = requesterEmail ? [requesterEmail] : [];
                            setSelectedEmails(defaultEmails);
                            setResolutionData({
                              ...resolutionData,
                              notificarPorCorreo: true,
                              correo: defaultEmails.join('; '),
                            });
                          } else {
                            setResolutionData({
                              ...resolutionData,
                              notificarPorCorreo: false,
                              correo: '',
                            });
                            setSelectedEmails([]);
                          }
                        }}
                        mb='sm'
                      />
                      {resolutionData.notificarPorCorreo && (
                        <MultiSelect
                          label='Correo electrónico de contacto'
                          placeholder='Buscar y seleccionar usuarios...'
                          data={availableUsers}
                          value={selectedEmails}
                          onChange={(values) => {
                            setSelectedEmails(values);
                            setResolutionData({
                              ...resolutionData,
                              correo: values.join('; '),
                            });
                          }}
                          searchable
                          clearable
                          nothingFoundMessage='No se encontraron usuarios'
                          error={formErrors.correo}
                          disabled={loadingUsers}
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

        {requestFormValues.length > 0 && (
          <Card shadow='sm' p='lg' radius='md' withBorder mt='6'>
            <Title order={3} mb='md' className='flex items-center gap-2'>
              <IconTag size={20} />
              Información adicional
            </Title>
            <Grid>
              {requestFormValues.map((fv) => (
                <Grid.Col span={{ base: 12, md: 6 }} key={fv.id}>
                  <Card withBorder radius='md' p='md'>
                    <Text size='xs' c='dimmed' fw={500} className='uppercase'>
                      {fv.field_label}
                    </Text>
                    <Text size='md' fw={600} mt={4}>
                      {fv.option_label || fv.value_text || '—'}
                    </Text>
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
          </Card>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconEye size={20} />
            Archivos Adjuntos
          </Title>

          {folderContents.length > 0 && (
            <Stack gap='sm' mb='md'>
              <Group justify="space-between" mb="sm">
                <Text size="sm" fw={500}>
                  Archivos existentes en la solicitud ({folderContents.length})
                </Text>

                <Button
                  size="xs"
                  variant="light"
                  color="blue"
                  onClick={downloadAllFilesAsZip}
                  disabled={loadingDownload}
                >
                  Descargar todos
                </Button>
              </Group>
              <ScrollArea.Autosize mah={360} offsetScrollbars type='auto'>
                <Stack gap='sm'>
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
              </ScrollArea.Autosize>
            </Stack>
          )}

          <FileUpload
            ticketId={request.id}
            onFilesChange={handleFilesChange}
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
              {Number(request.id_status_case ?? request.status_req) === RETURNED_STATUS_ID &&
                (canEdit ||
                  String(request.id_requester ?? '') === String(userId ?? '')) &&
                !loadingPermissions && (
                  <Button
                    color='orange'
                    onClick={() => {
                      setReopenReason('');
                      setReopenError('');
                      setReopenModalOpened(true);
                    }}
                    leftSection={<IconArrowBackUp size={16} />}
                  >
                    Reabrir solicitud
                  </Button>
                )}
              {isRequestResolved() && (
                <Text size='sm' color='dimmed'>
                  Las solicitudes completadas no se pueden modificar.
                </Text>
              )}
              {String(request.id_assigned_process_category || request.id_assigned_category || '') ===
                String(userId || '') && (
                <Button
                  color='blue'
                  onClick={() => {
                    setModalTasksOpened(true);
                    fetchTasksRG(request.id);
                  }}
                  leftSection={<IconTicket size={16} />}
                >
                  Ver Tareas
                </Button>
              )}
            </Group>

            {!canEdit && (
              <Button
                variant='outline'
                onClick={() => router.push('/process/request-general/create-request')}
                leftSection={<IconArrowLeft size={16} />}
              >
                Volver al Panel
              </Button>
            )}

            {canEdit && (
              <Button
                variant='outline'
                onClick={() => router.push('/process/request-general/assigned-requests')}
                leftSection={<IconArrowLeft size={16} />}
              >
                Volver al Panel
              </Button>
            )}
          </Group>
        </Card>

        <Modal
          opened={reopenModalOpened}
          onClose={() => {
            if (!reopenSubmitting) setReopenModalOpened(false);
          }}
          title={
            <Text fw={600} size="lg">
              Reabrir solicitud #{request?.id}
            </Text>
          }
          centered
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              La solicitud volverá a estado &quot;En progreso&quot;. Indica el motivo de la
              reapertura; quedará registrado como nota.
            </Text>
            <Textarea
              label="Motivo de la reapertura"
              placeholder="Escribe el motivo..."
              autosize
              minRows={3}
              value={reopenReason}
              onChange={(e) => {
                setReopenReason(e.currentTarget.value);
                if (reopenError) setReopenError('');
              }}
              error={reopenError || undefined}
              withAsterisk
            />
            <Group justify="flex-end">
              <Button
                variant="outline"
                color="gray"
                onClick={() => setReopenModalOpened(false)}
                disabled={reopenSubmitting}
              >
                Cancelar
              </Button>
              <Button
                color="orange"
                leftSection={<IconArrowBackUp size={16} />}
                onClick={handleReopenRequest}
                loading={reopenSubmitting}
              >
                Reabrir
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={modalTasksOpened}
          onClose={() => setModalTasksOpened(false)}
          title={
            <Text fw={600} size="lg">
              Tareas Asignadas - Solicitud #{request?.id}
            </Text>
          }
          size="xl"
          centered
        >
          {loadingTaskRG ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <Text>Cargando tareas...</Text>
            </div>
          ) : taskRQ.length > 0 ? (
<ScrollArea.Autosize mah="65vh" offsetScrollbars>
              <Stack gap={0}>
              {[...taskRQ]
                .sort((a, b) => {
                  const da = a.display_order ?? 0;
                  const db = b.display_order ?? 0;
                  if (da !== db) return da - db;
                  return a.id_task - b.id_task;
                })
                .map((task, index, arr) => {
                  const isLast = index === arr.length - 1;
                  const statusLower = task.status?.toLowerCase();
                  const isResolved = task.id_status === 2 || statusLower === 'resuelto';
                  const isCancelled = task.id_status === 3 || statusLower === 'cancelado';
                  const isLocked = !!task.locked;
                  const bulletColor = isResolved
                    ? 'green'
                    : isCancelled
                    ? 'red'
                    : isLocked
                    ? 'gray'
                    : 'blue';
                  const fmtDate = (d?: string) =>
                    d
                      ? new Intl.DateTimeFormat('es-CO', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        }).format(new Date(d))
                      : 'N/A';
                  return (
                    <Flex key={task.id} gap="md" align="stretch">
                      <Flex direction="column" align="center" style={{ flexShrink: 0 }}>
                        <ThemeIcon
                          radius="xl"
                          size={36}
                          color={bulletColor}
                          variant={isLocked ? 'light' : 'filled'}
                        >
                          {isResolved ? (
                            <IconCheck size={18} />
                          ) : isCancelled ? (
                            <IconX size={18} />
                          ) : isLocked ? (
                            <IconLock size={16} />
                          ) : (
                            <Text fw={700} size="sm" c="white">
                              {index + 1}
                            </Text>
                          )}
                        </ThemeIcon>
                        {!isLast && (
                          <Box
                            style={{
                              flex: 1,
                              width: 2,
                              minHeight: 20,
                              backgroundColor: isResolved
                                ? 'var(--mantine-color-green-5)'
                                : 'var(--mantine-color-default-border)',
                            }}
                          />
                        )}
                      </Flex>
                      <Paper
                        withBorder
                        p="sm"
                        radius="md"
                        mb="sm"
                        style={{ flex: 1, minWidth: 0, opacity: isLocked ? 0.75 : 1 }}
                      >
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Group gap={8} mb={6}>
                              <Text fw={600}>{task.task}</Text>
                              <Badge
                                color={getStatusColorTask(task.status)}
                                size="sm"
                                styles={{
                                  root: { maxWidth: 'unset' },
                                  label: { overflow: 'visible' },
                                }}
                              >
                                {getStatusTask(task.status)}
                              </Badge>
                              <Badge
                                color={task.is_sequential ? 'grape' : 'gray'}
                                variant="light"
                                size="sm"
                              >
                                {task.is_sequential ? 'Secuencial' : 'Paralela'}
                              </Badge>
                              {isLocked && (
                                <Badge
                                  color="orange"
                                  variant="light"
                                  size="sm"
                                  leftSection={<IconLock size={12} />}
                                >
                                  Bloqueada
                                </Badge>
                              )}
                            </Group>
                            <Group gap={6} align="center" mb={8} wrap="nowrap">
                              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                Asignado:
                              </Text>
                              {isResolved ? (
                                <Text size="sm">{task.name}</Text>
                              ) : (
                                <Select
                                  data={assignableUsers}
                                  value={task.id_assigned ? String(task.id_assigned) : null}
                                  onChange={(value) => handleUpdateTaskAssigned(task.id, value)}
                                  searchable
                                  allowDeselect={false}
                                  disabled={updatingAssigneeId === task.id}
                                  size="xs"
                                  comboboxProps={{ withinPortal: true }}
                                  style={{ minWidth: 220 }}
                                />
                              )}
                            </Group>
                            <Group gap="lg">
                              <Text size="xs" c="dimmed">
                                Inicio: {fmtDate(task.start_date)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                Fin: {fmtDate(task.end_date)}
                              </Text>
                            </Group>
                            {task.resolution && (
                              <Text size="sm" mt={6}>
                                <Text span fw={500}>
                                  Resolución:{' '}
                                </Text>
                                {task.resolution}
                              </Text>
                            )}
                            {isLocked && (
                              <Group gap={4} mt={8} wrap="nowrap">
                                <IconLock size={13} color="var(--mantine-color-orange-6)" />
                                <Text size="xs" c="orange">
                                  Esperando que se resuelva la tarea anterior.
                                </Text>
                              </Group>
                            )}
                          </Box>
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            onClick={() => handleViewTask(task)}
                            disabled={isLocked}
                            title={
                              isLocked
                                ? 'Bloqueada: primero debe resolverse la tarea anterior'
                                : 'Ver / resolver tarea'
                            }
                            style={{ flexShrink: 0 }}
                          >
                            <IconEye size={18} />
                          </ActionIcon>
                        </Group>
                      </Paper>
                    </Flex>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
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
