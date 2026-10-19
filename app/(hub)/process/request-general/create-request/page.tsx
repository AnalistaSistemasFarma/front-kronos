'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  Paper,
  Stack,
  Table,
  Tooltip,
  Title,
  Alert,
  TextInput,
  NumberInput,
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
  Collapse,
  Box,
  ScrollArea,
  Loader,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconSearch,
  IconPlus,
  IconFilter,
  IconX,
  IconCheck,
  IconRefresh,
  IconFileDescription,
  IconCalendarEvent,
  IconFlag,
  IconUser,
  IconClock,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCircle,
  IconBuilding,
  IconProgress,
  IconUserCheck,
  IconTag,
  IconDownload,
  IconLink,
  IconTrash,
} from '@tabler/icons-react';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';
import FileUpload, { UploadedFile } from '../../../../../components/ui/FileUpload';
import { isSapField } from '../../../../../lib/requests-general/sapSources';
import {
  TABLE_FIELD_TYPE,
  parseTableConfig,
  serializeTableValue,
  validateTableRows,
  isRowEmpty,
  type TableColumn,
  type TableRow,
} from '../../../../../lib/requests-general/tableField';
import { ORION_SIGNATURE_FIELD_TYPE } from '../../../../../lib/orion/fieldType';

function readSelectedCompanyId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('selectedCompany');
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { id?: number };
    return parsed?.id != null ? String(parsed.id) : null;
  } catch {
    return null;
  }
}
import SapOptionSelect from './SapOptionSelect';
import TableFieldInput from './TableFieldInput';
import {
  formatEstimatedPaymentDate,
  formatEstimatedPaymentDateShort,
} from '../../../../../lib/treasury/estimatedPaymentDate';
import toast from 'react-hot-toast';
import {
  FilterPanel,
  ProgressRingTile,
  RequestProgressBar,
  RequestsHeader,
  RequestsPage,
  StatFilterTile,
} from '../../../../../components/request-general/list/RequestListUi';
import { SignatureAutoCloseToggle } from '../../../../../components/request-general/list/SignatureAutoCloseToggle';
import { panelStyles } from '../../../../../components/ui/panel/Panel';
import {
  buildTaskDisplayBadges,
  getSimplifiedTasksProgress,
} from '@/lib/orion/taskProgress';

interface RequestTask {
  id: number;
  id_request_general: number;
  task: string;
  id_status: number;
  status_task: string;
  resolution?: string | null;
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
  id_company?: number;
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
  const [userId, setUserId] = useState<string | null>(null);
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

