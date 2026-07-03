'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../../components/microsoft-365/useGetMicrosoftToken';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGetMicrosoftToken } from '../../../../../components/microsoft-365/useGetMicrosoftToken';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import Link from 'next/link';
import {
  Title,
  Paper,
  Stack,
  Alert,
  Breadcrumbs,
  Anchor,
  Table,
  TextInput,
  Select,
  Button,
  Group,
  Badge,
  Modal,
  Textarea,
  Grid,
  Card,
  Text,
  Divider,
  LoadingOverlay,
  ActionIcon,
  Tooltip,
  Collapse,
  Box,
  Flex,
  ScrollArea,
  Progress,
  RingProgress,
  Loader,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconFilter,
  IconX,
  IconCheck,
  IconRefresh,
  IconFileDescription,
  IconCalendarEvent,
  IconUser,
  IconFlag,
  IconClock,
  IconBuilding,
  IconProgress,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCircle,
  IconUserCheck,
  IconTag,
  IconDownload,
  IconLink,
} from '@tabler/icons-react';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';
import { sanitizeOneDriveName } from '../../../../../lib/onedriveName';
import toast from 'react-hot-toast';

interface RequestTask {
  id: number;
  id_request_general: number;
  task: string;
  id_status: number;
  status_task: string;
}

interface Ticket {
  id: number;
  description: string;
  user: string;
  status: string;
  created_at: string;
  category: string;
  id_company: number;
  requester: string;
  company: string;
  subject: string;
  email: string;
  process: string;
  id_category: number;
  resolution: string;
  date_resolution: string;
  id_status_case: number;
  executor_final: string;
  id_assigned_category: string;
  id_assigned_process_category: string;
  url: string;
  phone: string;
  identification: string;
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
  email?: string;
  description?: string;
  active: number;
}

interface ConsultResponse {
  companies: CompanyData[];
  categories: CategoryData[];
  processCategories: ProcessCategoryData[];
  assignedUsers: { id: string; name: string }[];
}

