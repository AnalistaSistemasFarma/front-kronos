'use client';

import { Suspense, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
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
  Table,
  UnstyledButton,
  Tooltip,
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
} from '@tabler/icons-react';
import Link from 'next/link';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';
import {
  hydrateAttachments,
  mergeListedWithPending,
  rememberPendingAttachment,
  removeFromAttachmentCache,
} from '../../../../../lib/attachments/pendingOptimistic';
import { ORION_SIGNATURE_FIELD_TYPE } from '../../../../../lib/orion/fieldType';
import { allSlotsCompletedForEmail, getCurrentPendingSigner, isSignerCompleted } from '../../../../../lib/orion/signerStatus';
import {
  parseOrionSignatureBagBag,
  resolveOrionDocumentForAttachment,
} from '../../../../../lib/orion/formValue';
import {
  canViewOrionDocumentVersions,
  isOrionDocumentSigner,
  resolveOrionPdfUrl,
} from '../../../../../lib/orion/documentVersions';
import { resolveOrionPdfAccessUrl } from '../../../../../lib/orion/signedFileAccess';
import { resolveRequestPdfAccessUrl } from '../../../../../lib/attachments/fileUrl';
import { mergeOneDriveWithOrionDocuments } from '../../../../../lib/orion/attachmentList';
import type { OrionSignatureState } from '../../../../../lib/orion/types';
import { buildOrionParticipants } from '../../../../../lib/orion/participants';
import {
  isOrionSignerAuthResolution,
  isOrionWorkflowResolution,
  parseOrionFileIdFromResolution,
} from '../../../../../lib/orion/signerAuthMarkers';
import { isSynerlinkWorkflowLocked } from '../../../../../lib/orion/workflowLock';
import OrionSignaturePanel from '../../../../../components/orion/OrionSignaturePanel';
import { OrionSignatureProvider } from '../../../../../components/orion/OrionSignatureContext';
import OrionAttachmentTableRow from '../../../../../components/orion/OrionAttachmentTableRow';
import OrionDocumentVersionsButton from '../../../../../components/orion/OrionDocumentVersionsButton';
import { isOrionDocumentInteractionNote } from '../../../../../lib/orion/interactionNotes';

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
  requester_email?: string | null;
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
  is_sequential?: boolean;
  locked?: boolean;
  display_order?: number;
}

interface UserEmail {
  value: string;
  label: string;
}

function formatActivityDate(
  value?: string | null,
  options?: { offsetHours?: number }
): string {
  if (!value) return '—';
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) return '—';
  const offsetMs = (options?.offsetHours ?? 0) * 60 * 60 * 1000;
  const date = new Date(base.getTime() + offsetMs);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function getFolderFileUrl(file: FolderFile): string | null {
  const download = file['@microsoft.graph.downloadUrl'];
  if (typeof download === 'string' && download.trim()) return download;
  return file.webUrl ?? null;
}

function ViewRequestPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const requestIdParam = searchParams.get('requestId');
  const from = searchParams.get('from') || searchParams.get('mode') || 'assigned-activities';
  const orionFileIdParam = searchParams.get('orionFileId');
  const orionActionParam = searchParams.get('orionAction') as 'sign' | 'manage' | 'view' | null;
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
  const [userId, setUserId] = useState<string | number | null>(null);
  const userIdFetchRef = useRef(false);
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
  const [folderContents, setFolderContents] = useState<FolderFile[]>([]);
  const [canDeleteAttachments, setCanDeleteAttachments] = useState(false);
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
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<UserEmail[]>([]);
  const [selectedNoteEmails, setSelectedNoteEmails] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [requestFormValues, setRequestFormValues] = useState<
    {
      id: number;
      id_form_field?: number;
      field_label: string;
      field_type?: string | null;
      config_json?: string | null;
      option_label: string | null;
      value_text: string | null;
    }[]
  >([]);
  const lastOrionFormFetchKeyRef = useRef('');
  const [orionDocuments, setOrionDocuments] = useState<Record<string, OrionSignatureState>>({});

  useEffect(() => {
    // No usar selectedRequest de otra pantalla: suele ser solicitud (sin id_request_general)
    // y pinta "Tarea #2147" vacío mientras el fetch falla.
    try {
      const storedRequest = sessionStorage.getItem('selectedRequest');
      if (storedRequest) {
        const requestData = JSON.parse(storedRequest);
        const looksLikeTask =
          requestData &&
          typeof requestData === 'object' &&
          requestData.id_request_general != null &&
          (id == null || String(requestData.id) === String(id));
        if (looksLikeTask) {
          setRequest(requestData);
          setOriginalRequest(requestData);
          setLoading(false);
        } else {
          sessionStorage.removeItem('selectedRequest');
        }
      }
    } catch {
      try {
        sessionStorage.removeItem('selectedRequest');
      } catch {
        /* ignore */
      }
    }

    if (!id && !requestIdParam) return;

    const loadTask = async () => {
      try {
        let res: Response;
        if (id) {
          res = await fetch(`/api/requests-general/view-activities?id=${id}`);
          // Deep-link legacy / notificaciones: a veces llega id_request_general en lugar del id de tarea
          if (!res.ok) {
            const qs = new URLSearchParams({ requestId: String(id) });
            if (orionFileIdParam) qs.set('fileId', orionFileIdParam);
            res = await fetch(`/api/requests-general/view-activities?${qs.toString()}`);
          }
        } else {
          const qs = new URLSearchParams({ requestId: String(requestIdParam) });
          if (orionFileIdParam) qs.set('fileId', orionFileIdParam);
          res = await fetch(`/api/requests-general/view-activities?${qs.toString()}`);
        }

        if (!res.ok) {
          // Si venía el id de solicitud, ir al detalle de solicitud (no a una tarea fantasma).
          const maybeRequestId = Number(id || requestIdParam);
          if (Number.isInteger(maybeRequestId) && maybeRequestId > 0) {
            router.replace(
              `/process/request-general/view-request?id=${maybeRequestId}&from=${encodeURIComponent(from)}`
            );
            return;
          }
          throw new Error('Error al cargar la tarea');
        }

        const data = await res.json();
        const mappedData = {
          ...data,
          resolution: data.resolutioncase || data.resolution || null,
          date_resolution: data.date_resolution || null,
        };
        setRequest(mappedData);
        setOriginalRequest(mappedData);
        setError(null);
        setLoading(false);
        try {
          sessionStorage.setItem('selectedRequest', JSON.stringify(mappedData));
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error('Error fetching request:', err);
        setError('No se pudo cargar la tarea. Por favor intente nuevamente.');
        setLoading(false);
      }
    };

    void loadTask();
  }, [id, requestIdParam, from, orionFileIdParam, router]);

  useEffect(() => {
    if (request) {
      if (request.id_request_general) {
        setFolderContents((prev) =>
          prev.length > 0
            ? prev
            : (hydrateAttachments(request.id_request_general) as typeof prev)
        );
      }
      fetchNotes();
      fetchFolderContents();
      fetchTasksRG();
      if (request.id_request_general) {
        void fetchFormValues(request.id_request_general);
      }
      void fetch('/api/requests-general/attachment-permissions')
        .then((r) => r.json())
        .then((data) => {
          setCanDeleteAttachments(Boolean(data?.canDeleteAttachments));
        })
        .catch(() => setCanDeleteAttachments(false));
    }
  }, [request]);

  useEffect(() => {
    if (notesViewportRef.current) {
      notesViewportRef.current.scrollTop = notesViewportRef.current.scrollHeight;
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
    if (status !== 'authenticated') return;
    if (session?.user?.id != null) {
      setUserId(session.user.id);
      return;
    }
    if (!userName || userId || userIdFetchRef.current) return;
    userIdFetchRef.current = true;
    getUserIdByName(userName)
      .then((id) => {
        if (id) setUserId(id);
      })
      .finally(() => {
        userIdFetchRef.current = false;
      });
  }, [status, session?.user?.id, userName, userId]);

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
        const list = Array.isArray(data) ? [...data] : [];
        list.sort((a, b) => {
          const da = new Date(a.creation_date || 0).getTime();
          const db = new Date(b.creation_date || 0).getTime();
          if (da !== db) return da - db;
          return Number(a.id_note || 0) - Number(b.id_note || 0);
        });
        // Historial de interacciones: solo notas humanas; progreso de documentos va en Archivos adjuntos.
        setNotes(list.filter((n) => !isOrionDocumentInteractionNote(n.note)));
      } else {
        console.error('Error al cargar notas');
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoadingNotes(false);
    }
  };

  const fetchUsersWithEmails = async (attempt = 0) => {
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
        return;
      }
      if (response.status === 499) return;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        return fetchUsersWithEmails(attempt + 1);
      }
      const errorData = await response.json().catch(() => ({}));
      console.error('Error al cargar usuarios:', errorData.error || response.statusText);
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        return fetchUsersWithEmails(attempt + 1);
      }
      console.error('Error cargando usuarios:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsersWithEmails();
  }, []);

  const fetchFolderContents = async () => {
    if (!request?.id_request_general) return;
    const requestId = request.id_request_general;

    try {
      const response = await fetch(
        `/api/requests-general/list-attachments?requestId=${encodeURIComponent(String(requestId))}&storagePath=SG&entityType=Request`
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        files?: Array<{
          id: string;
          name: string;
          size?: number;
          lastModifiedDateTime?: string;
          webUrl?: string;
          '@microsoft.graph.downloadUrl'?: string;
        }>;
      };
      if (!response.ok) {
        throw new Error(data.error || `Error listando adjuntos (HTTP ${response.status})`);
      }

      const files = Array.isArray(data.files) ? data.files : [];
      setFolderContents((prev) => mergeListedWithPending(requestId, files, prev));
    } catch (error) {
      console.error('Error al listar los archivos de la carpeta:', error);
      setFolderContents((prev) => mergeListedWithPending(requestId, null, prev));
    }
  };

  const refreshAttachmentsAfterUpload = useCallback(() => {
    window.setTimeout(() => {
      void fetchFolderContents();
    }, 600);
    window.setTimeout(() => {
      void fetchFolderContents();
    }, 2000);
    window.setTimeout(() => {
      void fetchFolderContents();
    }, 5000);
  }, [request?.id_request_general]);

  const handleDeleteAttachment = useCallback(
    async (fileId: string) => {
      const requestId = request?.id_request_general;
      if (!requestId || !fileId) return;
      try {
        const res = await fetch('/api/requests-general/delete-attachment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, fileId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof data.error === 'string' ? data.error : 'No se pudo eliminar');
          return;
        }
        setFolderContents((prev) => prev.filter((f) => String(f.id) !== String(fileId)));
        if (requestId) removeFromAttachmentCache(requestId, fileId);
        setOrionDocuments((prev) => {
          if (!prev[fileId]) return prev;
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
        toast.success('Archivo eliminado');
        refreshAttachmentsAfterUpload();
      } catch {
        toast.error('Error de red al eliminar el archivo');
      }
    },
    [request?.id_request_general, refreshAttachmentsAfterUpload]
  );

  const downloadAllFilesAsZip = async () => {
    setLoadingOptions(true);
    if (!attachmentRows.length) return;

    try {
      const zip = new JSZip();

      for (const file of attachmentRows) {
        const url = resolveAttachmentDownloadUrl(file);

        if (!url) continue;

        const response = await axios.get(url, {
          responseType: 'blob',
          withCredentials: url.startsWith('/api/'),
        });

        const orionState = getOrionDocForFile(String(file.id));
        const hasSignedVersion =
          /\.pdf$/i.test(file.name) &&
          Boolean(orionState?.signedFileUrl || (orionState?.versions ?? []).some((v) => v.kind !== 'original'));
        const fileName =
          hasSignedVersion && /\.pdf$/i.test(file.name)
            ? file.name.replace(/\.pdf$/i, '-firmado.pdf')
            : file.name;

        zip.file(fileName, response.data);
      }

      const content = await zip.generateAsync({ type: 'blob' });

      if (!request) return;

      saveAs(content, `Request-${request.id_request_general}.zip`);
      setLoadingOptions(false);
    } catch (error) {
      console.error('Error descargando archivos en ZIP:', error);
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

  const orionValueText = useMemo(() => {
    const field = requestFormValues.find((fv) => fv.field_type === ORION_SIGNATURE_FIELD_TYPE);
    return field?.value_text ?? null;
  }, [requestFormValues]);

  const orionInitialDocuments = useMemo(
    () => parseOrionSignatureBagBag(orionValueText).documents,
    [orionValueText]
  );

  const attachmentRows = useMemo(
    () =>
      mergeOneDriveWithOrionDocuments(folderContents, {
        ...orionInitialDocuments,
        ...orionDocuments,
      }),
    [folderContents, orionInitialDocuments, orionDocuments]
  );

  useEffect(() => {
    setOrionDocuments(orionInitialDocuments);
  }, [orionInitialDocuments]);

  const getOrionDocForFile = useCallback(
    (fileId: string, fileName?: string | null) =>
      resolveOrionDocumentForAttachment({
        fileId,
        fileName,
        documents: { ...orionInitialDocuments, ...orionDocuments },
        fallback: orionDocuments[fileId] ?? orionInitialDocuments[fileId],
      }),
    [orionDocuments, orionInitialDocuments]
  );

  const resolveAttachmentDownloadUrl = useCallback(
    (file: FolderFile): string | null => {
      const original = getFolderFileUrl(file);
      if (!request?.id_request_general) {
        if (!/\.pdf$/i.test(file.name)) return original;
        return resolveOrionPdfUrl(getOrionDocForFile(String(file.id), file.name), original) ?? original;
      }
      if (!/\.pdf$/i.test(file.name)) {
        return resolveRequestPdfAccessUrl({
          requestId: request.id_request_general,
          fileId: String(file.id),
          download: true,
        });
      }
      return resolveRequestPdfAccessUrl({
        requestId: request.id_request_general,
        fileId: String(file.id),
        state: getOrionDocForFile(String(file.id), file.name),
      });
    },
    [getOrionDocForFile, request?.id_request_general]
  );

  const canViewOrionVersions = canViewOrionDocumentVersions({
    isAdmin,
    currentUserId: session?.user?.id,
    requesterId: request?.id_requester,
    currentUserEmail: session?.user?.email,
    requesterEmail: request?.requester_email,
    isSigner: Object.values({ ...orionInitialDocuments, ...orionDocuments }).some((doc) =>
      isOrionDocumentSigner(doc, session?.user?.email)
    ),
  });

  const handleOrionDocumentsChange = useCallback(
    (documents: Record<string, OrionSignatureState>) => {
      setOrionDocuments((prev) => {
        const movedIds = Object.entries(documents)
          .filter(
            ([id, doc]) =>
              Boolean(doc?.orionDocumentId) && !prev[id]?.orionDocumentId
          )
          .map(([id]) => id);
        const reqId = request?.id_request_general;
        if (movedIds.length > 0 && reqId) {
          queueMicrotask(() => {
            setFolderContents((files) =>
              files.filter((f) => !movedIds.includes(String(f.id)))
            );
            for (const id of movedIds) removeFromAttachmentCache(reqId, id);
            window.setTimeout(() => {
              void fetch(
                `/api/requests-general/list-attachments?requestId=${encodeURIComponent(String(reqId))}&storagePath=SG&entityType=Request`
              )
                .then((r) => r.json())
                .then((data) => {
                  if (!Array.isArray(data.files)) return;
                  setFolderContents((prevFiles) =>
                    mergeListedWithPending(reqId, data.files, prevFiles)
                  );
                })
                .catch(() => undefined);
            }, 400);
          });
        }
        return documents;
      });
      if (!request?.id_request_general) return;
      const fetchKey = JSON.stringify(
        Object.entries(documents).map(([id, doc]) => [
          id,
          doc.status,
          doc.signedFileUrl,
        ])
      );
      if (fetchKey === lastOrionFormFetchKeyRef.current) return;
      const shouldRefresh = Object.values(documents).some((doc) => {
        const status = String(doc.status || '').toUpperCase();
        return (
          status === 'FIRMADO' ||
          status === 'RECHAZADO' ||
          status === 'DEVUELTO' ||
          Boolean(doc.signedFileUrl)
        );
      });
      if (!shouldRefresh) return;
      lastOrionFormFetchKeyRef.current = fetchKey;
      void fetchFormValues(request.id_request_general);
    },
    [request?.id_request_general]
  );

  const orionParticipants = useMemo(
    () =>
      buildOrionParticipants({
        requesterName: request?.name_requester,
        requesterEmail: request?.requester_email,
        assigneeName: request?.assigned,
        currentUserEmail: session?.user?.email,
        users: availableUsers,
        tasks: taskRQ.map((t) => ({ name: t.name, id_assigned: t.id_assigned })),
      }),
    [
      availableUsers,
      request?.assigned,
      request?.name_requester,
      request?.requester_email,
      session?.user?.email,
      taskRQ,
    ]
  );

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
          'Fecha de Creación': (() => {
            if (!request?.created_at) return 'N/A';
            const d = new Date(request.created_at);
            return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().split('T')[0];
          })(),
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

    // Tareas secuenciales: si esta tarea está bloqueada (la anterior no está cerrada), no permitir
    const lockedNow = taskRQ.find((t) => t.id === request?.id)?.locked;
    if (lockedNow) {
      setUpdateMessage({
        type: 'error',
        text: 'Esta tarea está bloqueada: primero debe resolverse la tarea anterior.',
      });
      return;
    }

    const currentStatus = resolutionData.estado
      ? Number(resolutionData.estado) 
      : request?.id_status;

    if (
      currentStatus === 2 &&
      (!resolutionData.resolucion || resolutionData.resolucion.trim() === '')
    ) {
      setUpdateMessage({
        type: 'error',
        text: 'No se puede cerrar la tarea ya que no hay descripción de la resolución.',
      });
      return;
    }
    
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

    const statusChangedFrom2To1 =
      (originalRequest?.id_status === 1 || originalRequest?.id_status ===4) &&
      Number(resolutionData.estado) === 2;

    if (processChanged) {
      await addSystemNote('Se ha cambiado la categoría de la solicitud');
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

      if (statusChangedFrom2To1) {
        await addSystemNote(resolutionData.resolucion);
      }

      await fetchRequestData();
      await fetchTasksRG();

      setIsEditing(false);

      if (attachedFiles.length > 0) {
        setTimeout(() => fetchFolderContents(), 2000);
      }

      if (resolutionData.estado) {
        const closedStatus = Number(resolutionData.estado);
        if (closedStatus === 2) {
          showClosureNotification({
            type: 'activity',
            id: request?.id_request_general,
            subject: request?.task ?? request?.subject_request,
            status: 'resolved',
          });
        }

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

  // Tarea actual bloqueada por secuencia (la anterior no está cerrada)
  const currentTaskLocked = taskRQ.find((t) => t.id === request?.id)?.locked ?? false;

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  /** Cierre de la TAREA actual (tablero de actividades). */
  const isTaskResolved = () => {
    const statusId = Number(request?.id_status);
    if (statusId === 2 || statusId === 3) return true;
    const label = String(request?.status_task || '').toLowerCase();
    return (
      label.includes('completad') ||
      label.includes('resuelt') ||
      label.includes('cancel')
    );
  };

  /** Cierre de la SOLICITUD (status_req). Firmar un PDF no cierra la solicitud. */
  const isRequestCaseClosed = () => {
    const statusReq = Number(request?.status_req);
    return statusReq === 2 || statusReq === 3;
  };

  /** Compat: bloqueos de UI de tarea usan cierre de tarea, no de solicitud. */
  const isRequestResolved = () => isTaskResolved();

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
        setSelectedNoteEmails([]);
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

  const statusOptions = (() => {

    if (request?.id_status === 1) {
      return [
        { value: '2', label: 'Resuelto' }
      ];
    }

    if (request?.id_status === 4) {
      return [
        { value: '1', label: 'En progreso' }
      ];
    }

    return [
      { value: '1', label: 'En progreso' },
      { value: '2', label: 'Resuelto' },
    ];
  })();

  const getStatusColor = (status: string) => {
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

  const getStatusLabel = (status: string) => {
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

  const hasOrionSignatureField = requestFormValues.some(
    (fv) => fv.field_type === ORION_SIGNATURE_FIELD_TYPE
  );
  const hasOrionDocuments = Object.keys(orionInitialDocuments).length > 0;
  const taskOrionFileId = parseOrionFileIdFromResolution(request?.resolution);
  const taskPendingOrionAuth = isOrionSignerAuthResolution(request?.resolution);
  const hasPdfAttachments = attachmentRows.some((f) => /\.pdf$/i.test(f.name));
  const showOrionPanel =
    hasPdfAttachments ||
    hasOrionSignatureField ||
    hasOrionDocuments ||
    Boolean(taskOrionFileId) ||
    taskPendingOrionAuth ||
    from === 'authorization' ||
    from === 'assigned-activities';
  const currentUserEmailNorm = String(session?.user?.email || '')
    .trim()
    .toLowerCase();
  const userIsCurrentOrionSigner = Object.values({
    ...orionInitialDocuments,
    ...orionDocuments,
  }).some((doc) => {
    const pending = getCurrentPendingSigner(doc.signers);
    if (!pending || !currentUserEmailNorm) return false;
    return String(pending.email || '').trim().toLowerCase() === currentUserEmailNorm;
  });
  const userAlreadySignedOrion = Object.values({
    ...orionInitialDocuments,
    ...orionDocuments,
  }).some((doc) =>
    (doc.signers ?? []).some(
      (s) =>
        String(s.email || '').trim().toLowerCase() === currentUserEmailNorm &&
        isSignerCompleted(s.status)
    )
  );
  const orionWorkflowLocked =
    isRequestResolved() ||
    isSynerlinkWorkflowLocked({
      taskStatusId: request?.id_status,
      taskStatusLabel: request?.status_task,
      taskResolution: request?.resolution,
      requestStatusReq: request?.status_req,
    });
  const autoOpenFile = orionFileIdParam
    ? attachmentRows.find(
        (f) => String(f.id) === String(orionFileIdParam) && /\.pdf$/i.test(f.name)
      )
    : undefined;
  const autoOpenPdfUrl = autoOpenFile ? getFolderFileUrl(autoOpenFile) : null;
  // Solo abrir firma con acción explícita (no por from=authorization solo).
  const fallbackSignFile =
    !autoOpenFile && orionActionParam === 'sign'
      ? attachmentRows.find((f) => /\.pdf$/i.test(f.name))
      : undefined;
  const deepLinkFileId = autoOpenFile
    ? String(autoOpenFile.id)
    : fallbackSignFile
      ? String(fallbackSignFile.id)
      : null;
  const deepLinkPdfUrl = deepLinkFileId
    ? resolveRequestPdfAccessUrl({
        requestId: request.id_request_general,
        fileId: deepLinkFileId,
        state: getOrionDocForFile(deepLinkFileId),
      })
    : autoOpenPdfUrl || (fallbackSignFile ? getFolderFileUrl(fallbackSignFile) : null);
  const deepLinkAction: 'sign' | 'manage' | 'view' | null = (() => {
    const raw: 'sign' | 'manage' | 'view' | null =
      orionActionParam === 'sign' || orionActionParam === 'manage' || orionActionParam === 'view'
        ? orionActionParam
        : orionFileIdParam
          ? 'sign'
          : null;
    if (raw !== 'sign' || !deepLinkFileId || !currentUserEmailNorm) return raw;
    const doc =
      orionDocuments[deepLinkFileId] ||
      orionInitialDocuments[deepLinkFileId] ||
      {};
    if (allSlotsCompletedForEmail(doc.signers, currentUserEmailNorm)) return null;
    const pending = getCurrentPendingSigner(doc.signers);
    if (
      pending &&
      String(pending.email || '').trim().toLowerCase() !== currentUserEmailNorm
    ) {
      return null;
    }
    const st = String(doc.status || '').toUpperCase();
    if (st === 'FIRMADO' || st === 'RECHAZADO') return null;
    return raw;
  })();

  return (
    <OrionSignatureProvider>
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
          <div className='flex-1 order-2 lg:order-1 min-w-0 space-y-5 lg:sticky lg:top-6 self-start'>
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
                        notificarPorCorreo: e.currentTarget.checked,
                        correo: e.currentTarget.checked ? noteData.correo : '',
                      })
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

            {showOrionPanel && (
              <OrionSignaturePanel
                requestId={request.id_request_general}
                requestTitle={request.subject_request}
                initialDocuments={orionInitialDocuments}
                createdByEmail={request.requester_email ?? undefined}
                requesterId={
                  request.id_requester != null ? String(request.id_requester) : null
                }
                currentUserEmail={session?.user?.email ?? undefined}
                currentUserId={
                  session?.user?.id != null ? String(session.user.id) : undefined
                }
                participants={orionParticipants}
                availableUsers={availableUsers}
                currentUserName={session?.user?.name ?? undefined}
                onDocumentsChange={handleOrionDocumentsChange}
                workflowLocked={orionWorkflowLocked}
                autoOpenFileId={deepLinkFileId}
                autoOpenAction={deepLinkAction}
                autoOpenFileName={
                  autoOpenFile?.name || fallbackSignFile?.name || null
                }
                autoOpenPdfUrl={deepLinkPdfUrl}
                fromAuthorization={from === 'authorization'}
              />
            )}
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
                  {formatActivityDate(request.created_at, { offsetHours: 5 })}
                </Text>
              </div>

              {request?.start_date && (
                <div className='pb-2'>
                  <Text size='sm' color='gray.6' fw={500}>
                    Fecha de Inicio de Ejecución
                  </Text>
                  <Text size='sm'>
                    {formatActivityDate(request.start_date)}
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

                {request?.resolution &&
                  request.resolution.trim() !== '' &&
                  !isOrionWorkflowResolution(request.resolution) && (
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

                {request?.resolution && isOrionWorkflowResolution(request.resolution) && (
                  <Alert color='blue' variant='light' title='Documento en firma (Orion)'>
                    <Text size='sm'>
                      Esta tarea forma parte del flujo de firma digital. Use el botón{' '}
                      <strong>Firmar</strong> en Archivos adjuntos.
                    </Text>
                  </Alert>
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

                  {isEditing ? (
                    <Stack>
                      <Select
                        label='Estado de la Tarea'
                        placeholder='Selecciona estado'
                        data={statusOptions}
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
                    {isEditing && (
                      <ActionIcon
                        variant='subtle'
                        onClick={() => setShowResolution(!showResolution)}
                      >
                        {showResolution ? <IconX size={16} /> : <IconCheck size={16} />}
                      </ActionIcon>
                    )}
                  </Group>

                  {isEditing && showResolution && (
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

                  <br />

                  {currentTaskLocked && (
                    <Alert color='gray' icon={<IconAlertCircle size={16} />} mb='md'>
                      Esta tarea está bloqueada hasta que se resuelva la tarea anterior.
                    </Alert>
                  )}

                  <Group justify='space-between'>
                    <Group>
                      {!isEditing ? (
                        <Button
                          color='blue'
                          onClick={handleStartEditing}
                          leftSection={<IconTicket size={16} />}
                          disabled={isRequestResolved() || currentTaskLocked}
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
                        onClick={() => {
                          setModalTasksOpened(true);
                          fetchTasksRG();
                        }}
                        leftSection={<IconTicket size={16} />}
                      >
                        Ver Tareas
                      </Button>
                    </Group>
                  </Group>
                </div>
              </Stack>
            </Card>
          </div>
        </div>

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
          <Group justify='space-between' align='center' mb='md' wrap='wrap'>
            <Title order={3} className='flex items-center gap-2'>
              <IconEye size={20} />
              Archivos adjuntos
              {attachmentRows.length > 0 ? (
                <Text span size='sm' c='dimmed' fw={400}>
                  ({attachmentRows.length})
                </Text>
              ) : null}
            </Title>
            {attachmentRows.length > 0 && (
              <Button
                size='xs'
                variant='light'
                color='blue'
                onClick={downloadAllFilesAsZip}
                disabled={loadingOptions}
              >
                Descargar todos
              </Button>
            )}
          </Group>

          {attachmentRows.length > 0 && (
            <ScrollArea.Autosize
              mah={{ base: 'none', sm: 560 }}
              offsetScrollbars
              type='auto'
              mb='md'
              className='doc-attachments-scroll'
            >
              <Table
                className={showOrionPanel ? 'doc-table doc-table--orion' : 'doc-table'}
                horizontalSpacing='md'
                verticalSpacing='sm'
                highlightOnHover
                withTableBorder
                style={{ width: '100%' }}
              >
                <Table.Thead>
                  <Table.Tr>
                    {showOrionPanel ? (
                      <>
                        <Table.Th className='doc-col--secondary'>N.º</Table.Th>
                        <Table.Th>Documento</Table.Th>
                        <Table.Th className='doc-col--secondary'>Departamento</Table.Th>
                        <Table.Th>Estado</Table.Th>
                        <Table.Th className='doc-col--secondary'>Firmantes</Table.Th>
                        <Table.Th className='doc-col--secondary'>Responsable</Table.Th>
                        <Table.Th>Acciones</Table.Th>
                      </>
                    ) : (
                      <>
                        <Table.Th>Documento</Table.Th>
                        <Table.Th style={{ width: 100 }}>Abrir</Table.Th>
                      </>
                    )}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {attachmentRows.map((file: FolderFile, fileIndex: number) => {
                    const fileId = String(file.id || taskOrionFileId || '');
                    const openUrl =
                      resolveAttachmentDownloadUrl(file) ?? file.webUrl ?? '#';
                    const sizeLabel = [
                      file.size ? formatFileSize(file.size) : null,
                      file.lastModifiedDateTime
                        ? new Date(file.lastModifiedDateTime).toLocaleDateString('es-CO')
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const isPdf = /\.pdf$/i.test(file.name);

                    if (showOrionPanel && isPdf) {
                      const orionState = getOrionDocForFile(String(file.id), file.name);
                      const pdfUrl = request.id_request_general
                        ? resolveRequestPdfAccessUrl({
                            requestId: request.id_request_general,
                            fileId: fileId || String(file.id),
                            state: orionState,
                          })
                        : '';
                      const orionLatest =
                        orionState?.orionDocumentId && request.id_request_general
                          ? resolveOrionPdfAccessUrl(orionState, null, {
                              requestId: request.id_request_general,
                              fileId: fileId || String(file.id),
                            })
                          : null;
                      return (
                        <OrionAttachmentTableRow
                          key={file.id}
                          rowNumber={fileIndex + 1}
                          requestId={request.id_request_general}
                          fileId={fileId || 'pdf'}
                          fileName={file.name}
                          pdfUrl={pdfUrl}
                          fileSizeLabel={sizeLabel}
                          openUrl={orionLatest || openUrl}
                          previewUrl={file.webUrl ?? null}
                          processName={request?.process || request?.category || null}
                          requesterName={request?.name_requester || null}
                          currentUserEmail={session?.user?.email}
                          currentUserId={
                            session?.user?.id != null ? String(session.user.id) : null
                          }
                          createdByEmail={
                            (request as { requester_email?: string })?.requester_email ?? null
                          }
                          requesterId={
                            (request as { id_requester?: string | number })?.id_requester != null
                              ? String(
                                  (request as { id_requester?: string | number }).id_requester
                                )
                              : null
                          }
                          fallbackState={orionState}
                          allDocuments={{
                            ...orionInitialDocuments,
                            ...orionDocuments,
                          }}
                          onDocumentsUpdate={handleOrionDocumentsChange}
                          canDeleteAttachment={canDeleteAttachments && !isRequestCaseClosed()}
                          onDeleteAttachment={handleDeleteAttachment}
                          forceSignerUi={(() => {
                            const me = String(session?.user?.email || '')
                              .trim()
                              .toLowerCase();
                            if (!me) return false;
                            if (allSlotsCompletedForEmail(orionState.signers, me)) return false;
                            const pending = getCurrentPendingSigner(orionState.signers);
                            const isMyTurn = Boolean(
                              pending &&
                                String(pending.email || '')
                                  .trim()
                                  .toLowerCase() === me
                            );
                            if (!isMyTurn) return false;
                            const fileMatch =
                              !orionFileIdParam ||
                              String(orionFileIdParam) ===
                                String(file.id || taskOrionFileId || '');
                            return (
                              ((from === 'authorization' || taskPendingOrionAuth) &&
                                fileMatch) ||
                              isMyTurn
                            );
                          })()}
                          versionsSlot={
                            <OrionDocumentVersionsButton
                              state={orionState}
                              fileName={file.name}
                              canView={canViewOrionVersions}
                              fallbackOriginalUrl={getFolderFileUrl(file)}
                              requestId={request.id_request_general}
                              fileId={fileId}
                            />
                          }
                        />
                      );
                    }

                    return (
                      <Table.Tr key={file.id}>
                        {showOrionPanel ? (
                          <>
                            <Table.Td data-label='N.º'>
                              <Text size='sm' c='dimmed'>
                                {fileIndex + 1}
                              </Text>
                            </Table.Td>
                            <Table.Td data-label='Documento'>
                              <Text size='sm' fw={700} lineClamp={2}>
                                {file.name}
                              </Text>
                              {sizeLabel ? (
                                <Text size='xs' c='dimmed' mt={2}>
                                  {sizeLabel}
                                </Text>
                              ) : null}
                            </Table.Td>
                            <Table.Td data-label='Departamento'>
                              <Text size='sm' lineClamp={2}>
                                {request?.process || request?.category || '—'}
                              </Text>
                            </Table.Td>
                            <Table.Td data-label='Estado'>
                              <Text size='sm' c='dimmed'>
                                —
                              </Text>
                            </Table.Td>
                            <Table.Td data-label='Firmantes'>
                              <Text size='sm' c='dimmed'>
                                —
                              </Text>
                            </Table.Td>
                            <Table.Td data-label='Responsable'>
                              <Text size='sm' lineClamp={1}>
                                {request?.name_requester || '—'}
                              </Text>
                            </Table.Td>
                            <Table.Td
                              data-label='Acciones'
                              style={{
                                borderLeft: '2px solid var(--mantine-color-blue-5)',
                              }}
                            >
                              <Group gap={6} wrap='nowrap'>
                                {file.webUrl ? (
                                  <Tooltip label='Ver en línea (sin descargar)'>
                                    <ActionIcon
                                      variant='subtle'
                                      color='blue'
                                      size='sm'
                                      component='a'
                                      href={file.webUrl}
                                      target='_blank'
                                      rel='noopener noreferrer'
                                      aria-label={`Ver en línea ${file.name}`}
                                    >
                                      <IconEye size={16} />
                                    </ActionIcon>
                                  </Tooltip>
                                ) : null}
                                <UnstyledButton
                                  component='a'
                                  href={openUrl}
                                  target='_blank'
                                  rel='noopener noreferrer'
                                  style={{
                                    fontSize: 13,
                                    color: 'var(--mantine-color-blue-6)',
                                    fontWeight: 600,
                                  }}
                                >
                                  Abrir
                                </UnstyledButton>
                              </Group>
                            </Table.Td>
                          </>
                        ) : (
                          <>
                            <Table.Td data-label='Documento'>
                              <Text size='sm' fw={600} lineClamp={2}>
                                {file.name}
                              </Text>
                              {sizeLabel ? (
                                <Text size='xs' c='dimmed' mt={2}>
                                  {sizeLabel}
                                </Text>
                              ) : null}
                            </Table.Td>
                            <Table.Td data-label='Abrir'>
                              <ActionIcon
                                variant='subtle'
                                color='blue'
                                size='sm'
                                component='a'
                                href={openUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                                aria-label={`Ver archivo ${file.name}`}
                              >
                                <IconEye size={16} />
                              </ActionIcon>
                            </Table.Td>
                          </>
                        )}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}

          <FileUpload
            ticketId={request.id_request_general}
            onFilesChange={setAttachedFiles}
            onUploadComplete={(uploaded) => {
              if (uploaded.graphItem?.id && request?.id_request_general) {
                const optimistic = {
                  id: uploaded.graphItem.id,
                  name: uploaded.graphItem.name || uploaded.file.name,
                  size: uploaded.graphItem.size ?? uploaded.file.size,
                  lastModifiedDateTime:
                    uploaded.graphItem.lastModifiedDateTime || new Date().toISOString(),
                  webUrl: uploaded.graphItem.webUrl || '',
                  ...(uploaded.graphItem['@microsoft.graph.downloadUrl']
                    ? {
                        '@microsoft.graph.downloadUrl':
                          uploaded.graphItem['@microsoft.graph.downloadUrl'],
                      }
                    : {}),
                };
                rememberPendingAttachment(request.id_request_general, optimistic);
                setFolderContents((prev) => {
                  if (prev.some((f) => String(f.id) === String(optimistic.id))) return prev;
                  return [...prev, optimistic];
                });
              }
              refreshAttachmentsAfterUpload();
            }}
            disabled={isRequestCaseClosed()}
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

          {currentTaskLocked && (
            <Alert color='gray' icon={<IconAlertCircle size={16} />} mb='md'>
              Esta tarea está bloqueada hasta que se resuelva la tarea anterior.
            </Alert>
          )}

          <Group justify='space-between'>
            <Group>
              {!isEditing ? (
                <Button
                  color='blue'
                  onClick={handleStartEditing}
                  leftSection={<IconTicket size={16} />}
                  disabled={isRequestResolved() || currentTaskLocked}
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
                onClick={() => {
                  setModalTasksOpened(true);
                  fetchTasksRG();
                }}
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
                        <Group gap={8} mb={6}>
                          <Text fw={600}>{task.task}</Text>
                          <Badge
                            color={getStatusColor(task.status)}
                            size="sm"
                            styles={{
                              root: { maxWidth: 'unset' },
                              label: { overflow: 'visible' },
                            }}
                          >
                            {getStatusLabel(task.status)}
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
                        <Group gap={6} mb={8} wrap="nowrap">
                          <Text size="sm" c="dimmed">
                            Asignado:
                          </Text>
                          <Text size="sm">{task.name}</Text>
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
    </OrionSignatureProvider>
  );
}

export default function RequestsViewBoardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ViewRequestPage />
    </Suspense>
  );
}