  const linkedProcessParam = searchParams.get('linkedProcess');
  const originTaskParam = searchParams.get('originTask');
  const companyParam = searchParams.get('company');
  const [originTaskId, setOriginTaskId] = useState<string | null>(null);
  const [lockedLinked, setLockedLinked] = useState(false);
  const linkedAppliedRef = useRef(false);

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
      field_type: string;
      required: boolean;
      options: { id: number; option_label: string }[];
      conditions: number[];
      config_json?: string | null;
    }[]
  >([]);
  // Los campos tipo tabla guardan su valor como TableRow[] (filas); el resto
  // guarda un id de opción (number) o un valor libre (string).
  const [fieldValues, setFieldValues] = useState<
    Record<number, number | string | TableRow[]>
  >({});

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

    const controller = new AbortController();
    let cancelled = false;

    const loadInitialData = async () => {
      await fetchFormData(controller.signal);
      if (cancelled || userIdInitialized) return;

      const sessionUserId = session.user?.id ? String(session.user.id) : null;
      if (sessionUserId) {
        setUserId(sessionUserId);
        setUserIdInitialized(true);
        await fetchTicketsWithUserId(sessionUserId);
        return;
      }

      if (userName) {
        const id = await getUserIdByName(userName, controller.signal);
        if (cancelled) return;
        if (id) {
          setUserId(String(id));
          setUserIdInitialized(true);
          await fetchTicketsWithUserId(String(id));
        } else {
          setUserIdInitialized(true);
        }
      } else {
        setUserIdInitialized(true);
      }
    };

    void loadInitialData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session, status, router]);

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
    if (linkedAppliedRef.current) return;
    if (!linkedProcessParam) return;
    if (processCategories.length === 0) return;
    const proc = processCategories.find((p) => p.value === String(linkedProcessParam));
    if (!proc) return;
    linkedAppliedRef.current = true;

    const targetCompany = companyParam || formData.company || '';
    if (targetCompany) {
      void fetchCategoriesByCompanyOnLoad(targetCompany);
    }
    setFormData((prev) => ({
      ...prev,
      company: targetCompany || prev.company,
      category: String(proc.id_category_request),
      process: String(linkedProcessParam),
    }));
    setOriginTaskId(originTaskParam);
    setLockedLinked(true);
    setModalOpened(true);
  }, [processCategories, linkedProcessParam, companyParam, originTaskParam, formData.company]);

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
            field_type?: string;
            required: boolean | number;
            options: { id: number; option_label: string }[];
            conditions: number[];
            config_json?: string | null;
          }) => ({
            id: f.id,
            field_label: f.field_label,
            field_type: f.field_type || 'select',
            required: Boolean(f.required),
            options: f.options || [],
            conditions: f.conditions || [],
            config_json: f.config_json ?? null,
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
        // Solo los campos tipo lista aportan una opción al conjunto que condiciona a otros
        // campos/archivos; texto/número/fecha guardan un valor libre (sin id de opción).
        const val = fieldValues[field.id];
        if (field.field_type === 'select' && typeof val === 'number') selected.add(val);
      }
    }
    return { visibleFields, selectedOptionIds: selected };
  };

  const { visibleFields, selectedOptionIds } = computeVisibility();
  // La firma digital se configura después de crear la solicitud; no se muestra al crearla.
  const displayedFields = visibleFields.filter((f) => f.field_type !== ORION_SIGNATURE_FIELD_TYPE);

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
        if (field.field_type === 'select' && typeof val === 'number') selected.add(val);
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
      // Solo las tareas de las solicitudes listadas, en lotes de 500 ids (límite de la ruta);
      // antes se descargaba la tabla completa de tareas.
      const ticketIds = new Set(ticketsToUse.map((t) => t.id));
      const ids = [...ticketIds];
      const batches: number[][] = [];
      for (let i = 0; i < ids.length; i += 500) batches.push(ids.slice(i, i + 500));
      const responses = await Promise.all(
        batches.map((batch) =>
          fetch(`/api/requests-general/activities-requets?ids=${batch.join(',')}`)
        )
      );
      if (responses.some((r) => !r.ok)) throw new Error('Failed to fetch request tasks');

      const data: RequestTask[] = (
        await Promise.all(responses.map((r) => r.json() as Promise<RequestTask[]>))
      ).flat();
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
    userIdToUse: string,
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

  const getUserIdByName = async (
    userName: string,
    signal?: AbortSignal
  ): Promise<string | null> => {
    if (!session || status !== 'authenticated') {
      return null;
    }

    if (!userName || userName.trim() === '') {
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
        signal,
      });

      if (!response.ok) {
        if (response.status === 499) return null;
        const errorData = await response.json().catch(() => ({}));
        console.error('Error al obtener ID de usuario:', errorData.error);
        return null;
      }

      const data = await response.json();
      return data.success ? String(data.userId) : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      console.error('Error en la llamada al endpoint:', error);
      return null;
    } finally {
      setLoadingUserId(false);
    }
  };

  const fetchFormData = async (signal?: AbortSignal) => {
    try {
      setFormDataLoading(true);
      setFormDataError(null);

      const response = await fetch(`/api/requests-general/consult-request`, { signal });

      if (response.ok) {
        const data: ConsultResponse = await response.json();
        setCompany(
          data.companies.map((c) => ({ value: c.id_company.toString(), label: c.company }))
        );

        const defaultCompanyId =
          readSelectedCompanyId() ??
          (data.companies.length === 1 ? String(data.companies[0].id_company) : '');

        if (defaultCompanyId) {
          const companyIdNum = Number(defaultCompanyId);
          setCategories(
            data.categories
              .filter((c: CategoryData) => c.id_company === companyIdNum)
              .map((c: CategoryData) => ({ value: c.id.toString(), label: c.category }))
          );
          setFormData((prev) => ({
            ...prev,
            company: defaultCompanyId,
          }));
        } else {
          setCategories([]);
        }

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
      } else if (response.status !== 499) {
        console.error('Frontend - fetchFormData failed with status:', response.status);
        setFormDataError('Error al cargar los datos del formulario. Inténtalo de nuevo.');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Error fetching form data:', err);
      setFormDataError('Error al cargar los datos del formulario. Inténtalo de nuevo.');
    } finally {
      setFormDataLoading(false);
    }
  };

  const fetchCategoriesByCompanyOnLoad = async (
    companyId: string,
    signal?: AbortSignal
  ) => {
    try {
      const url = `/api/requests-general/consult-request?companyId=${companyId}`;
      const response = await fetch(url, { signal });

      if (response.ok) {
        const data = await response.json();
        setCategories(
          data.categories.map((c: CategoryData) => ({ value: c.id.toString(), label: c.category }))
        );
      } else if (response.status !== 499) {
        console.error(
          'Frontend - fetchCategoriesByCompanyOnLoad failed with status:',
          response.status
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
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

  // Validación genérica de los campos dinámicos de proceso (process_form_field). Es la
  // MISMA para cualquier proceso: no sabe nada específico de ningún campo.
  const collectVisibleFieldErrors = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const field of visibleFields) {
      if (field.field_type === ORION_SIGNATURE_FIELD_TYPE) continue;
      const val = fieldValues[field.id];
      if (field.field_type === TABLE_FIELD_TYPE) {
        const columns = parseTableConfig(field.config_json).columns;
        const rows = Array.isArray(val) ? (val as TableRow[]) : [];
        const tableError = validateTableRows(columns, rows, field.required, field.field_label);
        if (tableError) errors[`field_${field.id}`] = tableError;
        continue;
      }
      const empty = val === undefined || val === null || val === '';
      if (field.required && empty) {
        errors[`field_${field.id}`] =
          field.field_type === 'select'
            ? `Debe seleccionar: ${field.field_label}`
            : `Debe completar: ${field.field_label}`;
      } else if (
        field.field_type === 'url' &&
        !empty &&
        typeof val === 'string' &&
        !/^https?:\/\/\S+$/i.test(val.trim())
      ) {
        errors[`field_${field.id}`] =
          `${field.field_label}: ingrese una URL válida que empiece por http:// o https://`;
      }
    }
    return errors;
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.company) {
      errors.company = 'La empresa es obligatoria';
    }
    if (!formData.category) {
      errors.category = 'La categoría es obligatoria';
    }
    if (!formData.process) {
      errors.process = 'El proceso es obligatorio';
    }

    if (!formData.subject.trim()) {
      errors.subject = 'El asunto es obligatorio';
    }
    if (!formData.descripcion.trim()) {
      errors.descripcion = 'La descripción es obligatoria';
    } else if (formData.descripcion.trim().length < 10) {
      errors.descripcion = 'La descripción debe tener al menos 10 caracteres';
    }

    Object.assign(errors, collectVisibleFieldErrors());

    for (const doc of visibleRequiredFiles) {
      if (doc.required && !(filesByDoc[doc.id]?.length > 0)) {
        errors[`file_${doc.id}`] = `Debe adjuntar el documento: ${doc.file_label}`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Serializa las respuestas de los campos dinámicos de proceso al formato que espera
  // el motor genérico ([{ id_field, id_option? | value_text? }] -- ver
  // createGeneralRequest.js).
  const buildFormValuesPayload = () =>
    visibleFields
      .filter((f) => {
        const v = fieldValues[f.id];
        if (f.field_type === TABLE_FIELD_TYPE) {
          const columns = parseTableConfig(f.config_json).columns;
          const rows = Array.isArray(v) ? (v as TableRow[]) : [];
          return rows.some((r) => !isRowEmpty(r, columns));
        }
        return v !== undefined && v !== null && v !== '';
      })
      .map((f) => {
        const v = fieldValues[f.id];
        if (f.field_type === TABLE_FIELD_TYPE) {
          const columns = parseTableConfig(f.config_json).columns;
          const rows = (Array.isArray(v) ? (v as TableRow[]) : []).filter(
            (r) => !isRowEmpty(r, columns)
          );
          return { id_field: f.id, value_text: serializeTableValue(rows) };
        }
        return f.field_type === 'select'
          ? { id_field: f.id, id_option: v }
          : { id_field: f.id, value_text: String(v) };
      });

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
            originTaskId: originTaskId || null,
            formValues: buildFormValuesPayload(),
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
      // Refrescar campana (encargado/asignado en la misma sesión la ve al instante).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('synerlink:notifications-refresh'));
      }
      const filesToUpload: { file: File; label?: string }[] = [
        ...visibleRequiredFiles.flatMap((doc) =>
          (filesByDoc[doc.id] || []).map((f) => ({ file: f.file, label: doc.file_label }))
        ),
        ...attachedFiles.map((file) => ({ file: file.file })),
      ];

      let uploadOk = true;
      if (filesToUpload.length > 0) {
        try {
          await uploadRequestFiles(requestId, filesToUpload);

          // SAPSEND: reenviar los adjuntos (si es solicitud de tesorería). No bloquea; el servidor
          // aplica el gate y lee los archivos desde OneDrive.
          void fetch('/api/requests-general/sapsend-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: requestId }),
          }).catch((e) => console.error('Error enviando archivos a SAPSEND:', e));
        } catch (uploadErr) {
          uploadOk = false;
          console.error('Error al subir archivos:', uploadErr);
          toast.error(
            `Solicitud #${requestId} creada, pero NO se pudieron subir los archivos. ` +
              `Cárguelos en la vista de la solicitud.`,
            { duration: 10000 }
          );
        }
      }

      // Notificación en segundo plano: no retrasa la llegada a la solicitud.
      void sendRequestEmailNotification(
        requestId,
        formData.subject,
        parseInt(formData.process)
      ).catch((notifyErr) => {
        console.error('Error en notificación por correo:', notifyErr);
      });

      if (uploadOk) {
        toast.success(`Solicitud #${requestId} creada correctamente.`);
      }

      // Ir de inmediato a la solicitud creada (creador marca PDFs / sigue el flujo).
      if (Number.isInteger(requestId) && requestId > 0) {
        try {
          sessionStorage.setItem(
            'selectedRequest',
            JSON.stringify({
              id: requestId,
              subject: formData.subject,
              description: formData.descripcion,
            })
          );
        } catch {
          sessionStorage.removeItem('selectedRequest');
        }
        router.replace(
          `/process/request-general/view-request?id=${requestId}&from=create-request`
        );
        return;
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

  /**
   * Sube los adjuntos de la solicitud recién creada por el servidor (upload-attachments →
   * <raíz>/TEC/SG/Request-<id>): el token de Graph nunca llega al navegador. Un archivo por
   * pedido, como FileUpload; el servidor limpia el nombre y evita sobrescribir.
   */
  async function uploadRequestFiles(requestId: number, files: { file: File; label?: string }[]) {
    try {
      if (!files?.length) return;

      const uploadNames = files.map((file) =>
        file.label ? `${file.label} - ${file.file.name}` : file.file.name
      );

      const results = await Promise.allSettled(
        files.map(async (file, index) => {
          const form = new FormData();
          form.append('requestId', String(requestId));
          form.append('storagePath', 'SG');
          form.append('entityType', 'Request');
          form.append('files', file.file, uploadNames[index]);
          const res = await fetch('/api/requests-general/upload-attachments', {
            method: 'POST',
            body: form,
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            errors?: string[];
          };
          if (!res.ok || data.errors?.length) {
            throw new Error(data.errors?.[0] || data.error || `HTTP ${res.status}`);
          }
          return data;
        })
      );

      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`Archivo subido: ${uploadNames[index]}`, result.value);
        } else {
          console.log(`Error al subir el archivo: ${uploadNames[index]}`, result.reason);
          failed.push(uploadNames[index]);
        }
      });

      if (failed.length > 0) {
        throw new Error(
          `No se pudieron subir ${failed.length} archivo(s): ${failed.join(', ')}`
        );
      }
    } catch (error) {
      console.error('Error en uploadRequestFiles:', error);
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
      case 'devuelta':
      case 'devuelto':
        return 'orange';
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

  const getTasksProgress = (tasks: RequestTask[]) => getSimplifiedTasksProgress(tasks);

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

  async function exportToExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Datos');

    type TicketKeys = keyof Ticket;

    const formatDate = (raw: any) => {
      if (!raw) return '';
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      return new Intl.DateTimeFormat('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    };

    const dateKeys: TicketKeys[] = ['created_at', 'date_resolution'];

    const columnMapOrdered: { key: TicketKeys; header: string; width: number }[] = [
      { key: 'requester', header: 'Solicitante', width: 24 },
      { key: 'user', header: 'Asignado', width: 24 },
      { key: 'company', header: 'Empresa', width: 24 },
      { key: 'process', header: 'Proceso', width: 22 },
      { key: 'category', header: 'Categoría', width: 22 },
      { key: 'subject', header: 'Asunto', width: 30 },
      { key: 'description', header: 'Descripción', width: 40 },
      { key: 'status', header: 'Estado', width: 18 },
      { key: 'executor_final', header: 'Ejecutor final', width: 24 },
      { key: 'resolution', header: 'Resolución', width: 40 },
      { key: 'date_resolution', header: 'Fecha de resolución', width: 20 },
      { key: 'created_at', header: 'Fecha de creación', width: 20 },
    ];

    worksheet.columns = columnMapOrdered;

    tickets.forEach(item => {
      const row: Record<TicketKeys, any> = {} as Record<TicketKeys, any>;

      columnMapOrdered.forEach(col => {
        const value = item[col.key];
        row[col.key] = dateKeys.includes(col.key) ? formatDate(value) : value;
      });

      worksheet.addRow(row);
    });

    worksheet.getRow(1).font = { bold: true };

    // Segunda hoja: "Solicitudes de Pago". Trae los campos extra (pivote de
    // request_form_value) para las solicitudes del proceso "Solicitud de Pago"
    // que estén en el panel. El endpoint filtra por proceso, así que basta con
    // mandarle los ids de los tickets cargados.
    try {
      const ids = tickets.map((t) => t.id).filter((n) => Number.isInteger(n));
      if (ids.length > 0) {
        const response = await fetch('/api/requests-general/payment-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });

        if (response.ok) {
          const paymentRows: Array<{
            id_solicitud: number;
            asunto?: string | null;
            empresa?: string | null;
            subempresa?: string | null;
            creador_solicitud?: string | null;
            estado?: string | null;
            fecha_creación_solicitud?: string | null;
            tipo_solicitud?: string | null;
            subtipo_solicitud?: string | null;
            valor_pagar?: string | null;
            fecha_solicitada_pago?: string | null;
            acreedor?: string | null;
          }> = await response.json().catch(() => []);

          if (Array.isArray(paymentRows) && paymentRows.length > 0) {
            const splitAcreedor = (value?: string | null) => {
              const r = String(value || '').trim();
              const idx = r.indexOf(' - ');
              if (idx === -1) return { doc: '', name: r };
              return { doc: r.slice(0, idx).trim(), name: r.slice(idx + 3).trim() };
            };
            const formatReqDate = (raw?: string | null) => {
              if (!raw) return '';
              const d = new Date(raw);
              if (isNaN(d.getTime())) return String(raw);
              return new Intl.DateTimeFormat('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(d);
            };

            const paySheet = workbook.addWorksheet('Solicitudes de Pago');
            paySheet.columns = [
              { key: 'id', header: 'ID Solicitud', width: 12 },
              { key: 'empresa', header: 'Empresa', width: 24 },
              { key: 'subempresa', header: 'Subempresa', width: 22 },
              { key: 'tipo', header: 'Tipo', width: 22 },
              { key: 'subtipo', header: 'Subtipo', width: 24 },
              { key: 'documento', header: 'Documento', width: 16 },
              { key: 'acreedor', header: 'Acreedor', width: 30 },
              { key: 'valor', header: 'Valor a Pagar', width: 16 },
              { key: 'fecha_solicitada', header: 'Fecha Solicitada de Pago', width: 22 },
              { key: 'fecha_estimada', header: 'Fecha Estimada de Pago', width: 24 },
              { key: 'estado', header: 'Estado', width: 16 },
              { key: 'solicitante', header: 'Solicitante', width: 24 },
              { key: 'asunto', header: 'Asunto', width: 30 },
            ];

            paymentRows.forEach((r) => {
              const a = splitAcreedor(r.acreedor);
              const valor = Number(String(r.valor_pagar ?? '').replace(/[^\d.-]/g, ''));
              paySheet.addRow({
                id: r.id_solicitud,
                empresa: r.empresa ?? '',
                subempresa: r.subempresa ?? '',
                tipo: r.tipo_solicitud ?? '',
                subtipo: r.subtipo_solicitud ?? '',
                documento: a.doc,
                acreedor: a.name,
                valor: Number.isFinite(valor) ? valor : '',
                fecha_solicitada: formatReqDate(r.fecha_solicitada_pago),
                fecha_estimada: formatEstimatedPaymentDateShort(
                  r.empresa,
                  r.fecha_creación_solicitud
                ),
                estado: r.estado ?? '',
                solicitante: r.creador_solicitud ?? '',
                asunto: r.asunto ?? '',
              });
            });

            paySheet.getRow(1).font = { bold: true };
            paySheet.getColumn('valor').numFmt = '#,##0';
          }
        } else {
          console.error('No se pudo obtener el reporte de pagos:', response.status);
        }
      }
    } catch (e) {
      console.error('Error generando la hoja de Solicitudes de Pago:', e);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    saveAs(blob, 'InformeSolicitudes.xlsx');
  }

  const globalProgress = getGlobalTasksProgress();

  return (
    <RequestsPage>
      <RequestsHeader
        crumbs={[
          { title: 'Procesos', href: '/process' },
          { title: 'Solicitudes Generales' },
          { title: 'Panel de Solicitudes' },
        ]}
        title='Solicitudes Generales'
        subtitle='Gestión y seguimiento de solicitudes generales'
        actions={
          <>
            <SignatureAutoCloseToggle />
            <Button
              variant='default'
              radius='xl'
              leftSection={<IconDownload size={16} />}
              onClick={() => exportToExcel()}
            >
              Descargar XLSX
            </Button>
            <Button
              radius='xl'
              leftSection={<IconPlus size={16} />}
              onClick={() => setModalOpened(true)}
            >
              Crear Nueva Solicitud
            </Button>
          </>
        }
      />

      <div className={panelStyles.grid4}>
        <StatFilterTile
          icon={<IconFileDescription size={20} />}
          label='Total de solicitudes'
          value={tickets.length}
          tone='info'
          active={filters.status === ''}
          onClick={() => filterByStatus('')}
          ariaLabel='Mostrar todas las solicitudes'
        />
        <StatFilterTile
          icon={<IconProgress size={20} />}
          label='Pendientes'
          value={tickets.filter((t) => t.status?.toLowerCase() === 'abierto').length}
          tone='warning'
          active={filters.status === '1'}
          onClick={() => filterByStatus('1')}
          ariaLabel='Filtrar solicitudes pendientes'
        />
        <StatFilterTile
          icon={<IconCheck size={20} />}
          label='Completadas'
          value={tickets.filter((t) => t.status?.toLowerCase() === 'resuelto').length}
          tone='ok'
          active={filters.status === '2'}
          onClick={() => filterByStatus('2')}
          ariaLabel='Filtrar solicitudes completadas'
        />
        <ProgressRingTile
          label='Avance de tareas'
          done={globalProgress.done}
          total={globalProgress.total}
          percent={globalProgress.percent}
        />
      </div>

      {error && (
        <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' radius='lg' mt='md'>
          {error}
        </Alert>
      )}

      <FilterPanel
        expanded={filtersExpanded}
        onToggle={() => setFiltersExpanded(!filtersExpanded)}
        icon={<IconFilter size={18} />}
      >
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
                      { value: '7', label: 'Devuelta' },
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
      </FilterPanel>

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
                            <RequestProgressBar {...getTasksProgress(tasksByRequest[ticket.id])} />
                            <Group gap={6} wrap='wrap'>
                              {buildTaskDisplayBadges(tasksByRequest[ticket.id]).map((badge) => {
                                const { color, Icon } = getTaskVisual(badge.statusKey);
                                return (
                                  <Tooltip
                                    key={badge.key}
                                    label={`${badge.label} · ${badge.statusLabel}`}
                                    withArrow
                                  >
                                    <Badge
                                      variant='light'
                                      color={color}
                                      size='sm'
                                      radius='sm'
                                      styles={{
                                        root: {
                                          textTransform: 'none',
                                          fontWeight: 500,
                                          cursor: 'default',
                                        },
                                        label: {
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        },
                                      }}
                                      leftSection={<Icon size={13} />}
                                    >
                                      {badge.label}
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
          /* 90 % del ancho de la ventana, no 'xl' (que son 900 px fijos).
             Pedido de Nicolás Rojas, y es el MISMO cambio de su commit 9309276
             del PR #241: "hacer más grande el modal de creación, ya que si
             tenemos campos de tabla que son extensos en columnas puedan
             visualizarse sin ningún problema".
             El commit original no se pudo traer entero porque su otra mitad
             —un refactor del reseteo del formulario— choca con lo que `testing`
             reescribió al entrar los campos de tabla dinámicos y Gestión
             Documental. Esta es su intención aplicada sobre el código de hoy.
             La tabla ya venía con su propio desplazamiento horizontal
             (ScrollArea en TableFieldInput), así que con el ancho extra las
             columnas se ven sin pelear. */
          size='90%'
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
                  disabled={formDataLoading || lockedLinked}
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
                      className='max-h-64 overflow-y-auto'
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
                  disabled={formDataLoading || lockedLinked}
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
                  disabled={!formData.category || formDataLoading || lockedLinked}
                />
              </Grid.Col>
            </Grid>

            {(() => {
              const processName = (
                filteredProcesses.find((p) => p.value === formData.process)?.label || ''
              ).split(' - ')[0];
              if (processName !== 'Solicitud de Pago') return null;
              const companyName =
                companies.find((c) => c.value === formData.company)?.label || '';
              return (
                <Alert
                  icon={<IconCalendarEvent size={20} />}
                  color='blue'
                  variant='light'
                  title='Fecha estimada de pago'
                >
                  <Text size='sm' tt='capitalize'>
                    {formatEstimatedPaymentDate(companyName, new Date())}
                  </Text>
                  <Text size='xs' c='dimmed' mt={4}>
                    Estimación según la fecha de creación; puede variar.
                  </Text>
                </Alert>
              );
            })()}

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

            {displayedFields.length > 0 && (
              <Stack gap='md'>
                <Text fw={600}>Información adicional</Text>
                <Grid>
                  {displayedFields.map((field) => {
                    const rawValue = fieldValues[field.id];
                    const clearFieldError = () => {
                      if (formErrors[`field_${field.id}`]) {
                        setFormErrors((prev) => ({ ...prev, [`field_${field.id}`]: '' }));
                      }
                    };
                    const setTextValue = (v: string) => {
                      setFieldValues((prev) => {
                        const next = { ...prev };
                        if (v) next[field.id] = v;
                        else delete next[field.id];
                        return next;
                      });
                      clearFieldError();
                    };
                    // Moneda: por field_type ('money') o, para campos viejos sin tipo de
                    // moneda, detectada por label ("Valor a Pagar"/monto). Muestra separador
                    // de miles (400.000) y guarda el número limpio (400000).
                    const isMoneyField =
                      field.field_type === 'money' ||
                      /valor a pagar|monto/i.test(field.field_label);
                    const isTableField = field.field_type === TABLE_FIELD_TYPE;
                    return (
                      <Grid.Col span={{ base: 12, md: isTableField ? 12 : 6 }} key={field.id}>
                        {isTableField ? (
                          <TableFieldInput
                            label={field.field_label}
                            required={field.required}
                            columns={parseTableConfig(field.config_json).columns}
                            rows={Array.isArray(rawValue) ? (rawValue as TableRow[]) : []}
                            onChange={(newRows) => {
                              setFieldValues((prev) => {
                                const next = { ...prev };
                                if (newRows.length > 0) next[field.id] = newRows;
                                else delete next[field.id];
                                return next;
                              });
                              clearFieldError();
                            }}
                            companyId={Number(formData.company) || undefined}
                            error={formErrors[`field_${field.id}`]}
                          />
                        ) : isMoneyField ? (
                          <NumberInput
                            label={field.field_label}
                            placeholder='Ingrese el valor'
                            required={field.required}
                            value={
                              rawValue === undefined || rawValue === ''
                                ? ''
                                : (rawValue as number | string)
                            }
                            onChange={(value) => {
                              setFieldValues((prev) => {
                                const next = { ...prev };
                                if (value === '' || value === null || value === undefined)
                                  delete next[field.id];
                                else next[field.id] = value;
                                return next;
                              });
                              clearFieldError();
                            }}
                            thousandSeparator='.'
                            decimalSeparator=','
                            decimalScale={0}
                            allowNegative={false}
                            hideControls
                            min={0}
                            error={formErrors[`field_${field.id}`]}
                            leftSection={<IconTag size={16} />}
                          />
                        ) : field.field_type === 'select' ? (
                          <Select
                            label={field.field_label}
                            placeholder='Seleccione una opción'
                            required={field.required}
                            data={field.options.map((o) => ({
                              value: o.id.toString(),
                              label: o.option_label,
                            }))}
                            value={
                              typeof rawValue === 'number' ? rawValue.toString() : null
                            }
                            onChange={(value) => {
                              setFieldValues((prev) => {
                                const next = { ...prev };
                                if (value) next[field.id] = parseInt(value);
                                else delete next[field.id];
                                return next;
                              });
                              clearFieldError();
                            }}
                            error={formErrors[`field_${field.id}`]}
                            clearable
                            leftSection={<IconTag size={16} />}
                          />
                        ) : isSapField(field.field_type) ? (
                          <SapOptionSelect
                            source={field.field_type}
                            companyId={Number(formData.company) || undefined}
                            label={field.field_label}
                            required={field.required}
                            value={typeof rawValue === 'string' ? rawValue : undefined}
                            onChange={setTextValue}
                            error={formErrors[`field_${field.id}`]}
                          />
                        ) : field.field_type === 'number' ? (
                          <NumberInput
                            label={field.field_label}
                            placeholder='Ingrese un valor'
                            required={field.required}
                            value={rawValue === undefined ? '' : (rawValue as number | string)}
                            onChange={(value) => {
                              setFieldValues((prev) => {
                                const next = { ...prev };
                                if (value === '' || value === null || value === undefined)
                                  delete next[field.id];
                                else next[field.id] = value;
                                return next;
                              });
                              clearFieldError();
                            }}
                            error={formErrors[`field_${field.id}`]}
                            leftSection={<IconTag size={16} />}
                          />
                        ) : field.field_type === 'date' ? (
                          <TextInput
                            type='date'
                            label={field.field_label}
                            required={field.required}
                            value={typeof rawValue === 'string' ? rawValue : ''}
                            onChange={(e) => setTextValue(e.currentTarget.value)}
                            error={formErrors[`field_${field.id}`]}
                            leftSection={<IconTag size={16} />}
                          />
                        ) : field.field_type === 'yesno' ? (
                          <Select
                            label={field.field_label}
                            placeholder='Seleccione Sí o No'
                            required={field.required}
                            data={[
                              { value: 'Sí', label: 'Sí' },
                              { value: 'No', label: 'No' },
                            ]}
                            value={typeof rawValue === 'string' ? rawValue : null}
                            onChange={(value) => setTextValue(value || '')}
                            error={formErrors[`field_${field.id}`]}
                            clearable
                            leftSection={<IconTag size={16} />}
                          />
                        ) : field.field_type === 'url' ? (
                          <TextInput
                            type='url'
                            label={field.field_label}
                            placeholder='https://…'
                            required={field.required}
                            value={typeof rawValue === 'string' ? rawValue : ''}
                            onChange={(e) => setTextValue(e.currentTarget.value)}
                            error={formErrors[`field_${field.id}`]}
                            leftSection={<IconLink size={16} />}
                          />
                        ) : (
                          <TextInput
                            label={field.field_label}
                            placeholder='Ingrese el valor'
                            required={field.required}
                            value={typeof rawValue === 'string' ? rawValue : ''}
                            onChange={(e) => setTextValue(e.currentTarget.value)}
                            error={formErrors[`field_${field.id}`]}
                            leftSection={<IconTag size={16} />}
                          />
                        )}
                      </Grid.Col>
                    );
                  })}
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
    </RequestsPage>
  );
}

export default function TicketsBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <RequestBoard />
    </Suspense>
  );
}
