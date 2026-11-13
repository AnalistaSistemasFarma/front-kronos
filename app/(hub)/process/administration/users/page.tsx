'use client';

import { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import SapsendMappingModal from './SapsendMappingModal';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  Textarea,
  Select,
  MultiSelect,
  Button,
  Group,
  Badge,
  Modal,
  ActionIcon,
  Pagination,
  Loader,
  Card,
  Text,
  Avatar,
  ThemeIcon,
  Flex,
  Box,
  SimpleGrid,
  Tooltip,
  Checkbox,
  ScrollArea,
  SegmentedControl,
  Tabs,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconChevronRight,
  IconSearch,
  IconEdit,
  IconTrash,
  IconPlus,
  IconDownload,
  IconSettings,
  IconDatabase,
  IconUsers,
  IconShield,
  IconUsersGroup,
  IconLogin2,
  IconCheck,
  IconBuilding,
  IconLayoutGrid,
  IconListCheck,
  IconMinus,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { notifySubprocessAssignmentsChanged } from '@/lib/process/subprocessAssignmentsEvents';
import {
  DASHBOARD_SOLICITANTE_URL,
  DASHBOARD_SOLICITADO_URL,
  isHubHiddenRequestDashboardSubprocess,
} from '@/lib/request-general/dashboardRoutes';
import {
  isOrionFirmaPrepareSubprocess,
  isOrionFirmaSignSubprocess,
} from '@/lib/orion/access';
import { isDeleteAttachmentsSubprocess } from '@/lib/attachments/access';
import { isTeamTasksSubprocess } from '@/lib/request-general/teamTasksAccess';
import { isValentineWallSubprocess } from '@/lib/valentine/constants';
import { describeSgcPermissionMarker, isSgcPermissionMarkerSubprocess } from '@/lib/sgc/constants';
import { isProjectsConfigMarkerSubprocess, PROJECTS_CONFIG_MARKER_DESCRIPTION } from '@/lib/proyectos/config-agentes-rules';
import { describeOtPermissionMarker, isOtPermissionMarkerSubprocess } from '@/lib/bitacora-proceso/constants';
import {
  LOGIN_AUDIT_MARKER_DESCRIPTION,
  isLoginAuditMarkerSubprocess,
} from '@/lib/auth/login-audit/constants';
import LoginAuditPanel from '@/components/users/LoginAuditPanel';
import { isPermisosAgentesMarkerSubprocess, PERMISOS_AGENTES_MARKER_DESCRIPTION } from '@/lib/proyectos/permisos-agentes-rules';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';

const AVATAR_COLORS = ['blue', 'teal', 'violet', 'indigo', 'cyan', 'grape', 'orange'] as const;

function getUserInitials(name: string | null, email: string) {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function getAvatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash] ?? 'blue';
}

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  phone?: string | null;
  identification?: string | null;
}

interface Subprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url: string | null;
  id_process: number;
  process: {
    id_process: number;
    process: string;
  };
}

interface Company {
  id: number;
  name: string;
}

interface AssignedSubprocess {
  companyId: number;
  companyName: string;
  companyUserId: number;
  subprocesses: {
    id: number;
    subprocessId: number;
    subprocessName: string;
    subprocessUrl: string | null;
    processId: number;
    processName: string;
  }[];
}

/** Atajos del modal de subprocesos (suman o quitan su grupo). */
type SubprocessPreset = 'firma' | 'solicitudes' | 'admin' | 'todos' | 'ninguno';

/** Explicación corta de los subprocesos que son permisos (no aparecen como pantalla en Procesos). */
function getSubprocessHint(subprocess: Subprocess): string | null {
  if (!isHubHiddenRequestDashboardSubprocess(subprocess)) return null;
  const url = subprocess.subprocess_url ?? '';
  if (isPermisosAgentesMarkerSubprocess(subprocess)) return PERMISOS_AGENTES_MARKER_DESCRIPTION;
  if (isLoginAuditMarkerSubprocess(subprocess)) return LOGIN_AUDIT_MARKER_DESCRIPTION;
  if (isProjectsConfigMarkerSubprocess(subprocess)) return PROJECTS_CONFIG_MARKER_DESCRIPTION;
  if (isSgcPermissionMarkerSubprocess(subprocess)) {
    return describeSgcPermissionMarker(subprocess.subprocess_url);
  }
  if (isOtPermissionMarkerSubprocess(subprocess)) {
    return describeOtPermissionMarker(subprocess.subprocess_url);
  }
  if (isValentineWallSubprocess(subprocess)) {
    return 'Permiso OLP: corazón en el header (muro Dosis de Amor)';
  }
  if (isOrionFirmaPrepareSubprocess(subprocess)) {
    return 'Permiso: preparar PDF, firmantes y enviar a firma';
  }
  if (isOrionFirmaSignSubprocess(subprocess)) {
    return 'Permiso obligatorio para firmar (aunque esté como firmante)';
  }
  if (isDeleteAttachmentsSubprocess(subprocess)) {
    return 'Permiso: eliminar archivos adjuntos de solicitudes';
  }
  if (isTeamTasksSubprocess(subprocess)) {
    return 'Líder de solicitudes: ve la carga de su equipo (por departamento) y reasigna sus tareas en esta empresa';
  }
  if (url === DASHBOARD_SOLICITADO_URL || url.includes('dashboard-solicitado')) {
    return 'Da acceso a Dashboard personal en el menú';
  }
  if (url === DASHBOARD_SOLICITANTE_URL || url.includes('dashboard-solicitante')) {
    return 'Da acceso a Dashboard solicitudes en el menú';
  }
  return 'Da acceso al dashboard en el menú';
}