interface FolderFile {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
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

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tasksByRequest, setTasksByRequest] = useState<Record<number, RequestTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState({
    company: '',
    subject: '',
    category: '',
    process: '',
    descripcion: '',
    url: '',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const isSubmittingRef = useRef(false);

  const [companies, setCompany] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [processCategories, setProcessCategories] = useState<
    {
      value: string;
      label: string;
      id_category_request: number;
      email?: string;
      description?: string;
    }[]
  >([]);
  const [processSearch, setProcessSearch] = useState('');
  const [filteredProcesses, setFilteredProcesses] = useState<{ value: string; label: string }[]>(
    []
  );
  const [activitySearch, setActivitySearch] = useState('');
  const [searchResults, setSearchResults] = useState<
    {
      value: string;
      label: string;
      id_category_request: number;
      category: string;
      process: string;
      description?: string;
      email?: string;
    }[]
  >([]);
  const [showActivitySearch, setShowActivitySearch] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<{ value: string; label: string }[]>([]);
  const [formDataLoading, setFormDataLoading] = useState(false);
  const [formDataError, setFormDataError] = useState<string | null>(null);
  const [idUser, setIdUser] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [folderContents, setFolderContents] = useState([]);

  const [requiredFiles, setRequiredFiles] = useState<
    { id: number; file_label: string; required: boolean; conditions: number[] }[]
  >([]);
  const [filesByDoc, setFilesByDoc] = useState<Record<number, UploadedFile[]>>({});
  const [loadingProcessFiles, setLoadingProcessFiles] = useState(false);

  const [formFields, setFormFields] = useState<
    {
      id: number;
      field_label: string;
      required: boolean;
      options: { id: number; option_label: string }[];
      conditions: number[];
    }[]
  >([]);
  const [fieldValues, setFieldValues] = useState<Record<number, number>>({});

  const [filters, setFilters] = useState({
    id: '',
    status: '',
    company: '',
    date_from: '',
    date_to: '',
    assigned_to: '',
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchFormData();
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
            fetchTicketsWithUserId(id);
          } else {
            setUserIdInitialized(true);
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

  useEffect(() => {
    if (formData.category) {
      let filtered = processCategories.filter(
        (p) => p.id_category_request === parseInt(formData.category)
      );

      if (processSearch.trim()) {
        const searchLower = processSearch.toLowerCase();
        filtered = filtered.filter(
          (p) => p.description && p.description.toLowerCase().includes(searchLower)
        );
      }

      if (formData.process && !filtered.find((p) => p.value === formData.process)) {
        const selectedProcess = processCategories.find((p) => p.value === formData.process);
        if (selectedProcess) {
          filtered = [selectedProcess, ...filtered];
        }
      }

      setFilteredProcesses(filtered);
    } else {
      setFilteredProcesses([]);
    }
  }, [formData.category, processCategories, processSearch, formData.process]);

  useEffect(() => {
    if (activitySearch.trim()) {
      const searchLower = activitySearch.toLowerCase();
      const results = processCategories
        .filter((p) => {
          return (
            (p.description && p.description.toLowerCase().includes(searchLower)) ||
            p.label.toLowerCase().includes(searchLower)
          );
        })
        .map((p) => {
          const category = categories.find((c) => c.value === p.id_category_request.toString());
          return {
            ...p,
            category: category?.label || '',
            process: p.label.split(' - ')[0],
          };
        })
        .filter((p) => p.category !== '');

      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [activitySearch, processCategories, categories]);

  useEffect(() => {
    if (formData.process) {
      fetchProcessFiles(formData.process);
      fetchProcessFields(formData.process);
    } else {
      setRequiredFiles([]);
      setFilesByDoc({});
      setFormFields([]);
      setFieldValues({});
    }
  }, [formData.process]);

  const fetchProcessFiles = async (processId: string) => {
    try {
      setLoadingProcessFiles(true);
      const response = await fetch(
        `/api/requests-general/process-files?id_process=${processId}`
      );

      if (!response.ok) throw new Error('Failed to fetch process files');

      const data = await response.json();
      setRequiredFiles(
        data.map(
          (f: {
            id: number;
            file_label: string;
            required: boolean | number;
            conditions: number[];
          }) => ({
            id: f.id,
            file_label: f.file_label,
            required: Boolean(f.required),
            conditions: f.conditions || [],
          })
        )
      );
      setFilesByDoc({});
    } catch (err) {
      console.error('Error fetching process files:', err);
      setRequiredFiles([]);
      setFilesByDoc({});
    } finally {
      setLoadingProcessFiles(false);
    }
  };

  const fetchProcessFields = async (processId: string) => {
    try {
      const response = await fetch(
        `/api/requests-general/process-fields?id_process=${processId}`
      );

      if (!response.ok) throw new Error('Failed to fetch process fields');

      const data = await response.json();
      setFormFields(
        data.map(
          (f: {
            id: number;
            field_label: string;
            required: boolean | number;
            options: { id: number; option_label: string }[];
            conditions: number[];
          }) => ({
            id: f.id,
            field_label: f.field_label,
            required: Boolean(f.required),
            options: f.options || [],
            conditions: f.conditions || [],
          })
        )
      );
      setFieldValues({});
    } catch (err) {
      console.error('Error fetching process fields:', err);
      setFormFields([]);
      setFieldValues({});
    }
  };

  const computeVisibility = () => {
    const selected = new Set<number>();
    const visibleFields: typeof formFields = [];
    for (const field of formFields) {
      const visible =
        field.conditions.length === 0 || field.conditions.some((c) => selected.has(c));
      if (visible) {
        visibleFields.push(field);
        const val = fieldValues[field.id];
        if (val) selected.add(val);
      }
    }
    return { visibleFields, selectedOptionIds: selected };
  };

  const { visibleFields, selectedOptionIds } = computeVisibility();

  const isFileVisible = (doc: { conditions: number[] }) =>
    doc.conditions.length === 0 || doc.conditions.some((c) => selectedOptionIds.has(c));

  const visibleRequiredFiles = requiredFiles.filter(isFileVisible);

  useEffect(() => {
    const selected = new Set<number>();
    const visibleIds = new Set<number>();
    for (const field of formFields) {
      const visible =
        field.conditions.length === 0 || field.conditions.some((c) => selected.has(c));
      if (visible) {
        visibleIds.add(field.id);
        const val = fieldValues[field.id];
        if (val) selected.add(val);
      }
    }
    const toRemove = Object.keys(fieldValues)
      .map(Number)
      .filter((id) => !visibleIds.has(id));
    if (toRemove.length > 0) {
      setFieldValues((prev) => {
        const next = { ...prev };
        toRemove.forEach((id) => delete next[id]);
        return next;
      });
    }
  }, [formFields, fieldValues]);

  const handleActivitySelect = (result: (typeof searchResults)[0]) => {
    setFormData({
      ...formData,
      category: result.id_category_request.toString(),
      process: result.value,
    });
    setActivitySearch('');
    setSearchResults([]);
  };

  const fetchTickets = async () => {
    if (!userId) {
      console.log('fetchTickets: No se puede ejecutar sin userId');
      return;
    }
    await fetchTicketsWithUserId(userId);
  };

  const fetchTasksForTickets = async (ticketsToUse: Ticket[]) => {
    try {
      const response = await fetch('/api/requests-general/activities-requets');
      if (!response.ok) throw new Error('Failed to fetch request tasks');

      const data: RequestTask[] = await response.json();
      const ticketIds = new Set(ticketsToUse.map((t) => t.id));
      const grouped: Record<number, RequestTask[]> = {};

      for (const task of data) {
        if (!ticketIds.has(task.id_request_general)) continue;
        (grouped[task.id_request_general] ||= []).push(task);
      }

      setTasksByRequest(grouped);
    } catch (err) {
      console.error('Error fetching request tasks:', err);
    }
  };

  const fetchTicketsWithUserId = async (
    userIdToUse: number,
    filtersToUse: typeof filters = filters
  ) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('idUser', userIdToUse.toString());

      if (filtersToUse.id) params.append('id', filtersToUse.id);
      if (filtersToUse.status) params.append('status', filtersToUse.status);
      if (filtersToUse.company) params.append('company', filtersToUse.company);
      if (filtersToUse.date_from) params.append('date_from', filtersToUse.date_from);
      if (filtersToUse.date_to) params.append('date_to', filtersToUse.date_to);
      if (filtersToUse.assigned_to) params.append('assigned_to', filtersToUse.assigned_to);

      const url = `/api/requests-general?${params.toString()}`;

      const response = await fetch(url);

      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = await response.json();
      console.log('fetchTicketsWithUserId: Tickets recibidos:', data.length, 'tickets');
      setTickets(data);
      fetchTasksForTickets(data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const validateFilters = () => {
    const errors: string[] = [];

    if (filters.date_from && filters.date_to) {
      const fromDate = new Date(filters.date_from);
      const toDate = new Date(filters.date_to);
      if (fromDate > toDate) {
        errors.push('La fecha "Desde" no puede ser mayor que la fecha "Hasta"');
      }
    }

    if (filters.company && !companies.find((c) => c.value === filters.company)) {
      errors.push('La empresa seleccionada no es válida');
    }

    if (filters.assigned_to && !assignedUsers.find((u) => u.value === filters.assigned_to)) {
      errors.push('La persona asignada seleccionada no es válida');
    }

    if (errors.length > 0) {
      setError(errors.join('. '));
      return false;
    }

    return true;
  };

  const handleApplyFilters = async () => {
    if (!validateFilters()) {
      return;
    }

    if (userId) {
      await fetchTicketsWithUserId(userId);
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

  const fetchFormData = async () => {
    try {
      setFormDataLoading(true);
      setFormDataError(null);

      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data: ConsultResponse = await response.json();
        setCompany(
          data.companies.map((c) => ({ value: c.id_company.toString(), label: c.company }))
        );

        const defaultCompanyId = '3';
        await fetchCategoriesByCompanyOnLoad(defaultCompanyId, data.processCategories);

        setFormData((prev) => ({
          ...prev,
          company: defaultCompanyId,
        }));

        setProcessCategories(
          data.processCategories
            .filter((p) => p.active === 1)
            .map((p) => ({
              value: p.id_process.toString(),
              label: p.description ? `${p.process} - ${p.description}` : p.process,
              id_category_request: p.id_category_request,
              email: p.email,
              description: p.description,
            }))
        );
        if (data.assignedUsers) {
          setAssignedUsers(data.assignedUsers.map((u) => ({ value: u.name, label: u.name })));
        }
      } else {
        console.error('Frontend - fetchFormData failed with status:', response.status);
        setFormDataError('Error al cargar los datos del formulario. Inténtalo de nuevo.');
      }
    } catch (err) {
      console.error('Error fetching form data:', err);
      setFormDataError('Error al cargar los datos del formulario. Inténtalo de nuevo.');
    } finally {
      setFormDataLoading(false);
    }
  };

  const fetchCategoriesByCompanyOnLoad = async (
    companyId: string,
    allProcessCategories: ProcessCategoryData[]
  ) => {
    try {
      const url = `/api/requests-general/consult-request?companyId=${companyId}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        setCategories(
          data.categories.map((c: CategoryData) => ({ value: c.id.toString(), label: c.category }))
        );
      } else {
        console.error(
          'Frontend - fetchCategoriesByCompanyOnLoad failed with status:',
          response.status
        );
      }
    } catch (err) {
      console.error('Error fetching categories by company on load:', err);
    }
  };

  const fetchCategoriesByCompany = async (companyId: string) => {
    try {
      setFormDataLoading(true);
      const url = `/api/requests-general/consult-request?companyId=${companyId}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        setCategories(
          data.categories.map((c: CategoryData) => ({ value: c.id.toString(), label: c.category }))
        );
        setFormData((prev) => ({ ...prev, category: '', process: '' }));
        setFilteredProcesses([]);
      } else {
        console.error('Frontend - fetchCategoriesByCompany failed with status:', response.status);
      }
    } catch (err) {
      console.error('Error fetching categories by company:', err);
    } finally {
      setFormDataLoading(false);
    }
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (formErrors[field]) {
      setFormErrors((prev) => ({
        ...prev,
        [field]: '',
      }));
    }
  };

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.company) {
      errors.company = 'La empresa es obligatoria';
    }
    if (!formData.subject.trim()) {
      errors.subject = 'El asunto es obligatorio';
    }
    if (!formData.category) {
      errors.category = 'La categoría es obligatoria';
    }
    if (!formData.process) {
      errors.process = 'El proceso es obligatorio';
    }
    if (!formData.descripcion.trim()) {
      errors.descripcion = 'La descripción es obligatoria';
    } else if (formData.descripcion.trim().length < 10) {
      errors.descripcion = 'La descripción debe tener al menos 10 caracteres';
    }

    for (const field of visibleFields) {
      if (field.required && !fieldValues[field.id]) {
        errors[`field_${field.id}`] = `Debe seleccionar: ${field.field_label}`;
      }
    }

    for (const doc of visibleRequiredFiles) {
      if (doc.required && !(filesByDoc[doc.id]?.length > 0)) {
        errors[`file_${doc.id}`] = `Debe adjuntar el documento: ${doc.file_label}`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateTicketWithValidation = async () => {
    if (isSubmittingRef.current) return;
    if (!validateForm()) return;
    await handleCreateTicket();
  };

  const handleCreateTicket = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      setCreateLoading(true);
      setError(null);

      let response: Response;
      try {
        response = await fetch('/api/requests-general/create-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            company: formData.company,
            subject: formData.subject,
            descripcion: formData.descripcion,
            category: parseInt(formData.category),
            process: parseInt(formData.process),
            createdby: userId,
            url: formData.url,
            formValues: visibleFields
              .filter((f) => fieldValues[f.id])
              .map((f) => ({ id_field: f.id, id_option: fieldValues[f.id] })),
          }),
        });
      } catch (networkErr) {
        console.error('Error de red al crear la solicitud:', networkErr);
        setError('No se pudo crear la solicitud. Intente de nuevo.');
        toast.error('No se pudo crear la solicitud. Intente de nuevo.');
        return;
      }

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {
        }
        console.error('Fallo al crear la solicitud:', detail);
        setError('No se pudo crear la solicitud. Intente de nuevo.');
        toast.error('No se pudo crear la solicitud. Intente de nuevo.');
        return;
      }

      const newTicket = await response.json();
      const requestId = Number(newTicket.id_request);
      const filesToUpload: { file: File; label?: string }[] = [
        ...visibleRequiredFiles.flatMap((doc) =>
          (filesByDoc[doc.id] || []).map((f) => ({ file: f.file, label: doc.file_label }))
        ),
        ...attachedFiles.map((file) => ({ file: file.file })),
      ];

      let uploadOk = true;
      if (filesToUpload.length > 0) {
        try {
          const token = await getMicrosoftToken();
          if (!token) {
            throw new Error('No se pudo obtener el token de acceso para subir archivos.');
          }

          const folderName = `Request-${requestId}`;
          await CheckOrCreateFolderAndUpload(folderName, filesToUpload, token);
        } catch (uploadErr) {
          uploadOk = false;
          console.error('Error al subir archivos:', uploadErr);
          toast.error(
            `Solicitud #${requestId} creada, pero NO se pudieron subir los archivos. ` +
              `Ábrala desde la lista y cárguelos en la vista de la solicitud.`,
            { duration: 10000 }
          );
        }
      }

      try {
        await sendRequestEmailNotification(
          requestId,
          formData.subject,
          parseInt(formData.process)
        );
      } catch (notifyErr) {
        console.error('Error en notificación por correo:', notifyErr);
      }

      if (uploadOk) {
        toast.success(`Solicitud #${requestId} creada correctamente.`);
      }

      setFormData({
        company: '',
        subject: '',
        category: '',
        process: '',
        descripcion: '',
        url: '',
      });

      setAttachedFiles([]);
      setFilesByDoc({});
      setRequiredFiles([]);
      setFormFields([]);
      setFieldValues({});

      fetchTickets();
      setModalOpened(false);
    } finally {
      setCreateLoading(false);
      isSubmittingRef.current = false;
    }
  };

  async function CheckOrCreateFolderAndUpload(
    folderName: string,
    files: { file: File; label?: string }[],
    token: string
  ) {
    try {
      const createResponse = await axios.post(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/SG:/children`,
        {
          name: folderName,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'replace',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (createResponse.status !== 201) {
        throw new Error('Error al crear la carpeta.');
      }

      const folderId = createResponse.data.id;

      if (files && files.length > 0) {
        const uploadNames = files.map((file) =>
          sanitizeOneDriveName(
            file.label ? `${file.label} - ${file.file.name}` : file.file.name
          )
        );

        const uploadPromises = files.map((file: { file: File; label?: string }, index) =>
          axios.put(
            `${process.env.MICROSOFTGRAPHUSERROUTE}items/${folderId}:/${uploadNames[index]}:/content`,
            file.file,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': file.file.type,
              },
            }
          )
        );

        const results = await Promise.allSettled(uploadPromises);

        const failed: string[] = [];
        results.forEach((result, index) => {
          if (
            result.status === 'fulfilled' &&
            (result.value.status === 201 || result.value.status === 200)
          ) {
            console.log(`Archivo subido: ${uploadNames[index]}`, result.value.data);
          } else {
            const reason =
              result.status === 'rejected'
                ? result.reason
                : `status ${result.value.status}`;
            console.log(`Error al subir el archivo: ${uploadNames[index]}`, reason);
            failed.push(uploadNames[index]);
          }
        });

        if (failed.length > 0) {
          throw new Error(
            `No se pudieron subir ${failed.length} archivo(s): ${failed.join(', ')}`
          );
        }
      } else {
        console.log('No hay archivos seleccionados para subir.');
      }
    } catch (error) {
      console.error('Error en CheckOrCreateFolderAndUpload:', error);
      throw error;
    }
  }

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
      const selectedProcess = processCategories.find((p) => p.value === processId.toString());
      const assignedEmail = selectedProcess?.email;

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

  if (status === 'loading' || loading) {
    return (
      <div
        style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}
        className='flex items-center justify-center'
      >
        <Group gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando...</Text>
        </Group>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'abierto':
        return 'green';
      case 'cancelado':
        return 'gray';
      case 'resuelto':
        return 'blue';
      default:
        return 'gray';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'abierto':
        return IconProgress;
      case 'cancelado':
        return IconX;
      case 'resuelto':
        return IconCircleCheckFilled;
      default:
        return IconClock;
    }
  };

  const getTaskVisual = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'resuelto':
        return { color: 'green', Icon: IconCircleCheckFilled };
      case 'abierto':
        return { color: 'orange', Icon: IconCircleDot };
      case 'sin empezar':
        return { color: 'gray', Icon: IconCircle };
      default:
        return { color: 'red', Icon: IconCircle };
    }
  };

  const getTasksProgress = (tasks: RequestTask[]) => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status_task?.toLowerCase() === 'resuelto').length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, percent };
  };

  const getGlobalTasksProgress = () => {
    const allTasks = Object.values(tasksByRequest).flat();
    return getTasksProgress(allTasks);
  };

  const filterByStatus = (value: string) => {
    const nf = { ...filters, status: value };
    setFilters(nf);
    if (userId) {
      fetchTicketsWithUserId(userId, nf);
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Solicitudes Generales', href: '#' },
    { title: 'Panel de Solicitudes', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component='span' c='dimmed'>
        {item.title}
      </Text>
    )
  );

  async function exportToExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Datos');

    type TicketKeys = keyof Ticket;

    const columnMapOrdered: { key: TicketKeys; header: string }[] = [
      { key: "requester", header: "nombre_solicitante" },
      { key: "subject", header: "cargo" },
      { key: "description", header: "conocimiento_experiencia_obligatoria" },
      { key: "email", header: "correo_electronico_firmante_1" },
      { key: "phone", header: "numero_celular_firmante_1" },
      { key: "identification", header: "numero_documento_firmante_1" }
    ];
    
    worksheet.columns = columnMapOrdered;

    tickets.forEach((row) => worksheet.addRow(row));

    tickets.forEach(item => {
      const row: Record<TicketKeys, any> = {} as Record<TicketKeys, any>;

      columnMapOrdered.forEach(col => {
        row[col.key] = item[col.key];
      });

      worksheet.addRow(row);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    saveAs(blob, 'InformeSolicitudes.xlsx');
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        {/* Header Section */}
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold mb-2 flex items-center gap-3'
              >
                <IconFileDescription size={32} className='text-blue-600' />
                Solicitudes Generales
              </Title>
              <Text size='lg' c='dimmed'>
                Gestión y seguimiento de solicitudes generales
              </Text>
            </div>

            <Button
              onClick={() => setModalOpened(true)}
              size='lg'
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
            >
              Crear Nueva Solicitud
            </Button>
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Mostrar todas las solicitudes'
                onClick={() => filterByStatus('')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-blue-light)',
                  borderColor:
                    filters.status === ''
                      ? 'var(--mantine-color-blue-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconFileDescription size={24} color='var(--mantine-color-blue-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-blue-light-color)'>
                      Total de Solicitudes
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Filtrar solicitudes pendientes'
                onClick={() => filterByStatus('1')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-orange-light)',
                  borderColor:
                    filters.status === '1'
                      ? 'var(--mantine-color-orange-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconProgress size={24} color='var(--mantine-color-orange-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-orange-light-color)'>
                      Pendientes
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'abierto').length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p='md'
                radius='md'
                withBorder
                role='button'
                aria-label='Filtrar solicitudes completadas'
                onClick={() => filterByStatus('2')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-green-light)',
                  borderColor:
                    filters.status === '2'
                      ? 'var(--mantine-color-green-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconCheck size={24} color='var(--mantine-color-green-light-color)' />
                  <div>
                    <Text size='xs' c='var(--mantine-color-green-light-color)'>
                      Completadas
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'resuelto').length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder>
                {(() => {
                  const { total, done, percent } = getGlobalTasksProgress();
                  return (
                    <Group wrap='nowrap'>
                      <RingProgress
                        size={56}
                        thickness={6}
                        roundCaps
                        sections={[
                          { value: percent, color: percent === 100 ? 'green' : 'blue' },
                        ]}
                        label={
                          <Text size='xs' ta='center' fw={700}>
                            {percent}%
                          </Text>
                        }
                      />
                      <div>
                        <Text size='xs' c='dimmed'>
                          Avance de tareas
                        </Text>
                        <Text size='lg' fw={600}>
                          {done}/{total}
                        </Text>
                      </div>
                    </Group>
                  );
                })()}
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder>
                <Group>
                  <Button
                    onClick={() => exportToExcel()}
                    size='lg'
                    leftSection={<IconDownload size={18} />}
                    className='bg-green-500 hover:bg-green-700'
                  >
                    Descargar XLSX
                  </Button>
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

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
          <Group justify='space-between' mb='md'>
            <Title order={3} className='flex items-center gap-2'>
              <IconFilter size={20} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon
              variant='subtle'
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
              data-testid='filter-toggle'
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='ID Solicitud'
                    type='text'
                    value={filters.id}
                    onChange={(e) => handleFilterChange('id', e.target.value)}
                    leftSection={<IconFilter size={16} />}
                    data-testid='id-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    placeholder='Todos los estados'
                    clearable
                    data={[
                      { value: '1', label: 'Abierto' },
                      { value: '3', label: 'Cancelado' },
                      { value: '2', label: 'Resuelto' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '')}
                    leftSection={<IconFlag size={16} />}
                    data-testid='status-filter'
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
                    data-testid='company-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha Desde'
                    type='date'
                    value={filters.date_from}
                    onChange={(e) => handleFilterChange('date_from', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                    data-testid='date_from-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha Hasta'
                    type='date'
                    value={filters.date_to}
                    onChange={(e) => handleFilterChange('date_to', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                    data-testid='date_to-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Persona Asignada'
                    placeholder='Todas las personas'
                    clearable
                    data={assignedUsers}
                    value={filters.assigned_to}
                    onChange={(value) => handleFilterChange('assigned_to', value || '')}
                    leftSection={<IconUserCheck size={16} />}
                    data-testid='assigned_to-filter'
                  />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={async () => {
                    const clearedFilters = {
                      id: '',
                      status: '',
                      company: '',
                      date_from: '',
                      date_to: '',
                      assigned_to: '',
                    };
                    setFilters(clearedFilters);

                    setError(null);

                    setTimeout(async () => {
                      if (userId) {
                        await fetchTicketsWithUserId(userId);
                      }
                    }, 100);
                  }}
                  leftSection={<IconX size={16} />}
                  data-testid='clear-filters'
                >
                  Limpiar Filtros
                </Button>
                <Button
                  onClick={handleApplyFilters}
                  leftSection={<IconRefresh size={16} />}
                  data-testid='apply-filters'
                >
                  Aplicar Filtros
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        {/* Enhanced Table */}
        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconFileDescription size={20} />
            Lista de Solicitudes
          </Title>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Compañía / Categoría</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Solicitante / Asignado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tickets.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconFileDescription size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          No se encontraron solicitudes
                        </Text>
                        <Text size='sm' c='gray.5'>
                          Intenta ajustar los filtros o crea una nueva solicitud
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  tickets.map((ticket) => (
                    <Table.Tr
                      key={ticket.id}
                      className='cursor-pointer transition-colors'
                      onClick={() => {
                        sessionStorage.setItem('selectedRequest', JSON.stringify(ticket));
                        window.open(
                          `/process/request-general/view-request?id=${ticket.id}&from=create-request`
                        );
                      }}
                    >
                      <Table.Td>
                        <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                          {ticket.id}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 240, maxWidth: 320 }}>
                        <Text size='sm' fw={500} lineClamp={2}>
                          {ticket.subject}
                        </Text>
                        {tasksByRequest[ticket.id]?.length ? (
                          <Stack gap={6} mt={8}>
                            {(() => {
                              const { total, done, percent } = getTasksProgress(
                                tasksByRequest[ticket.id]
                              );
                              return (
                                <Group gap={8} wrap='nowrap'>
                                  <Progress
                                    value={percent}
                                    color={percent === 100 ? 'green' : 'blue'}
                                    size='sm'
                                    radius='xl'
                                    style={{ flex: 1, maxWidth: 120 }}
                                  />
                                  <Text size='xs' c='dimmed' fw={500} style={{ whiteSpace: 'nowrap' }}>
                                    {done}/{total}
                                  </Text>
                                </Group>
                              );
                            })()}
                            <Group gap={6} wrap='wrap'>
                              {tasksByRequest[ticket.id].map((task) => {
                                const { color, Icon } = getTaskVisual(task.status_task);
                                return (
                                  <Tooltip
                                    key={task.id}
                                    label={`${task.task} · ${task.status_task}`}
                                    withArrow
                                  >
                                    <Badge
                                      variant='light'
                                      color={color}
                                      size='sm'
                                      radius='sm'
                                      styles={{
                                        root: { textTransform: 'none', fontWeight: 500, cursor: 'default' },
                                        label: { overflow: 'hidden', textOverflow: 'ellipsis' },
                                      }}
                                      leftSection={<Icon size={13} />}
                                    >
                                      {task.task}
                                    </Badge>
                                  </Tooltip>
                                );
                              })}
                            </Group>
                          </Stack>
                        ) : null}
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Group gap={4} wrap='nowrap'>
                            <IconBuilding size={14} className='text-gray-400' />
                            <Text size='sm' fw={500}>
                              {ticket.company}
                            </Text>
                          </Group>
                          <Text size='xs' c='dimmed'>
                            {ticket.category}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {(() => {
                          const StatusIcon = getStatusIcon(ticket.status);
                          return (
                            <Badge
                              color={getStatusColor(ticket.status)}
                              variant='light'
                              size='sm'
                              leftSection={<StatusIcon size={12} />}
                              styles={{ label: { overflow: 'visible' } }}
                            >
                              {ticket.status}
                            </Badge>
                          );
                        })()}
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' c='dimmed'>
                          {(() => {
                            const raw = ticket.created_at;
                            if (!raw) return 'Sin fecha';

                            const date = new Date(raw);
                            if (isNaN(date.getTime())) return 'Fecha inválida';

                            const adjusted = new Date(date.getTime() + 5 * 60 * 60 * 1000);

                            return new Intl.DateTimeFormat('es-CO', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            }).format(adjusted);
                          })()}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <Group gap={4} wrap='nowrap'>
                            <IconUser size={14} className='text-gray-400' />
                            <Text size='sm'>{ticket.requester}</Text>
                          </Group>
                          <Group gap={4} wrap='nowrap'>
                            <IconUserCheck size={14} className='text-gray-400' />
                            <Text size='sm' c='dimmed'>
                              {ticket.user}
                            </Text>
                          </Group>
                        </Stack>
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
            setFormErrors({});
            setAttachedFiles([]);
            setActivitySearch('');
            setSearchResults([]);
            setShowActivitySearch(false);
            setError(null);
            setFormData({
              company: '',
              subject: '',
              category: '',
              process: '',
              descripcion: '',
              url: '',
            });
          }}
          title={
            <Group>
              <IconPlus size={20} />
              <Text size='lg' fw={600}>
                Crear Nueva Solicitud
              </Text>
            </Group>
          }
          size='xl'
          radius='md'
          overlayProps={{ blur: 4 }}
        >
          <LoadingOverlay visible={createLoading || formDataLoading} />

          {formDataError && (
            <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md'>
              {formDataError}
            </Alert>
          )}

          <Stack>
            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Empresa Solicitante'
                  placeholder='Seleccione la empresa'
                  data={companies}
                  value={formData.company}
                  onChange={(value) => {
                    handleFormChange('company', value || '');
                    if (value) {
                      fetchCategoriesByCompany(value);
                    }
                  }}
                  error={formErrors.company}
                  required
                  leftSection={<IconBuilding size={16} />}
                  disabled={formDataLoading}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 12 }}>
                <TextInput
                  label={parseInt(formData.process) == 4 ? 'Cargo' : 'Asunto'}
                  placeholder='Ingrese el asunto de la solicitud'
                  value={formData.subject}
                  onChange={(e) => {
                    setFormData({ ...formData, subject: e.target.value });
                    if (formErrors.subject) {
                      setFormErrors({ ...formErrors, subject: '' });
                    }
                  }}
                  error={formErrors.subject}
                  required
                  maxLength={254}
                  leftSection={<IconFileDescription size={16} />}
                />
              </Grid.Col>
            </Grid>

            {/* Activity Search Section */}
            <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
              <Group justify='space-between' mb='xs'>
                <Text fw={600} size='sm' c='blue.9'>
                  ¿No sabes qué categoría elegir?
                </Text>
                <Button
                  variant='subtle'
                  size='xs'
                  onClick={() => setShowActivitySearch(!showActivitySearch)}
                  rightSection={showActivitySearch ? <IconX size={14} /> : <IconSearch size={14} />}
                >
                  {showActivitySearch ? 'Ocultar' : 'Buscar por Actividad'}
                </Button>
              </Group>

              {showActivitySearch && (
                <Stack gap='sm'>
                  <TextInput
                    placeholder='Escribe la actividad que necesitas solicitar...'
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    leftSection={<IconSearch size={16} />}
                    rightSection={
                      activitySearch && (
                        <ActionIcon
                          size='sm'
                          variant='transparent'
                          onClick={() => {
                            setActivitySearch('');
                            setSearchResults([]);
                          }}
                        >
                          <IconX size={14} />
                        </ActionIcon>
                      )
                    }
                  />

                  {searchResults.length > 0 && (
                    <Card
                      p='xs'
                      radius='md'
                      withBorder
                      className='bg-white max-h-64 overflow-y-auto'
                    >
                      <Stack gap='xs'>
                        <Text size='xs' c='gray.5' fw={500}>
                          {searchResults.length}{' '}
                          {searchResults.length === 1 ? 'resultado' : 'resultados'} encontrado
                          {searchResults.length === 1 ? '' : 's'}
                        </Text>

                        <ScrollArea h={250} type="auto">
                        {searchResults.map((result) => (
                          <Card
                            key={result.value}
                            p='sm'
                            radius='md'
                            withBorder
                            className='cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-all duration-200'
                            onClick={() => handleActivitySelect(result)}
                          >
                            <Stack gap={4}>
                              <Group gap={6} wrap='nowrap'>
                                <Badge size='xs' variant='light' color='blue'>
                                  {result.category}
                                </Badge>
                                <Text size='xs' c='gray.5' fw={500}>
                                  {result.process}
                                </Text>
                              </Group>
                              <Text size='sm' lineClamp={2} c='gray.8'>
                                {result.description || result.label}
                              </Text>
                            </Stack>
                          </Card>
                        ))}
                        </ScrollArea>
                      </Stack>
                    </Card>
                  )}

                  {activitySearch && searchResults.length === 0 && (
                    <Text size='sm' c='gray.5' ta='center' py='md'>
                      No se encontraron actividades que coincidan con tu búsqueda.
                    </Text>
                  )}
                </Stack>
              )}
            </Card>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Categoría'
                  placeholder='Seleccione la categoría'
                  data={categories}
                  value={formData.category}
                  onChange={(value) => {
                    handleFormChange('category', value || '');
                  }}
                  error={formErrors.category}
                  required
                  leftSection={<IconTag size={16} />}
                  disabled={formDataLoading}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label='Proceso'
                  placeholder='Seleccione el proceso'
                  data={filteredProcesses}
                  value={formData.process}
                  onChange={(value) => {
                    handleFormChange('process', value || '');
                  }}
                  onSearchChange={(value) => setProcessSearch(value)}
                  searchValue={processSearch}
                  searchable
                  error={formErrors.process}
                  required
                  leftSection={<IconProgress size={16} />}
                  disabled={!formData.category || formDataLoading}
                />
              </Grid.Col>
            </Grid>

            <Textarea
              label={parseInt(formData.process) == 4 ? 'Conocimientos - Experiencia' : 'Descripción Detallada'}
              placeholder='Describa detalladamente la solicitud. Incluya toda la información relevante para una mejor atención.'
              value={formData.descripcion}
              onChange={(e) => {
                setFormData({ ...formData, descripcion: e.target.value });
                if (formErrors.descripcion) {
                  setFormErrors({ ...formErrors, descripcion: '' });
                }
              }}
              error={formErrors.descripcion}
              required
              minRows={5}
              maxLength={1000}
              description='Mínimo 10 caracteres, máximo 1000 caracteres'
              autosize
            />

            <Divider />

            <TextInput
              label={'URL'}
              placeholder='URL (Opcional)...'
              value={formData.url}
              onChange={(e) => {
                setFormData({ ...formData, url: e.target.value });
                if (formErrors.url) {
                  setFormErrors({ ...formErrors, url: '' });
                }
              }}
              error={formErrors.url}
              maxLength={1000}
              leftSection={<IconLink size={16} />}
            />

            <Divider />

            {visibleFields.length > 0 && (
              <Stack gap='md'>
                <Text fw={600}>Información adicional</Text>
                <Grid>
                  {visibleFields.map((field) => (
                    <Grid.Col span={{ base: 12, md: 6 }} key={field.id}>
                      <Select
                        label={field.field_label}
                        placeholder='Seleccione una opción'
                        required={field.required}
                        data={field.options.map((o) => ({
                          value: o.id.toString(),
                          label: o.option_label,
                        }))}
                        value={fieldValues[field.id] ? fieldValues[field.id].toString() : null}
                        onChange={(value) => {
                          setFieldValues((prev) => {
                            const next = { ...prev };
                            if (value) next[field.id] = parseInt(value);
                            else delete next[field.id];
                            return next;
                          });
                          if (formErrors[`field_${field.id}`]) {
                            setFormErrors((prev) => ({ ...prev, [`field_${field.id}`]: '' }));
                          }
                        }}
                        error={formErrors[`field_${field.id}`]}
                        clearable
                        leftSection={<IconTag size={16} />}
                      />
                    </Grid.Col>
                  ))}
                </Grid>
                <Divider />
              </Stack>
            )}

            {visibleRequiredFiles.length > 0 && (
              <Stack gap='lg'>
                <div>
                  <Text fw={600}>Documentos Requeridos</Text>
                  <Text size='sm' c='dimmed'>
                    Adjunte cada documento en su campo correspondiente. Los marcados como obligatorios
                    son necesarios para crear la solicitud.
                  </Text>
                </div>

                {visibleRequiredFiles.map((doc) => (
                  <div key={doc.id}>
                    <Group gap='xs' mb='xs'>
                      <Text fw={500}>{doc.file_label}</Text>
                      <Badge
                        color={doc.required ? 'red' : 'gray'}
                        variant='light'
                        size='sm'
                      >
                        {doc.required ? 'Obligatorio' : 'Opcional'}
                      </Badge>
                    </Group>
                    <FileUpload
                      ticketId={0}
                      onFilesChange={(files) => {
                        setFilesByDoc((prev) => ({ ...prev, [doc.id]: files }));
                        if (formErrors[`file_${doc.id}`]) {
                          setFormErrors((prev) => ({ ...prev, [`file_${doc.id}`]: '' }));
                        }
                      }}
                      autoUpload={false}
                      disabled={formDataLoading}
                    />
                    {formErrors[`file_${doc.id}`] && (
                      <Text size='sm' c='red' mt='xs'>
                        {formErrors[`file_${doc.id}`]}
                      </Text>
                    )}
                  </div>
                ))}
              </Stack>
            )}

            {/* Subida libre: siempre disponible para adjuntar documentos adicionales */}
            <div>
              <Text fw={600} mb='xs'>
                {requiredFiles.length > 0 ? 'Archivos adicionales (Opcional)' : 'Archivos Adjuntos (Opcional)'}
              </Text>
              <FileUpload
                ticketId={0}
                onFilesChange={setAttachedFiles}
                autoUpload={false}
                disabled={formDataLoading}
              />
            </div>

            <Divider />

            <Group justify='flex-end' gap='md'>
              <Button
                variant='outline'
                onClick={() => {
                  setModalOpened(false);
                  setFormErrors({});
                  setAttachedFiles([]);
                  setActivitySearch('');
                  setSearchResults([]);
                  setShowActivitySearch(false);
                  setError(null);
                }}
                size='md'
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateTicketWithValidation}
                loading={createLoading}
                disabled={createLoading}
                size='md'
                leftSection={<IconPlus size={16} />}
                className='bg-blue-600 hover:bg-blue-700'
              >
                Crear Solicitud
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