function UserManagement() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 768px)', true);
  const searchParams = useSearchParams();

  // Pestaña «Inicios de sesión» (auditoría de seguridad, 2026-10-16): solo se muestra si
  // el servidor confirma el permiso (lib/auth/login-audit/access.ts). ?vista=inicios-sesion abre directo.
  const [view, setView] = useState<'usuarios' | 'inicios-sesion'>(
    searchParams.get('vista') === 'inicios-sesion' ? 'inicios-sesion' : 'usuarios'
  );
  const [canViewLoginAudit, setCanViewLoginAudit] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    role: '',
    status: '',
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
  });
  const hasLoadedOnce = useRef(false); 

  // Modal states
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [subprocessModalOpened, setSubprocessModalOpened] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Subprocess management states
  const [allSubprocesses, setAllSubprocesses] = useState<Subprocess[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  // Empresas marcadas: todas reciben el mismo conjunto de subprocesos al guardar.
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [assignedSubprocesses, setAssignedSubprocesses] = useState<AssignedSubprocess[]>([]);
  // Solo los cambios hechos en esta edición: al guardar se agregan/quitan esos subprocesos en las
  // empresas marcadas y todo lo demás que ya tiene cada empresa se conserva.
  const [subprocessDelta, setSubprocessDelta] = useState<{ added: number[]; removed: number[] }>({
    added: [],
    removed: [],
  });
  const [subprocessSearch, setSubprocessSearch] = useState('');
  const [subprocessLoading, setSubprocessLoading] = useState(false);
  /** Misma UX que Orion: primero procesos, luego empresas. */
  const [subprocessModalTab, setSubprocessModalTab] = useState<'procesos' | 'empresas'>(
    'procesos'
  );
  const [multiCompany, setMultiCompany] = useState(true);
  // «Ver asignados»: foto de lo marcado al activarlo (null = apagado); así una tarjeta que se
  // desmarca sigue a la vista en vez de desaparecer.
  const [assignedSnapshot, setAssignedSnapshot] = useState<number[] | null>(null);
  // Botones que quitan todo: piden un segundo toque para confirmar.
  const [confirmClear, setConfirmClear] = useState<'quitar' | 'ninguno' | null>(null);

  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Bulk assignment
  const [bulkModalOpened, setBulkModalOpened] = useState(false);
  const [bulkEmailDomain, setBulkEmailDomain] = useState('');
  const [bulkEmailsText, setBulkEmailsText] = useState('');
  const [bulkCompany, setBulkCompany] = useState('');
  const [bulkSubprocessIds, setBulkSubprocessIds] = useState<number[]>([]);
  const [bulkSubprocessSearch, setBulkSubprocessSearch] = useState('');
  const [bulkMode, setBulkMode] = useState<'add' | 'replace' | 'remove'>('add');
  const [bulkPreviewUsers, setBulkPreviewUsers] = useState<
    { id: string; name: string | null; email: string; role: string; isActive: boolean }[]
  >([]);
  const [bulkSelectedUserIds, setBulkSelectedUserIds] = useState<string[]>([]);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkTruncated, setBulkTruncated] = useState(false);
  const [bulkCoverageLoading, setBulkCoverageLoading] = useState(false);
  const [bulkCoverage, setBulkCoverage] = useState<{
    summary: {
      all: number;
      some: number;
      none: number;
      total: number;
      hasAnywhere?: number;
      scope?: string;
      companyName?: string | null;
    };
    bySubprocess: {
      id: number;
      name: string;
      processName: string;
      withCount: number;
      withoutCount: number;
      withAnywhereCount?: number;
    }[];
    rowsByUserId: Record<
      string,
      {
        status: 'all' | 'some' | 'none';
        hasCount: number;
        totalCount: number;
        presentNames: string[];
        missingNames: string[];
        presentElsewhereNames?: string[];
        companies?: string[];
        hasAnywhere?: boolean;
      }
    >;
  } | null>(null);

  // Authorization types states (submodal shown when the "Autorización" subprocess is assigned)
  const [authTypeModalOpened, setAuthTypeModalOpened] = useState(false);
  // Mapeo SAPSEND por empresa (modulo de compras).
  const [sapsendUser, setSapsendUser] = useState<User | null>(null);
  const [authorizationTypeOptions, setAuthorizationTypeOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedAuthorizationTypeIds, setSelectedAuthorizationTypeIds] = useState<string[]>([]);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user',
    isActive: true,
    phone: '',
    identification: '',
  });
  const [formLoading, setFormLoading] = useState(false);

  // Department assignment states
  const [departmentOptions, setDepartmentOptions] = useState<{ value: string; label: string }[]>(
    []
  );
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);

  // Id of the "Autorización" subprocess (identified by its url), if present in the catalog
  const authSubprocessId =
    allSubprocesses.find((s) => s.subprocess_url === '/process/authorization')?.id_subprocess ??
    null;

  // Debounce del buscador: refresca la tabla automáticamente buscando en TODA la BD
  // (el API aplica el filtro antes de paginar). Al buscar siempre volvemos a página 1.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim();
      setFilters((prev) => {
        if (prev.search === next) return prev;
        return { ...prev, search: next };
      });
      setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchUsers = useCallback(async () => {
    try {
      // Solo bloquea la UI en la primera carga; al filtrar/paginar se actualiza en silencio.
      if (!hasLoadedOnce.current) setLoading(true);

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: filters.search,
        role: filters.role,
        status: filters.status,
      });

      const response = await fetch(`/api/users?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('No tienes permisos para acceder a esta página');
        }
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'No se pudieron cargar los usuarios');
      }
      const data = await response.json();
      setUsers(data.users);
      setPagination((prev) => ({
        ...prev,
        total: data.pagination.total,
        pages: data.pagination.pages,
      }));
      setError(null);
      hasLoadedOnce.current = true;
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unable to load users. Please try again.';
      setError(errorMessage);
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.role, filters.status, pagination.page, pagination.limit]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    void fetchUsers();
  }, [session, status, router, fetchUsers]);

  useEffect(() => {
    if (status === 'loading' || !session) return;
    let cancelled = false;
    fetch('/api/users/login-audit/access', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { allowed: false }))
      .then((body: { allowed?: boolean }) => {
        if (cancelled) return;
        setCanViewLoginAudit(Boolean(body?.allowed));
        if (!body?.allowed) setView('usuarios');
      })
      .catch(() => {
        if (!cancelled) setCanViewLoginAudit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, status]);

  const showLoginAudit = canViewLoginAudit && view === 'inicios-sesion';

  // Load department catalog for the MultiSelect (used in create/edit modals)
  useEffect(() => {
    if (status === 'loading' || !session) return;

    const loadDepartments = async () => {
      try {
        const response = await fetch('/api/help-desk/departments', { cache: 'no-store' });
        if (!response.ok) return;
        const data: { id_department: number; department: string }[] = await response.json();
        setDepartmentOptions(
          data.map((d) => ({ value: d.id_department.toString(), label: d.department }))
        );
      } catch (err) {
        console.error('Error loading departments:', err);
      }
    };

    loadDepartments();
  }, [session, status]);

  const handleFilterChange = (field: 'role' | 'status', value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const sendEmailNotification = async (recipients: string): Promise<boolean> => {
    if (!process.env.API_EMAIL) {
      console.error('Error: La variable de entorno API_EMAIL no está configurada');
      setUpdateMessage({
        type: 'error',
        text: 'Error de configuración: No se puede enviar la notificación por correo. Contacte al administrador.',
      });
      return false;
    }

    try {
      const message = `Credenciales SynerLink  ${formData?.name}`;
      const emails = recipients;

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'Usuario': formData?.email,
          'Contraseña': formData?.password,
          'Enlace de Acceso': `<a href="https://groupsharedservices.farmalogica.com:8445/login">https://groupsharedservices.farmalogica.com:8445/login</a>`,
        },
      ];

      const outro = `Te confirmamos que tu acceso a SynerLink ya está activo con tus nuevas credenciales. Si tienes algún inconveniente al ingresar, registra un caso en la Mesa de Ayuda a través del siguiente enlace: <a href="https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=kZrxWHFYXkCtzFtukGuz9Vc3GKrCGIpKi4GcZ3rlRP1UMEtFQjZYWkVTQllJMVMwNTNZRlRCWTNZWi4u&origin=QRCode">Mesa de Ayuda</a> Este mensaje y sus adjuntos son confidenciales y para uso exclusivo de su destinatario.`;

      const result = await sendMessage(
        message,
        emails,
        table,
        outro,
        'https://groupsharedservices.farmalogica.com:8445/icons/icon-192.png', 
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

  const handleCreateUser = async () => {
    try {
      setFormLoading(true);
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create user');
      }

      const { user } = await response.json();

      // Assign selected departments to the newly created user
      if (selectedDepartmentIds.length > 0) {
        const deptResponse = await fetch(`/api/users/${user.id}/departments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ departmentIds: selectedDepartmentIds.map(Number) }),
        });
        if (!deptResponse.ok) {
          toast.error('Usuario creado, pero no se pudieron asignar los departamentos');
        }
      }

      await sendEmailNotification(formData?.email);

      // Add the new user to the list
      setUsers((prev) => [user, ...prev]);

      // Reset form and close modal
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'user',
        isActive: true,
        phone: '',
        identification: '',
      });
      setSelectedDepartmentIds([]);
      setCreateModalOpened(false);
      toast.success('Usuario creado exitosamente');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Error al crear usuario';
      console.error('Error creating user:', err);
      toast.error(errorMessage);
    } finally {
      setFormLoading(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      const updateData = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        isActive: formData.isActive,
        phone: formData.phone || null,
        identification: formData.identification || null,
        ...(formData.password && { password: formData.password }),
      };

      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update user');
      }

      const { user } = await response.json();

      // Update the user's department assignments (replace set)
      const deptResponse = await fetch(`/api/users/${selectedUser.id}/departments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentIds: selectedDepartmentIds.map(Number) }),
      });
      if (!deptResponse.ok) {
        toast.error('Usuario actualizado, pero no se pudieron guardar los departamentos');
      }

      // Update the user in the list
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));

      // Reset form and close modal
      setEditModalOpened(false);
      setSelectedUser(null);
      setSelectedDepartmentIds([]);
      toast.success('Usuario actualizado exitosamente');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Error al actualizar usuario';
      console.error('Error updating user:', err);
      toast.error(errorMessage);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to deactivate user');
      }

      const { user } = await response.json();

      // Update the user in the list
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));

      // Close modal
      setDeleteModalOpened(false);
      setSelectedUser(null);
      toast.success('Usuario desactivado exitosamente');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Error al desactivar usuario';
      console.error('Error deactivating user:', err);
      toast.error(errorMessage);
    } finally {
      setFormLoading(false);
    }
  };

  const openEditModal = async (user: User) => {
    setSelectedUser(user);
    setFormData({
      name: user.name || '',
      email: user.email,
      password: '',
      role: user.role,
      isActive: user.isActive,
      phone: user.phone || '',
      identification: user.identification || '',
    });
    setSelectedDepartmentIds([]);
    setEditModalOpened(true);

    // Preload the departments currently assigned to this user
    try {
      const response = await fetch(`/api/users/${user.id}/departments`, { cache: 'no-store' });
      if (response.ok) {
        const { departments } = await response.json();
        setSelectedDepartmentIds(
          departments.map((d: { id_department: number }) => d.id_department.toString())
        );
      }
    } catch (err) {
      console.error('Error loading user departments:', err);
    }
  };

  const openDeleteModal = (user: User) => {
    setSelectedUser(user);
    setDeleteModalOpened(true);
  };

  const openSubprocessModal = async (user: User) => {
    setSelectedUser(user);
    setSubprocessModalOpened(true);
    setSubprocessLoading(true);
    setSelectedCompanyIds([]);
    setSubprocessDelta({ added: [], removed: [] });
    setSubprocessSearch('');
    setSubprocessModalTab('procesos');
    setMultiCompany(true);
    setAssignedSnapshot(null);
    setConfirmClear(null);
    setSelectedAuthorizationTypeIds([]);

    try {
      const [
        subprocessesResponse,
        companiesResponse,
        assignedResponse,
        authTypesResponse,
        userAuthTypesResponse,
      ] = await Promise.all([
        fetch('/api/subprocesses', { cache: 'no-store' }),
        fetch('/api/companies', { cache: 'no-store' }),
        fetch(`/api/users/${user.id}/subprocesses`, { cache: 'no-store' }),
        fetch('/api/authorization-types', { cache: 'no-store' }),
        fetch(`/api/users/${user.id}/authorization-types`, { cache: 'no-store' }),
      ]);

      if (authTypesResponse.ok) {
        const types: { id: number; type_authorization: string }[] = await authTypesResponse.json();
        setAuthorizationTypeOptions(
          types.map((t) => ({ value: t.id.toString(), label: t.type_authorization }))
        );
        console.log(authTypesResponse);
      }

      if (userAuthTypesResponse.ok) {
        const { typeIds } = await userAuthTypesResponse.json();
        setSelectedAuthorizationTypeIds((typeIds as number[]).map((id) => id.toString()));
      }

      let companiesData: Company[] = [];
      if (companiesResponse.ok) {
        companiesData = await companiesResponse.json();
        setCompanies(companiesData);
      }

      if (subprocessesResponse.ok) {
        const { subprocesses } = await subprocessesResponse.json();
        setAllSubprocesses(subprocesses);
      }

      if (assignedResponse.ok) {
        const { assignedSubprocesses: assigned } = await assignedResponse.json();
        setAssignedSubprocesses(assigned);

        // Arranca con la empresa que más subprocesos tenga hoy; las demás se marcan solo si ya
        // tienen exactamente ese mismo conjunto (así lo que se ve es lo que hay).
        const withSubs = assigned.filter(
          (a: AssignedSubprocess) => a.subprocesses.length > 0
        ) as AssignedSubprocess[];
        if (withSubs.length > 0) {
          const template = [...withSubs].sort(
            (a, b) => b.subprocesses.length - a.subprocesses.length
          )[0]!;
          const templateIds = template.subprocesses.map((s) => s.subprocessId);
          const templateSet = new Set(templateIds);
          const matchingCompanies = withSubs
            .filter((a) => {
              const ids = a.subprocesses.map((s) => s.subprocessId);
              return (
                ids.length === templateSet.size && ids.every((id) => templateSet.has(id))
              );
            })
            .map((a) => a.companyId.toString());
          setSelectedCompanyIds(matchingCompanies);
          setMultiCompany(matchingCompanies.length !== 1);
        } else {
          setSelectedCompanyIds([]);
          setMultiCompany(true);
        }
      } else {
        setSelectedCompanyIds([]);
      }
    } catch (error) {
      console.error('Error loading subprocess data:', error);
      toast.error('Error al cargar los datos de subprocesos');
    } finally {
      setSubprocessLoading(false);
    }
  };

  const getCompanySubprocessIds = (companyId: string) =>
    assignedSubprocesses
      .find((a) => a.companyId === parseInt(companyId, 10))
      ?.subprocesses.map((s) => s.subprocessId) ?? [];

  // Lo que ya tienen hoy las empresas marcadas: «en alguna» (union) y «en todas» (all).
  const baseSubprocessSets = selectedCompanyIds.map((id) => new Set(getCompanySubprocessIds(id)));
  const baseUnion = new Set<number>(baseSubprocessSets.flatMap((s) => [...s]));
  const baseAll = new Set<number>(
    [...baseUnion].filter((id) => baseSubprocessSets.every((s) => s.has(id)))
  );
  const deltaAdded = new Set(subprocessDelta.added);
  const deltaRemoved = new Set(subprocessDelta.removed);
  /** Lo que se ve marcado: lo que ya tienen + lo agregado ahora − lo quitado ahora. */
  const selectedSubprocessIds = [...new Set([...baseUnion, ...deltaAdded])].filter(
    (id) => !deltaRemoved.has(id)
  );
  /** Marcado solo en algunas de las empresas elegidas (y sin tocar en esta edición). */
  const isPartialSubprocess = (id: number) =>
    baseUnion.has(id) && !baseAll.has(id) && !deltaAdded.has(id) && !deltaRemoved.has(id);

  /**
   * Registra cambios puntuales. Encender = agregar en todas las empresas marcadas; apagar =
   * quitar de todas. Lo que no se toca no cambia en ninguna empresa.
   */
  const changeSubprocesses = (turnOn: number[], turnOff: number[]) => {
    if (
      authSubprocessId !== null &&
      turnOn.includes(authSubprocessId) &&
      !selectedSubprocessIds.includes(authSubprocessId)
    ) {
      setAuthTypeModalOpened(true);
    }
    setSubprocessDelta((prev) => {
      const added = new Set(prev.added);
      const removed = new Set(prev.removed);
      for (const id of turnOff) {
        added.delete(id);
        if (baseUnion.has(id)) removed.add(id);
      }
      for (const id of turnOn) {
        removed.delete(id);
        if (!baseAll.has(id)) added.add(id);
      }
      return { added: [...added], removed: [...removed] };
    });
  };

  /** Empresas donde se aplicarán los cambios. Los cambios hechos se conservan al cambiarlas. */
  const handleCompanyIdsChange = (next: string[]) => {
    setSelectedCompanyIds(multiCompany ? next : next.slice(0, 1));
    setAssignedSnapshot(null);
  };

  /** «Varias»: los cambios van a todas las marcadas. «Una»: solo a esa empresa. */
  const handleToggleCompany = (companyId: string) => {
    if (!multiCompany) {
      handleCompanyIdsChange(selectedCompanyIds[0] === companyId ? [] : [companyId]);
      return;
    }
    handleCompanyIdsChange(
      selectedCompanyIds.includes(companyId)
        ? selectedCompanyIds.filter((id) => id !== companyId)
        : [...selectedCompanyIds, companyId]
    );
  };

  const handleSetMultiCompany = (enabled: boolean) => {
    if (enabled === multiCompany) return;
    setMultiCompany(enabled);
    if (!enabled) {
      setSelectedCompanyIds(selectedCompanyIds[0] ? [selectedCompanyIds[0]] : []);
    }
  };

  /** Deja marcado exactamente lo que el usuario tiene hoy en otra empresa. */
  const handleLoadSubprocessesFromCompany = (companyId: string) => {
    if (!companyId) return;
    const target = getCompanySubprocessIds(companyId);
    changeSubprocesses(
      target,
      selectedSubprocessIds.filter((id) => !target.includes(id))
    );
  };

  /**
   * «Quitar todos» (arriba) y «Ninguno» (atajo) desmarcan todo: el primer toque pide
   * confirmación y el segundo, dentro de 4 s, lo hace.
   */
  const confirmThenClear = (kind: 'quitar' | 'ninguno', clear: () => void) => {
    if (confirmClear !== kind) {
      setConfirmClear(kind);
      window.setTimeout(() => setConfirmClear((c) => (c === kind ? null : c)), 4000);
      return;
    }
    setConfirmClear(null);
    clear();
  };

  /** Atajos: suman su grupo; si ya está todo el grupo marcado, lo quitan. */
  const getPresetIds = (kind: Exclude<SubprocessPreset, 'ninguno'>) =>
    allSubprocesses
      .filter((s) => {
        if (kind === 'todos') return true;
        const url = (s.subprocess_url || '').toLowerCase();
        const name = `${s.subprocess} ${s.process.process}`.toLowerCase();
        if (kind === 'firma') {
          return (
            url.includes('orion') ||
            url.includes('authorization') ||
            url.includes('firma') ||
            name.includes('firma') ||
            name.includes('autoriz')
          );
        }
        if (kind === 'solicitudes') {
          return (
            url.includes('request-general') ||
            url.includes('solicitudes') ||
            name.includes('solicitud')
          );
        }
        return (
          url.includes('administration') ||
          url.includes('users') ||
          name.includes('admin') ||
          name.includes('usuario')
        );
      })
      .map((s) => s.id_subprocess);

  /** ¿Todo el grupo del atajo ya está marcado en todas las empresas? (para pintarlo activo). */
  const isPresetActive = (kind: Exclude<SubprocessPreset, 'ninguno'>) => {
    const ids = getPresetIds(kind);
    return (
      ids.length > 0 &&
      ids.every((id) => selectedSubprocessIds.includes(id) && !isPartialSubprocess(id))
    );
  };

  const applySubprocessPreset = (kind: SubprocessPreset) => {
    if (kind === 'ninguno') {
      confirmThenClear('ninguno', () => changeSubprocesses([], selectedSubprocessIds));
      return;
    }
    const ids = getPresetIds(kind);
    if (isPresetActive(kind)) changeSubprocesses([], ids);
    else changeSubprocesses(ids, []);
  };

  const handleSubprocessToggle = (subprocessId: number) => {
    // Solo en algunas empresas → se da en todas las marcadas (completar). Marcado en todas → se
    // quita de todas. Sin marcar → se agrega en todas.
    if (isPartialSubprocess(subprocessId)) changeSubprocesses([subprocessId], []);
    else if (selectedSubprocessIds.includes(subprocessId)) changeSubprocesses([], [subprocessId]);
    else changeSubprocesses([subprocessId], []);
  };

  const getFilteredSubprocesses = () => {
    const base = assignedSnapshot
      ? allSubprocesses.filter((s) => assignedSnapshot.includes(s.id_subprocess))
      : allSubprocesses;
    if (!subprocessSearch) return base;
    const searchLower = subprocessSearch.toLowerCase();
    return base.filter(
      (s) =>
        s.subprocess.toLowerCase().includes(searchLower) ||
        s.process.process.toLowerCase().includes(searchLower)
    );
  };

  /** Lo que quedará en una empresa: lo que ya tiene + lo agregado − lo quitado. */
  const getFinalCompanySubprocessIds = (companyId: string) =>
    [...new Set([...getCompanySubprocessIds(companyId), ...subprocessDelta.added])].filter(
      (id) => !deltaRemoved.has(id)
    );

  /** Qué gana y qué pierde cada empresa marcada al guardar (solo las que cambian). */
  const getCompanyChanges = () =>
    selectedCompanyIds
      .map((id) => {
        const current = getCompanySubprocessIds(id);
        const finalIds = getFinalCompanySubprocessIds(id);
        return {
          id,
          finalIds,
          name: companies.find((c) => c.id.toString() === id)?.name ?? `Empresa ${id}`,
          gains: finalIds.filter((s) => !current.includes(s)).length,
          loses: current.filter((s) => !finalIds.includes(s)).length,
        };
      })
      .filter((c) => c.gains > 0 || c.loses > 0);

  const getOtherCompanyAssignments = () =>
    assignedSubprocesses.filter(
      (assignment) =>
        !selectedCompanyIds.includes(assignment.companyId.toString()) &&
        assignment.subprocesses.length > 0
    );

  const handleSaveSubprocesses = async () => {
    if (!selectedUser || selectedCompanyIds.length === 0) {
      toast.error('Seleccione al menos una empresa');
      return;
    }
    // Cada empresa se guarda con lo suyo + los cambios; las que no cambian no se tocan.
    const toSave = getCompanyChanges();
    if (toSave.length === 0) {
      toast.success('No hay cambios para guardar');
      setSubprocessModalOpened(false);
      return;
    }

    // «Autorización» es por usuario: sigue asignada si queda en alguna empresa después de guardar.
    const finalSets = new Map<string, number[]>(
      assignedSubprocesses.map((a) => [
        a.companyId.toString(),
        a.subprocesses.map((s) => s.subprocessId),
      ])
    );
    for (const c of toSave) finalSets.set(c.id, c.finalIds);
    const authAssignedAfterSave =
      authSubprocessId !== null &&
      [...finalSets.values()].some((ids) => ids.includes(authSubprocessId));

    if (authAssignedAfterSave && selectedAuthorizationTypeIds.length === 0) {
      toast.error('Debe seleccionar al menos un tipo de autorización');
      return;
    }

    try {
      setSubprocessLoading(true);
      const result = { added: 0, removed: 0 };
      for (const c of toSave) {
        const response = await fetch(`/api/users/${selectedUser.id}/subprocesses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyIds: [parseInt(c.id, 10)], subprocessIds: c.finalIds }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `${c.name}: ${errorData.error || 'No se pudieron guardar los subprocesos'}`
          );
        }
        const data = await response.json();
        result.added += Number(data.added) || 0;
        result.removed += Number(data.removed) || 0;
      }

      // Persist authorization types (per-user). Empty array clears them when Autorización is no
      // longer assigned in any company.
      const authTypesResponse = await fetch(
        `/api/users/${selectedUser.id}/authorization-types`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            typeIds: authAssignedAfterSave ? selectedAuthorizationTypeIds.map(Number) : [],
          }),
        }
      );
      if (!authTypesResponse.ok) {
        toast.error('Subprocesos guardados, pero no se pudieron guardar los tipos de autorización');
      }

      toast.success(
        `Subprocesos actualizados${
          toSave.length > 1 ? ` en ${toSave.length} empresas` : ''
        }: ${result.added} agregados, ${result.removed} removidos`
      );
      setSubprocessDelta({ added: [], removed: [] });

      const assignedResponse = await fetch(`/api/users/${selectedUser.id}/subprocesses`, {
        cache: 'no-store',
      });
      if (assignedResponse.ok) {
        const { assignedSubprocesses: assigned } = await assignedResponse.json();
        setAssignedSubprocesses(assigned);
      }

      notifySubprocessAssignmentsChanged();
      setSubprocessModalOpened(false);
    } catch (error) {
      console.error('Error saving subprocesses:', error);
      toast.error(error instanceof Error ? error.message : 'Error al guardar subprocesos');
    } finally {
      setSubprocessLoading(false);
    }
  };

  const openBulkModal = async () => {
    setBulkModalOpened(true);
    setBulkEmailDomain('');
    setBulkEmailsText('');
    setBulkCompany('');
    setBulkSubprocessIds([]);
    setBulkSubprocessSearch('');
    setBulkMode('add');
    setBulkPreviewUsers([]);
    setBulkSelectedUserIds([]);
    setBulkTruncated(false);
    setBulkCoverage(null);

    try {
      const [subprocessesResponse, companiesResponse] = await Promise.all([
        fetch('/api/subprocesses', { cache: 'no-store' }),
        fetch('/api/companies', { cache: 'no-store' }),
      ]);

      if (companiesResponse.ok) {
        const companiesData: Company[] = await companiesResponse.json();
        setCompanies(companiesData);
        setBulkCompany('all');
      }

      if (subprocessesResponse.ok) {
        const { subprocesses } = await subprocessesResponse.json();
        setAllSubprocesses(subprocesses);
      }
    } catch (error) {
      console.error('Error loading bulk assignment data:', error);
      toast.error('Error al cargar datos para asignación masiva');
    }
  };

  const handleBulkPreview = async () => {
    const emailDomain = bulkEmailDomain.trim();
    const emails = bulkEmailsText.trim();
    if (!emailDomain && !emails) {
      toast.error('Indique un dominio (ej. onelatampharma) o una lista de correos');
      return;
    }

    try {
      setBulkPreviewLoading(true);
      const params = new URLSearchParams();
      if (emailDomain) params.set('emailDomain', emailDomain);
      if (emails) params.set('emails', emails);

      const response = await fetch(`/api/users/bulk-subprocesses?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'No se pudo previsualizar usuarios');
      }
      const data = await response.json();
      const list = (data.users || []) as typeof bulkPreviewUsers;
      setBulkPreviewUsers(list);
      setBulkSelectedUserIds(list.map((u) => u.id));
      setBulkTruncated(Boolean(data.truncated));
      if (list.length === 0) {
        toast.error('No se encontraron usuarios activos con ese criterio');
      } else {
        toast.success(`${list.length} usuario(s) encontrados`);
      }
    } catch (error) {
      console.error('Error previewing bulk users:', error);
      toast.error(error instanceof Error ? error.message : 'Error al previsualizar');
    } finally {
      setBulkPreviewLoading(false);
    }
  };

  const getBulkFilteredSubprocesses = () => {
    if (!bulkSubprocessSearch) return allSubprocesses;
    const searchLower = bulkSubprocessSearch.toLowerCase();
    return allSubprocesses.filter(
      (s) =>
        s.subprocess.toLowerCase().includes(searchLower) ||
        s.process.process.toLowerCase().includes(searchLower)
    );
  };

  const handleBulkCheckCoverage = async () => {
    if (!bulkCompany) {
      toast.error('Seleccione una empresa o “Todas las empresas”');
      return;
    }
    if (bulkSubprocessIds.length === 0) {
      toast.error('Seleccione al menos un subproceso');
      return;
    }
    if (bulkSelectedUserIds.length === 0) {
      toast.error('Seleccione al menos un usuario');
      return;
    }

    try {
      setBulkCoverageLoading(true);
      const response = await fetch('/api/users/bulk-subprocesses/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: bulkCompany === 'all' ? 'all' : parseInt(bulkCompany, 10),
          subprocessIds: bulkSubprocessIds,
          userIds: bulkSelectedUserIds,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'No se pudo verificar la cobertura');
      }
      const data = await response.json();
      const rowsByUserId: NonNullable<typeof bulkCoverage>['rowsByUserId'] = {};
      for (const row of data.rows as Array<{
        userId: string;
        status: 'all' | 'some' | 'none';
        hasCount: number;
        totalCount: number;
        presentNames: string[];
        missingNames: string[];
        presentElsewhereNames?: string[];
        companies?: string[];
        hasAnywhere?: boolean;
      }>) {
        rowsByUserId[row.userId] = {
          status: row.status,
          hasCount: row.hasCount,
          totalCount: row.totalCount,
          presentNames: row.presentNames,
          missingNames: row.missingNames,
          presentElsewhereNames: row.presentElsewhereNames,
          companies: row.companies,
          hasAnywhere: row.hasAnywhere,
        };
      }
      setBulkCoverage({
        summary: data.summary,
        bySubprocess: data.bySubprocess,
        rowsByUserId,
      });
      const elsewhere =
        typeof data.summary.hasAnywhere === 'number' &&
        data.summary.hasAnywhere > data.summary.all + data.summary.some
          ? ` · ${data.summary.hasAnywhere} lo tienen en alguna empresa`
          : '';
      toast.success(
        `Cobertura: ${data.summary.all} con todos · ${data.summary.some} parcial · ${data.summary.none} sin ninguno${elsewhere}`
      );
    } catch (error) {
      console.error('Error checking coverage:', error);
      toast.error(error instanceof Error ? error.message : 'Error al verificar cobertura');
    } finally {
      setBulkCoverageLoading(false);
    }
  };

  const selectUsersByCoverage = (status: 'all' | 'some' | 'none' | 'missingAny' | 'hasAny') => {
    if (!bulkCoverage) {
      toast.error('Primero verifica la cobertura');
      return;
    }
    const matched = Object.entries(bulkCoverage.rowsByUserId)
      .filter(([, row]) => {
        if (status === 'missingAny') return row.status !== 'all';
        if (status === 'hasAny') return row.status !== 'none';
        return row.status === status;
      })
      .map(([userId]) => userId);
    setBulkSelectedUserIds(matched);
  };

  const coverageBadge = (userId: string) => {
    const row = bulkCoverage?.rowsByUserId[userId];
    if (!row) return null;
    if (row.status === 'all') {
      return (
        <Badge color='green' variant='light' size='xs'>
          Tiene todos ({row.hasCount}/{row.totalCount})
        </Badge>
      );
    }
    if (row.status === 'some') {
      return (
        <Badge color='yellow' variant='light' size='xs'>
          Parcial ({row.hasCount}/{row.totalCount})
        </Badge>
      );
    }
    if (row.hasAnywhere) {
      return (
        <Badge color='orange' variant='light' size='xs'>
          En otra empresa
        </Badge>
      );
    }
    return (
      <Badge color='gray' variant='light' size='xs'>
        No tiene (0/{row.totalCount})
      </Badge>
    );
  };

  const handleBulkSave = async () => {
    if (!bulkCompany || bulkCompany === 'all') {
      toast.error('Para agregar o quitar debe seleccionar una empresa concreta');
      return;
    }
    if (bulkSubprocessIds.length === 0) {
      toast.error('Seleccione al menos un subproceso');
      return;
    }
    if (bulkSelectedUserIds.length === 0) {
      toast.error('Seleccione al menos un usuario de la vista previa');
      return;
    }

    try {
      setBulkSaving(true);
      const response = await fetch('/api/users/bulk-subprocesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: parseInt(bulkCompany, 10),
          subprocessIds: bulkSubprocessIds,
          mode: bulkMode,
          userIds: bulkSelectedUserIds,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Error en la asignación masiva');
      }

      const result = await response.json();
      notifySubprocessAssignmentsChanged();
      const actionLabel =
        bulkMode === 'remove'
          ? 'Retiro masivo'
          : bulkMode === 'replace'
            ? 'Reemplazo masivo'
            : 'Asignación masiva';
      toast.success(
        `${actionLabel}: ${result.successCount} usuario(s) OK` +
          (result.failCount ? `, ${result.failCount} con error` : '') +
          (bulkMode === 'remove' && result.totalRemoved
            ? ` · ${result.totalRemoved} asignación(es) quitada(s)`
            : '')
      );
      setBulkModalOpened(false);
      void fetchUsers();
    } catch (error) {
      console.error('Error in bulk assignment:', error);
      toast.error(error instanceof Error ? error.message : 'Error en la asignación masiva');
    } finally {
      setBulkSaving(false);
    }
  };

  const exportToCSV = () => {
    const csvContent = [
      ['ID', 'Nombre', 'Email', 'Rol', 'Estado', 'Fecha de Registro'],
      ...users.map((user) => [
        user.id,
        user.name || '',
        user.email,
        user.role,
        user.isActive ? 'Activo' : 'Inactivo',
        new Date(user.createdAt).toLocaleDateString('es-ES'),
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'usuarios.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (status === 'loading' || (loading && !hasLoadedOnce.current)) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Loader size='lg' />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const breadcrumbItems = [
    { title: 'Process', href: '/process' },
    { title: 'Administration', href: '#' },
    { title: 'Users', href: '#' },
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

  const getRoleColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
      case 'super_user':
      case 'superadmin':
        return 'red';
      case 'user':
        return 'blue';
      default:
        return 'gray';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'Admin';
      case 'super_user':
      case 'superadmin':
        return 'Super admin';
      case 'user':
        return 'Usuario';
      default:
        return role;
    }
  };

  const formatRegisteredAt = (value: string) =>
    new Date(value).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const renderUserActions = (user: User) => (
    <Group gap={2} wrap='nowrap' justify='flex-end'>
      <Tooltip label='Editar usuario' withArrow>
        <ActionIcon
          variant='subtle'
          color='blue'
          size='sm'
          onClick={() => openEditModal(user)}
          aria-label='Editar usuario'
        >
          <IconEdit size={15} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label='Asignar subprocesos' withArrow>
        <ActionIcon
          variant='subtle'
          color='violet'
          size='sm'
          onClick={() => openSubprocessModal(user)}
          aria-label='Asignar subprocesos'
        >
          <IconSettings size={15} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label='SAPSEND por empresa' withArrow>
        <ActionIcon
          variant='subtle'
          color='teal'
          size='sm'
          onClick={() => setSapsendUser(user)}
          aria-label='SAPSEND por empresa'
        >
          <IconDatabase size={15} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label='Desactivar usuario' withArrow>
        <ActionIcon
          variant='subtle'
          color='red'
          size='sm'
          onClick={() => openDeleteModal(user)}
          aria-label='Desactivar usuario'
        >
          <IconTrash size={15} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  return (
    <div style={{ minHeight: '100%', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-4 px-3 sm:py-6 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='md' radius='md' withBorder mb='sm'>
          <Breadcrumbs separator={<IconChevronRight size={14} />} mb='sm'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex
            justify='space-between'
            align={{ base: 'stretch', sm: 'center' }}
            direction={{ base: 'column', sm: 'row' }}
            gap='sm'
          >
            <div style={{ minWidth: 0 }}>
              <Group gap='xs' wrap='nowrap'>
                <ThemeIcon size={32} radius='md' variant='light' color='blue'>
                  <IconUsers size={18} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Title order={2} style={{ fontSize: '1.25rem', lineHeight: 1.3 }}>
                    Administración de Usuarios
                  </Title>
                  <Text size='xs' c='dimmed'>
                    {showLoginAudit
                      ? 'Auditoría de seguridad · intentos de inicio de sesión, IP y país'
                      : `Gestiona accesos, roles y subprocesos · ${pagination.total} usuarios`}
                  </Text>
                </div>
              </Group>
            </div>

            {!showLoginAudit && (
            <Group gap='xs' grow={!!isMobile}>
              <Button
                size='sm'
                leftSection={<IconPlus size={14} />}
                onClick={() => {
                  setSelectedDepartmentIds([]);
                  setCreateModalOpened(true);
                }}
              >
                Crear Usuario
              </Button>
              <Button
                size='sm'
                variant='filled'
                color='violet'
                leftSection={<IconUsersGroup size={14} />}
                onClick={() => void openBulkModal()}
              >
                Asignación masiva
              </Button>
              <Button
                size='sm'
                variant='light'
                leftSection={<IconDownload size={14} />}
                onClick={exportToCSV}
              >
                Exportar CSV
              </Button>
            </Group>
            )}
          </Flex>

          {canViewLoginAudit && (
            <Tabs
              value={view}
              onChange={(value) => setView(value === 'inicios-sesion' ? 'inicios-sesion' : 'usuarios')}
              mt='sm'
            >
              <Tabs.List>
                <Tabs.Tab value='usuarios' leftSection={<IconUsers size={14} />}>
                  Usuarios
                </Tabs.Tab>
                <Tabs.Tab value='inicios-sesion' leftSection={<IconLogin2 size={14} />}>
                  Inicios de sesión
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          )}
        </Card>

        {showLoginAudit ? (
          <LoginAuditPanel />
        ) : (
        <>

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='sm'>
            {error}
          </Alert>
        )}

        <Card shadow='sm' p='md' radius='md' withBorder mb='sm'>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm'>
            <TextInput
              label='Buscar'
              placeholder='Nombre, email o dominio (ej. onelatampharma)'
              description={
                filters.search
                  ? `Buscando en todos los usuarios · ${pagination.total} resultado(s)`
                  : 'La búsqueda aplica a toda la base, no solo a esta página'
              }
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              leftSection={<IconSearch size={14} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.currentTarget.value)}
              size='sm'
            />
            <Select
              label='Rol'
              placeholder='Todos los roles'
              data={[
                { value: '', label: 'Todos' },
                { value: 'admin', label: 'Admin' },
                { value: 'user', label: 'Usuario' },
              ]}
              value={filters.role}
              onChange={(value) => handleFilterChange('role', value || '')}
              size='sm'
              leftSection={<IconShield size={14} />}
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              label='Estado'
              placeholder='Todos los estados'
              data={[
                { value: '', label: 'Todos' },
                { value: 'active', label: 'Activo' },
                { value: 'inactive', label: 'Inactivo' },
              ]}
              value={filters.status}
              onChange={(value) => handleFilterChange('status', value || '')}
              size='sm'
              comboboxProps={{ withinPortal: true }}
            />
          </SimpleGrid>
        </Card>

        <Card
          shadow='sm'
          radius='md'
          withBorder
          p='md'
          style={{ position: 'relative' }}
        >
          {users.length === 0 ? (
            <Stack align='center' gap={6} py='lg'>
              <ThemeIcon size={40} radius='xl' variant='light' color='gray'>
                <IconUsers size={20} />
              </ThemeIcon>
              <Text size='sm' fw={500}>
                No se encontraron usuarios
              </Text>
              <Text size='xs' c='dimmed' ta='center'>
                Prueba ajustando los filtros o crea un nuevo usuario
              </Text>
            </Stack>
          ) : isMobile ? (
            <Stack gap='xs'>
              {users.map((user) => (
                <Card
                  key={user.id}
                  withBorder
                  radius='sm'
                  padding='sm'
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <Group justify='space-between' align='flex-start' wrap='nowrap' gap='xs' mb={6}>
                    <Group gap='xs' wrap='nowrap' style={{ minWidth: 0, flex: 1 }}>
                      <Avatar
                        radius='xl'
                        size={32}
                        color={getAvatarColor(user.id)}
                        variant='light'
                        style={{ flexShrink: 0 }}
                      >
                        {getUserInitials(user.name, user.email)}
                      </Avatar>
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600} size='sm'>
                          {user.name || 'Sin nombre'}
                        </Text>
                        <Text size='xs' c='dimmed' style={{ wordBreak: 'break-all' }}>
                          {user.email}
                        </Text>
                      </div>
                    </Group>
                    {renderUserActions(user)}
                  </Group>
                  <Group gap={6} wrap='wrap'>
                    <Text size='xs' c='dimmed' ff='monospace'>
                      ID {user.id.slice(0, 8)}…
                    </Text>
                    <Badge color={getRoleColor(user.role)} variant='light' size='xs'>
                      {getRoleLabel(user.role)}
                    </Badge>
                    <Badge color={user.isActive ? 'green' : 'red'} variant='light' size='xs'>
                      {user.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                    <Text size='xs' c='dimmed'>
                      {formatRegisteredAt(user.createdAt)}
                    </Text>
                  </Group>
                </Card>
              ))}
            </Stack>
          ) : (
            <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <Table
                striped
                highlightOnHover
                stickyHeader
                verticalSpacing={6}
                horizontalSpacing='sm'
                style={{ minWidth: 860 }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 90 }}>ID</Table.Th>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th style={{ width: 110 }}>Rol</Table.Th>
                    <Table.Th style={{ width: 100 }}>Estado</Table.Th>
                    <Table.Th style={{ width: 120 }}>Registro</Table.Th>
                    <Table.Th style={{ width: 110, textAlign: 'right' }}>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.map((user) => (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Text size='xs' ff='monospace' c='dimmed'>
                          {user.id.slice(0, 8)}…
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={8} wrap='nowrap'>
                          <Avatar
                            radius='xl'
                            size={28}
                            color={getAvatarColor(user.id)}
                            variant='light'
                          >
                            {getUserInitials(user.name, user.email)}
                          </Avatar>
                          <Text size='sm' fw={500}>
                            {user.name || 'Sin nombre'}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' style={{ wordBreak: 'break-word' }}>
                          {user.email}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getRoleColor(user.role)} variant='light' size='sm'>
                          {getRoleLabel(user.role)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={user.isActive ? 'green' : 'red'} variant='light' size='sm'>
                          {user.isActive ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{formatRegisteredAt(user.createdAt)}</Text>
                      </Table.Td>
                      <Table.Td>{renderUserActions(user)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}

          {pagination.pages > 1 && (
            <Flex
              justify='center'
              mt='sm'
              pt='sm'
              style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
            >
              <Pagination
                total={pagination.pages}
                value={pagination.page}
                onChange={(page) => setPagination((prev) => ({ ...prev, page }))}
                size='sm'
                radius='md'
              />
            </Flex>
          )}
        </Card>
        </>
        )}

      {/* Bulk Assignment Modal */}
      <Modal
        opened={bulkModalOpened}
        onClose={() => !bulkSaving && setBulkModalOpened(false)}
        title={
          <Group gap='xs'>
            <IconUsersGroup size={18} />
            <Text fw={600}>Asignación / retiro masivo</Text>
          </Group>
        }
        size='xl'
        fullScreen={!!isMobile}
      >
        <Stack gap='sm'>
          <Alert color='blue' variant='light' icon={<IconAlertCircle size={16} />}>
            Filtra por dominio de correo (ej. <strong>onelatampharma</strong>) o pega una lista de
            emails. Luego elige empresa, subprocesos y <strong>agrega</strong> o{' '}
            <strong>quita</strong> módulos de forma masiva.
          </Alert>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            <TextInput
              label='Dominio de correo'
              placeholder='onelatampharma o @onelatampharma.com'
              description='Coincide con cualquier email que contenga ese texto'
              value={bulkEmailDomain}
              onChange={(e) => setBulkEmailDomain(e.currentTarget.value)}
              size='sm'
            />
            <Textarea
              label='Lista de correos (opcional)'
              placeholder={'user1@empresa.com\nuser2@empresa.com'}
              description='Separados por coma, espacio o salto de línea'
              value={bulkEmailsText}
              onChange={(e) => setBulkEmailsText(e.currentTarget.value)}
              minRows={2}
              autosize
              maxRows={4}
              size='sm'
            />
          </SimpleGrid>

          <Group>
            <Button
              size='sm'
              variant='light'
              leftSection={<IconSearch size={14} />}
              loading={bulkPreviewLoading}
              onClick={() => void handleBulkPreview()}
            >
              Vista previa de usuarios
            </Button>
            {bulkPreviewUsers.length > 0 && (
              <Badge variant='light' color='violet'>
                {bulkSelectedUserIds.length} / {bulkPreviewUsers.length} seleccionados
              </Badge>
            )}
          </Group>

          {bulkTruncated && (
            <Alert color='yellow' variant='light'>
              Se limitó la vista previa a 500 usuarios. Afina el dominio si necesitas un grupo más
              preciso.
            </Alert>
          )}

          {bulkPreviewUsers.length > 0 && (
            <Card withBorder padding='sm' radius='md'>
              <Group justify='space-between' mb='xs'>
                <Text size='sm' fw={600}>
                  Usuarios coincidentes
                </Text>
                <Group gap='xs'>
                  <Button
                    size='compact-xs'
                    variant='subtle'
                    onClick={() => setBulkSelectedUserIds(bulkPreviewUsers.map((u) => u.id))}
                  >
                    Todos
                  </Button>
                  <Button
                    size='compact-xs'
                    variant='subtle'
                    color='gray'
                    onClick={() => setBulkSelectedUserIds([])}
                  >
                    Ninguno
                  </Button>
                </Group>
              </Group>
              <ScrollArea.Autosize mah={180}>
                <Stack gap={4}>
                  {bulkPreviewUsers.map((user) => (
                    <Group key={user.id} justify='space-between' wrap='nowrap' gap='xs' align='flex-start'>
                      <Checkbox
                        size='sm'
                        style={{ flex: 1, minWidth: 0 }}
                        checked={bulkSelectedUserIds.includes(user.id)}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          setBulkCoverage(null);
                          setBulkSelectedUserIds((prev) =>
                            checked ? [...prev, user.id] : prev.filter((id) => id !== user.id)
                          );
                        }}
                        label={
                          <Text size='xs'>
                            <Text span fw={600}>
                              {user.name || 'Sin nombre'}
                            </Text>{' '}
                            · {user.email}
                          </Text>
                        }
                      />
                      {bulkCoverage?.rowsByUserId[user.id] && (
                        <Tooltip
                          multiline
                          w={300}
                          withArrow
                          label={
                            <Stack gap={4}>
                              <Text size='xs'>
                                Tiene aquí:{' '}
                                {bulkCoverage.rowsByUserId[user.id].presentNames.join(', ') || '—'}
                              </Text>
                              <Text size='xs'>
                                Falta:{' '}
                                {bulkCoverage.rowsByUserId[user.id].missingNames.join(', ') || '—'}
                              </Text>
                              {(bulkCoverage.rowsByUserId[user.id].presentElsewhereNames?.length ??
                                0) > 0 && (
                                <Text size='xs'>
                                  En otras empresas:{' '}
                                  {bulkCoverage.rowsByUserId[user.id].presentElsewhereNames?.join(
                                    ', '
                                  )}
                                </Text>
                              )}
                              {(bulkCoverage.rowsByUserId[user.id].companies?.length ?? 0) > 0 && (
                                <Text size='xs'>
                                  Empresas:{' '}
                                  {bulkCoverage.rowsByUserId[user.id].companies?.join(', ')}
                                </Text>
                              )}
                            </Stack>
                          }
                        >
                          <span>{coverageBadge(user.id)}</span>
                        </Tooltip>
                      )}
                    </Group>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Card>
          )}

          <Select
            label='Empresa'
            placeholder='Seleccione una empresa'
            description='Para consultar cobertura puedes usar “Todas las empresas”. Para agregar/quitar sí debes elegir una empresa concreta.'
            data={[
              { value: 'all', label: 'Todas las empresas (solo consulta)' },
              ...companies.map((c) => ({ value: c.id.toString(), label: c.name })),
            ]}
            value={bulkCompany}
            onChange={(value) => {
              setBulkCompany(value || '');
              setBulkCoverage(null);
            }}
            required
            size='sm'
            comboboxProps={{ withinPortal: true }}
          />

          <div>
            <Text size='sm' fw={500} mb={4}>
              Acción
            </Text>
            <SegmentedControl
              fullWidth
              size='sm'
              value={bulkMode}
              onChange={(value) => setBulkMode(value as 'add' | 'replace' | 'remove')}
              data={[
                { label: 'Agregar', value: 'add' },
                { label: 'Quitar', value: 'remove' },
                { label: 'Reemplazar', value: 'replace' },
              ]}
            />
            <Text size='xs' c='dimmed' mt={4}>
              {bulkMode === 'add'
                ? 'Suma los subprocesos elegidos sin quitar los que ya tengan en esa empresa.'
                : bulkMode === 'remove'
                  ? 'Quita solo los subprocesos seleccionados de esa empresa; conserva el resto.'
                  : 'Deja únicamente los subprocesos seleccionados (quita los demás de esa empresa).'}
            </Text>
          </div>

          <TextInput
            label='Filtrar subprocesos'
            placeholder='Buscar módulo o subproceso'
            leftSection={<IconSearch size={14} />}
            value={bulkSubprocessSearch}
            onChange={(e) => setBulkSubprocessSearch(e.currentTarget.value)}
            size='sm'
          />

          <Group gap='xs'>
            <Button
              size='compact-xs'
              variant='light'
              onClick={() => {
                setBulkSubprocessIds(getBulkFilteredSubprocesses().map((s) => s.id_subprocess));
                setBulkCoverage(null);
              }}
            >
              Seleccionar filtrados
            </Button>
            <Button
              size='compact-xs'
              variant='subtle'
              color='gray'
              onClick={() => {
                setBulkSubprocessIds([]);
                setBulkCoverage(null);
              }}
            >
              Limpiar
            </Button>
            <Badge variant='light' size='sm'>
              {bulkSubprocessIds.length} subproceso(s)
            </Badge>
          </Group>

          <ScrollArea.Autosize mah={180}>
            <Stack gap={4}>
              {getBulkFilteredSubprocesses().map((subprocess) => (
                <Checkbox
                  key={subprocess.id_subprocess}
                  size='sm'
                  checked={bulkSubprocessIds.includes(subprocess.id_subprocess)}
                  onChange={() => {
                    setBulkCoverage(null);
                    setBulkSubprocessIds((prev) =>
                      prev.includes(subprocess.id_subprocess)
                        ? prev.filter((id) => id !== subprocess.id_subprocess)
                        : [...prev, subprocess.id_subprocess]
                    );
                  }}
                  label={
                    <Text size='xs'>
                      <Text span fw={600}>
                        {subprocess.subprocess}
                      </Text>{' '}
                      <Text span c='dimmed'>
                        · {subprocess.process.process}
                      </Text>
                    </Text>
                  }
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>

          <Group>
            <Button
              size='sm'
              variant='light'
              color='teal'
              leftSection={<IconSearch size={14} />}
              loading={bulkCoverageLoading}
              onClick={() => void handleBulkCheckCoverage()}
              disabled={
                bulkSelectedUserIds.length === 0 ||
                bulkSubprocessIds.length === 0 ||
                !bulkCompany
              }
            >
              Ver quién ya los tiene
            </Button>
          </Group>

          {bulkCoverage && (
            <Card withBorder padding='sm' radius='md'>
              <Text size='sm' fw={600} mb={6}>
                Cobertura
                {bulkCoverage.summary.scope === 'all'
                  ? ' (todas las empresas)'
                  : bulkCoverage.summary.companyName
                    ? ` en ${bulkCoverage.summary.companyName}`
                    : ''}
              </Text>
              <Group gap='xs' mb='sm' wrap='wrap'>
                <Badge color='green' variant='filled'>
                  Todos: {bulkCoverage.summary.all}
                </Badge>
                <Badge color='yellow' variant='filled'>
                  Parcial: {bulkCoverage.summary.some}
                </Badge>
                <Badge color='gray' variant='filled'>
                  Ninguno: {bulkCoverage.summary.none}
                </Badge>
                {typeof bulkCoverage.summary.hasAnywhere === 'number' && (
                  <Badge color='teal' variant='light'>
                    En alguna empresa: {bulkCoverage.summary.hasAnywhere}
                  </Badge>
                )}
              </Group>

              {bulkCoverage.summary.scope === 'company' &&
                (bulkCoverage.summary.hasAnywhere ?? 0) >
                  bulkCoverage.summary.all + bulkCoverage.summary.some && (
                  <Alert color='orange' variant='light' mb='sm'>
                    Hay usuarios que <strong>sí tienen</strong> estos módulos, pero en{' '}
                    <strong>otra empresa</strong>. Usa “Todas las empresas” para verlos, o cambia
                    la empresa.
                  </Alert>
                )}

              <Group gap={6} mb='sm' wrap='wrap'>
                <Button
                  size='compact-xs'
                  variant='light'
                  color='gray'
                  onClick={() => selectUsersByCoverage('none')}
                >
                  Seleccionar sin módulos
                </Button>
                <Button
                  size='compact-xs'
                  variant='light'
                  color='yellow'
                  onClick={() => selectUsersByCoverage('missingAny')}
                >
                  Seleccionar a quienes les falta
                </Button>
                <Button
                  size='compact-xs'
                  variant='light'
                  color='green'
                  onClick={() => selectUsersByCoverage('hasAny')}
                >
                  Seleccionar quienes sí tienen
                </Button>
                <Button
                  size='compact-xs'
                  variant='light'
                  color='teal'
                  onClick={() => selectUsersByCoverage('all')}
                >
                  Seleccionar con todos
                </Button>
              </Group>

              <Text size='xs' fw={600} mb={4}>
                Por módulo
              </Text>
              <Stack gap={4} mb='sm'>
                {bulkCoverage.bySubprocess.map((sub) => (
                  <Group key={sub.id} justify='space-between' wrap='nowrap' gap='xs'>
                    <Text size='xs' lineClamp={1} style={{ minWidth: 0, flex: 1 }}>
                      {sub.name}
                      <Text span c='dimmed'>
                        {' '}
                        · {sub.processName}
                      </Text>
                    </Text>
                    <Group gap={4} wrap='nowrap' style={{ flexShrink: 0 }}>
                      <Badge size='xs' color='green' variant='light'>
                        {sub.withCount} sí
                      </Badge>
                      <Badge size='xs' color='gray' variant='light'>
                        {sub.withoutCount} no
                      </Badge>
                      {typeof sub.withAnywhereCount === 'number' &&
                        sub.withAnywhereCount !== sub.withCount && (
                          <Badge size='xs' color='orange' variant='light'>
                            {sub.withAnywhereCount} en total
                          </Badge>
                        )}
                    </Group>
                  </Group>
                ))}
              </Stack>

              <Text size='xs' c='dimmed'>
                Hover en el badge de cada usuario para ver detalle y en qué empresas lo tiene.
              </Text>
            </Card>
          )}

          <Group justify='flex-end' mt='xs'>
            <Button
              variant='default'
              size='sm'
              disabled={bulkSaving}
              onClick={() => setBulkModalOpened(false)}
            >
              Cancelar
            </Button>
            <Button
              size='sm'
              color={bulkMode === 'remove' ? 'red' : 'violet'}
              loading={bulkSaving}
              leftSection={
                bulkMode === 'remove' ? <IconTrash size={14} /> : <IconUsersGroup size={14} />
              }
              onClick={() => void handleBulkSave()}
              disabled={
                bulkSelectedUserIds.length === 0 ||
                bulkSubprocessIds.length === 0 ||
                !bulkCompany ||
                bulkCompany === 'all'
              }
            >
              {bulkMode === 'remove'
                ? `Quitar de ${bulkSelectedUserIds.length || 0} usuario(s)`
                : bulkMode === 'replace'
                  ? `Reemplazar en ${bulkSelectedUserIds.length || 0} usuario(s)`
                  : `Asignar a ${bulkSelectedUserIds.length || 0} usuario(s)`}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Create User Modal */}
      <Modal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        title='Crear Nuevo Usuario'
        size='lg'
      >
        <Stack>
          <TextInput
            label='Nombre completo'
            placeholder='Ingrese el nombre completo'
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <TextInput
            label='Email'
            type='email'
            placeholder='usuario@empresa.com'
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
          <TextInput
            label='Contraseña'
            type='password'
            placeholder='Mínimo 8 caracteres'
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
          />
          <Select
            label='Rol'
            placeholder='Seleccione el rol'
            data={[
              { value: 'user', label: 'Usuario' },
              { value: 'admin', label: 'Admin' },
            ]}
            value={formData.role}
            onChange={(value) => setFormData({ ...formData, role: value || 'user' })}
          />
          <TextInput
            label='Teléfono'
            placeholder='Ej: +57 300 123 4567'
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
          <TextInput
            label='Identificación'
            placeholder='Número de documento'
            value={formData.identification}
            onChange={(e) => setFormData({ ...formData, identification: e.target.value })}
          />
          <MultiSelect
            label='Departamentos'
            placeholder='Seleccione uno o más departamentos'
            data={departmentOptions}
            value={selectedDepartmentIds}
            onChange={setSelectedDepartmentIds}
            searchable
            clearable
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setCreateModalOpened(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateUser} loading={formLoading}>
              Crear Usuario
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        opened={editModalOpened}
        onClose={() => setEditModalOpened(false)}
        title='Editar Usuario'
        size='lg'
      >
        <Stack>
          <TextInput
            label='Nombre completo'
            placeholder='Ingrese el nombre completo'
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <TextInput
            label='Email'
            type='email'
            placeholder='usuario@empresa.com'
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
          <TextInput
            label='Nueva contraseña (opcional)'
            type='password'
            placeholder='Dejar vacío para mantener la actual'
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
          <Select
            label='Rol'
            placeholder='Seleccione el rol'
            data={[
              { value: 'user', label: 'Usuario' },
              { value: 'admin', label: 'Admin' },
            ]}
            value={formData.role}
            onChange={(value) => setFormData({ ...formData, role: value || 'user' })}
          />
          <Select
            label='Estado'
            placeholder='Seleccione el estado'
            data={[
              { value: 'true', label: 'Activo' },
              { value: 'false', label: 'Inactivo' },
            ]}
            value={formData.isActive.toString()}
            onChange={(value) => setFormData({ ...formData, isActive: value === 'true' })}
          />
          <TextInput
            label='Teléfono'
            placeholder='Ej: +57 300 123 4567'
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
          <TextInput
            label='Identificación'
            placeholder='Número de documento'
            value={formData.identification}
            onChange={(e) => setFormData({ ...formData, identification: e.target.value })}
          />
          <MultiSelect
            label='Departamentos'
            placeholder='Seleccione uno o más departamentos'
            data={departmentOptions}
            value={selectedDepartmentIds}
            onChange={setSelectedDepartmentIds}
            searchable
            clearable
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setEditModalOpened(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEditUser} loading={formLoading}>
              Actualizar Usuario
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteModalOpened}
        onClose={() => setDeleteModalOpened(false)}
        title='Confirmar Desactivación'
        size='md'
      >
        <Stack>
          <p>
            ¿Estás seguro de que deseas desactivar la cuenta de{' '}
            <strong>{selectedUser?.name || selectedUser?.email}</strong>?
          </p>
          <p className='text-sm text-gray-600'>
            La cuenta será desactivada pero no eliminada permanentemente. El usuario no podrá
            acceder al sistema.
          </p>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setDeleteModalOpened(false)}>
              Cancelar
            </Button>
            <Button color='red' onClick={handleDeleteUser} loading={formLoading}>
              Desactivar Usuario
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Subprocess Assignment Modal — estilo Orion/iOS: Procesos → Empresas */}
      <Modal
        opened={subprocessModalOpened}
        onClose={() => setSubprocessModalOpened(false)}
        size='xl'
        radius='lg'
        title={
          <Group gap='sm' wrap='nowrap'>
            <ThemeIcon variant='light' size={40} radius='md'>
              <IconLayoutGrid size={22} />
            </ThemeIcon>
            <div>
              <Text fw={600}>
                Subprocesos — {selectedUser?.name || selectedUser?.email || 'usuario'}
              </Text>
              <Text size='sm' c='dimmed'>
                Primero los subprocesos, luego en qué empresas aplican. Toque una tarjeta para
                activarla.
              </Text>
            </div>
          </Group>
        }
      >
        {subprocessLoading ? (
          <div className='flex justify-center py-8'>
            <Loader size='lg' />
          </div>
        ) : companies.length === 0 ? (
          <Alert color='yellow' variant='light'>
            No hay empresas disponibles. Asegúrese de que el usuario esté asociado a al menos una
            empresa.
          </Alert>
        ) : (
          <Stack gap='lg'>
            {selectedSubprocessIds.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py={4}>
                Este usuario aún no tiene subprocesos. Toque una tarjeta para activarlo.
              </Text>
            ) : (
              <Group justify='space-between' align='center' wrap='wrap' gap='xs'>
                <Group gap={6}>
                  <Badge variant='light' radius='xl' size='lg' style={{ fontWeight: 500 }}>
                    {selectedSubprocessIds.length} subproceso
                    {selectedSubprocessIds.length === 1 ? '' : 's'}
                  </Badge>
                  {selectedCompanyIds.length > 0 && (
                    <Badge variant='dot' radius='xl' size='lg' color='gray'>
                      {selectedCompanyIds
                        .map((id) => companies.find((c) => c.id.toString() === id)?.name ?? id)
                        .join(', ')}
                    </Badge>
                  )}
                  {multiCompany && selectedCompanyIds.length > 1 && (
                    <Text size='xs' c='dimmed'>
                      multiempresa
                    </Text>
                  )}
                </Group>
                <Button
                  size='compact-sm'
                  variant={confirmClear === 'quitar' ? 'filled' : 'subtle'}
                  color='red'
                  radius='xl'
                  onClick={() =>
                    // Quita todos los subprocesos de las empresas marcadas (al guardar).
                    confirmThenClear('quitar', () => changeSubprocesses([], selectedSubprocessIds))
                  }
                >
                  {confirmClear === 'quitar' ? '¿Seguro? Toque otra vez' : 'Quitar todos'}
                </Button>
              </Group>
            )}

            <SegmentedControl
              fullWidth
              radius='xl'
              size='sm'
              value={subprocessModalTab}
              onChange={(v) => setSubprocessModalTab(v === 'empresas' ? 'empresas' : 'procesos')}
              data={[
                {
                  value: 'procesos',
                  label: `Subprocesos${selectedSubprocessIds.length ? ` · ${selectedSubprocessIds.length}` : ''}`,
                },
                {
                  value: 'empresas',
                  label: `Empresas${selectedCompanyIds.length ? ` · ${selectedCompanyIds.length}` : ''}`,
                },
              ]}
            />

            {subprocessModalTab === 'procesos' ? (
              <Stack gap='sm'>
                {/* Modo «Una»: elegir qué empresa se edita sin cambiar de pestaña. */}
                {!multiCompany && (
                  <Select
                    label='Empresa que está editando'
                    placeholder='Elija una empresa'
                    size='sm'
                    radius='xl'
                    value={selectedCompanyIds[0] ?? null}
                    data={companies.map((c) => {
                      const id = c.id.toString();
                      const count = getCompanySubprocessIds(id).length;
                      return {
                        value: id,
                        label: `${c.name}${count > 0 ? ` (${count})` : ''}`,
                      };
                    })}
                    onChange={(value) => handleCompanyIdsChange(value ? [value] : [])}
                    leftSection={<IconBuilding size={16} />}
                    comboboxProps={{ withinPortal: true }}
                    allowDeselect={false}
                  />
                )}
                <Group gap='xs' wrap='nowrap'>
                  <TextInput
                    style={{ flex: 1 }}
                    placeholder='Buscar'
                    leftSection={<IconSearch size={16} />}
                    value={subprocessSearch}
                    onChange={(e) => setSubprocessSearch(e.target.value)}
                    aria-label='Buscar subprocesos'
                    radius='xl'
                    variant='filled'
                  />
                  <Button
                    radius='xl'
                    size='sm'
                    variant={assignedSnapshot ? 'filled' : 'light'}
                    leftSection={<IconListCheck size={16} />}
                    onClick={() =>
                      setAssignedSnapshot((prev) => (prev ? null : [...selectedSubprocessIds]))
                    }
                    aria-pressed={Boolean(assignedSnapshot)}
                  >
                    {assignedSnapshot
                      ? 'Ver todos'
                      : `Ver asignados · ${selectedSubprocessIds.length}`}
                  </Button>
                </Group>
                <Group gap={6} wrap='wrap'>
                  {(
                    [
                      ['firma', 'Firma'],
                      ['solicitudes', 'Solicitudes'],
                      ['admin', 'Admin'],
                      ['todos', 'Todos'],
                      ['ninguno', 'Ninguno'],
                    ] as const
                  ).map(([kind, label]) => {
                    const active = kind !== 'ninguno' && isPresetActive(kind);
                    return (
                      <Button
                        key={kind}
                        size='compact-sm'
                        radius='xl'
                        variant={
                          kind === 'ninguno'
                            ? confirmClear === 'ninguno'
                              ? 'filled'
                              : 'subtle'
                            : active
                              ? 'filled'
                              : 'light'
                        }
                        color={
                          kind === 'ninguno'
                            ? confirmClear === 'ninguno'
                              ? 'red'
                              : 'gray'
                            : undefined
                        }
                        leftSection={active ? <IconCheck size={12} /> : null}
                        onClick={() => applySubprocessPreset(kind)}
                      >
                        {kind === 'ninguno' && confirmClear === 'ninguno'
                          ? '¿Quitar todos? Toque otra vez'
                          : label}
                      </Button>
                    );
                  })}
                  {assignedSubprocesses.some((a) => a.subprocesses.length > 0) && (
                    <Select
                      placeholder='Desde empresa…'
                      clearable
                      searchable
                      size='xs'
                      radius='xl'
                      w={180}
                      value={null}
                      data={assignedSubprocesses
                        .filter((a) => a.subprocesses.length > 0)
                        .map((a) => ({
                          value: a.companyId.toString(),
                          label: `${a.companyName} (${a.subprocesses.length})`,
                        }))}
                      onChange={(value) => {
                        if (value) handleLoadSubprocessesFromCompany(value);
                      }}
                      comboboxProps={{ withinPortal: true }}
                    />
                  )}
                </Group>

                <ScrollArea.Autosize mah={360} offsetScrollbars type='hover'>
                  {getFilteredSubprocesses().length === 0 ? (
                    <Text size='sm' c='dimmed' ta='center' py='xl'>
                      {assignedSnapshot && !subprocessSearch
                        ? 'Este usuario no tiene subprocesos asignados todavía.'
                        : 'Sin resultados'}
                    </Text>
                  ) : (
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={10}>
                      {getFilteredSubprocesses().map((subprocess) => {
                        const checked = selectedSubprocessIds.includes(subprocess.id_subprocess);
                        // Con varias empresas: avisar si hoy solo lo tiene en algunas.
                        const partialIn = isPartialSubprocess(subprocess.id_subprocess)
                          ? selectedCompanyIds
                              .filter((id) =>
                                getCompanySubprocessIds(id).includes(subprocess.id_subprocess)
                              )
                              .map(
                                (id) => companies.find((c) => c.id.toString() === id)?.name ?? id
                              )
                          : null;
                        const hint = partialIn
                          ? `Solo en ${partialIn.join(', ')} · tóquelo para darlo en todas`
                          : getSubprocessHint(subprocess) || subprocess.process.process;
                        return (
                          <UnstyledButton
                            key={subprocess.id_subprocess}
                            component='div'
                            role='button'
                            tabIndex={0}
                            onClick={() => handleSubprocessToggle(subprocess.id_subprocess)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSubprocessToggle(subprocess.id_subprocess);
                              }
                            }}
                            aria-pressed={checked}
                            style={{
                              border: checked
                                ? '1.5px solid var(--mantine-primary-color-filled)'
                                : '1px solid transparent',
                              background: checked
                                ? 'color-mix(in srgb, var(--mantine-primary-color-filled) 14%, transparent)'
                                : 'var(--mantine-color-default)',
                              borderRadius: 16,
                              padding: '14px 14px',
                              textAlign: 'left',
                              height: '100%',
                              transition: 'background 120ms ease, border-color 120ms ease',
                            }}
                          >
                            <Group gap={12} wrap='nowrap' align='flex-start'>
                              <Box
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  display: 'grid',
                                  placeItems: 'center',
                                  flexShrink: 0,
                                  background: checked
                                    ? 'var(--mantine-primary-color-filled)'
                                    : 'color-mix(in srgb, var(--mantine-color-dimmed) 16%, transparent)',
                                  color: checked
                                    ? 'var(--mantine-color-white)'
                                    : 'var(--mantine-color-dimmed)',
                                }}
                              >
                                <IconLayoutGrid size={18} />
                              </Box>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Group justify='space-between' gap={8} wrap='nowrap'>
                                  <Text size='sm' fw={600} lineClamp={1}>
                                    {subprocess.subprocess}
                                  </Text>
                                  <Box
                                    style={{
                                      width: 20,
                                      height: 20,
                                      borderRadius: 999,
                                      flexShrink: 0,
                                      display: 'grid',
                                      placeItems: 'center',
                                      // A medias (solo en algunas empresas): borde de color y guion.
                                      border: partialIn
                                        ? '1.5px solid var(--mantine-primary-color-filled)'
                                        : checked
                                          ? 'none'
                                          : '1.5px solid var(--mantine-color-dimmed)',
                                      background:
                                        checked && !partialIn
                                          ? 'var(--mantine-primary-color-filled)'
                                          : 'transparent',
                                      color: partialIn
                                        ? 'var(--mantine-primary-color-filled)'
                                        : 'var(--mantine-color-white)',
                                    }}
                                    aria-label={partialIn ? 'Solo en algunas empresas' : undefined}
                                  >
                                    {partialIn ? (
                                      <IconMinus size={12} stroke={3} />
                                    ) : checked ? (
                                      <IconCheck size={12} stroke={3} />
                                    ) : null}
                                  </Box>
                                </Group>
                                <Text size='xs' c='dimmed' lineClamp={2} mt={3}>
                                  {hint}
                                </Text>
                                {subprocess.id_subprocess === authSubprocessId && checked && (
                                  <Button
                                    size='compact-xs'
                                    variant='light'
                                    radius='xl'
                                    mt={8}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAuthTypeModalOpened(true);
                                    }}
                                  >
                                    Tipos de autorización
                                    {selectedAuthorizationTypeIds.length > 0 &&
                                      ` (${selectedAuthorizationTypeIds.length})`}
                                  </Button>
                                )}
                              </div>
                            </Group>
                          </UnstyledButton>
                        );
                      })}
                    </SimpleGrid>
                  )}
                </ScrollArea.Autosize>
              </Stack>
            ) : (
              <Stack gap='md'>
                <Paper
                  radius={16}
                  p='md'
                  style={{
                    background: 'var(--mantine-color-default)',
                    border: 'none',
                  }}
                >
                  <Group justify='space-between' align='center' gap='md' wrap='wrap'>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <Text size='sm' fw={600}>
                        Multiempresa
                      </Text>
                      <Text size='xs' c='dimmed' mt={2}>
                        {multiCompany
                          ? 'Varias: lo que marque o desmarque se aplica en todas las marcadas; cada una conserva lo demás.'
                          : 'Una: lo que marque o desmarque se aplica solo en esa empresa.'}
                      </Text>
                    </div>
                    <SegmentedControl
                      size='xs'
                      radius='xl'
                      value={multiCompany ? 'multi' : 'una'}
                      onChange={(v) => handleSetMultiCompany(v === 'multi')}
                      data={[
                        { value: 'una', label: 'Una' },
                        { value: 'multi', label: 'Varias' },
                      ]}
                    />
                  </Group>

                  <Text size='xs' c='dimmed' mt='md' mb={8}>
                    {multiCompany ? 'Empresas' : 'Empresa'}
                  </Text>
                  <Group gap={8}>
                    {companies.map((c) => {
                      const active = selectedCompanyIds.includes(c.id.toString());
                      const count = getCompanySubprocessIds(c.id.toString()).length;
                      return (
                        <UnstyledButton
                          key={c.id}
                          onClick={() => handleToggleCompany(c.id.toString())}
                          aria-pressed={active}
                          style={{
                            border: active
                              ? '1.5px solid var(--mantine-primary-color-filled)'
                              : '1px solid transparent',
                            background: active
                              ? 'color-mix(in srgb, var(--mantine-primary-color-filled) 16%, transparent)'
                              : 'color-mix(in srgb, var(--mantine-color-dimmed) 10%, transparent)',
                            borderRadius: 999,
                            padding: '8px 14px',
                            transition: 'background 120ms ease, border-color 120ms ease',
                          }}
                        >
                          <Group gap={6} wrap='nowrap'>
                            <IconBuilding size={14} />
                            <Text size='sm' fw={active ? 600 : 400}>
                              {count > 0 ? `${c.name} (${count})` : c.name}
                            </Text>
                            {active && <IconCheck size={14} />}
                          </Group>
                        </UnstyledButton>
                      );
                    })}
                  </Group>
                  <Group gap={6} mt='sm'>
                    {multiCompany && (
                      <>
                        <Button
                          size='compact-xs'
                          variant='subtle'
                          radius='xl'
                          onClick={() => {
                            handleSetMultiCompany(true);
                            handleCompanyIdsChange(
                              assignedSubprocesses
                                .filter((a) => a.subprocesses.length > 0)
                                .map((a) => a.companyId.toString())
                            );
                          }}
                        >
                          Las que ya tiene
                        </Button>
                        <Button
                          size='compact-xs'
                          variant='subtle'
                          radius='xl'
                          onClick={() =>
                            handleCompanyIdsChange(companies.map((c) => c.id.toString()))
                          }
                        >
                          Todas
                        </Button>
                      </>
                    )}
                    <Button
                      size='compact-xs'
                      variant='subtle'
                      color='gray'
                      radius='xl'
                      onClick={() => handleCompanyIdsChange([])}
                    >
                      Ninguna
                    </Button>
                  </Group>
                </Paper>

                {getOtherCompanyAssignments().length > 0 && (
                  <Text size='xs' c='dimmed'>
                    Sin marcar (no se modifican):{' '}
                    {getOtherCompanyAssignments()
                      .map((a) => `${a.companyName} (${a.subprocesses.length})`)
                      .join(', ')}
                    .
                  </Text>
                )}

                {selectedCompanyIds.length > 0 && getCompanyChanges().length > 0 && (
                  <Alert
                    variant='light'
                    radius='md'
                    color={getCompanyChanges().some((c) => c.loses > 0) ? 'yellow' : 'blue'}
                    icon={<IconAlertCircle size={18} />}
                    title='Al guardar'
                  >
                    <Stack gap={2}>
                      {getCompanyChanges().map((c) => (
                        <Text key={c.id} size='sm'>
                          <strong>{c.name}</strong>
                          {c.gains > 0 ? ` · gana ${c.gains}` : ''}
                          {c.loses > 0 ? ` · pierde ${c.loses}` : ''}
                        </Text>
                      ))}
                    </Stack>
                  </Alert>
                )}

                <Text
                  size='xs'
                  c={selectedCompanyIds.length === 0 ? 'orange' : 'dimmed'}
                  ta='center'
                >
                  {selectedCompanyIds.length === 0
                    ? 'Elija al menos una empresa'
                    : selectedSubprocessIds.length === 0
                      ? 'Sin subprocesos en la pestaña Subprocesos'
                      : `${selectedSubprocessIds.length} subproceso(s) → ${selectedCompanyIds
                          .map((id) => companies.find((c) => c.id.toString() === id)?.name ?? id)
                          .join(', ')}`}
                </Text>
              </Stack>
            )}

            <Group
              justify='space-between'
              align='center'
              pt='xs'
              style={{
                borderTop:
                  '1px solid color-mix(in srgb, var(--mantine-color-dimmed) 18%, transparent)',
              }}
            >
              {/* Visible en ambas pestañas: avisa qué empresa perdería subprocesos al guardar. */}
              <Text
                size='xs'
                c={
                  getCompanyChanges().some((c) => c.loses > 0)
                    ? 'orange'
                    : selectedCompanyIds.length === 0
                      ? 'orange'
                      : 'dimmed'
                }
              >
                {selectedCompanyIds.length === 0
                  ? 'Falta la empresa'
                  : getCompanyChanges().some((c) => c.loses > 0)
                    ? `Al guardar pierde: ${getCompanyChanges()
                        .filter((c) => c.loses > 0)
                        .map((c) => `${c.name} (${c.loses})`)
                        .join(', ')}`
                    : getCompanyChanges().length > 0
                      ? 'Cambios sin guardar'
                      : selectedSubprocessIds.length === 0
                        ? 'Sin acceso aún'
                        : 'Al día'}
              </Text>
              <Group gap='xs'>
                <Button
                  variant='subtle'
                  color='gray'
                  radius='xl'
                  onClick={() => setSubprocessModalOpened(false)}
                >
                  Cancelar
                </Button>
                <Button
                  radius='xl'
                  onClick={handleSaveSubprocesses}
                  loading={subprocessLoading}
                  disabled={selectedCompanyIds.length === 0}
                >
                  {getCompanyChanges().length > 1
                    ? `Guardar en ${getCompanyChanges().length} empresas`
                    : 'Guardar'}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Authorization Types Submodal */}
      <Modal
        opened={authTypeModalOpened}
        onClose={() => setAuthTypeModalOpened(false)}
        title='Tipos de autorización'
        size='md'
        zIndex={1000}
      >
        <Stack>
          <p className='text-sm text-gray-600'>
            El subproceso <strong>Autorización</strong> requiere al menos un tipo de autorización.
            Seleccione uno o más.
          </p>
          <MultiSelect
            label='Tipos de autorización'
            placeholder='Seleccione uno o más tipos'
            data={authorizationTypeOptions}
            value={selectedAuthorizationTypeIds}
            onChange={setSelectedAuthorizationTypeIds}
            searchable
            clearable
            comboboxProps={{ withinPortal: true, zIndex: 1100 }}
          />
          <Group justify='flex-end'>
            <Button onClick={() => setAuthTypeModalOpened(false)}>Aceptar</Button>
          </Group>
        </Stack>
      </Modal>

      <SapsendMappingModal
        opened={sapsendUser !== null}
        onClose={() => setSapsendUser(null)}
        userId={sapsendUser?.id ?? null}
        userName={sapsendUser?.name ?? sapsendUser?.email}
      />
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen flex items-center justify-center'>
          <Loader size='lg' />
        </div>
      }
    >
      <UserManagement />
    </Suspense>
  );
}
