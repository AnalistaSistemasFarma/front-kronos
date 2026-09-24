'use client';

import { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
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
  IconCheck,
  IconX,
  IconUsers,
  IconShield,
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
import { isValentineWallSubprocess } from '@/lib/valentine/constants';

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

function UserManagement() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 768px)', true);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [assignedSubprocesses, setAssignedSubprocesses] = useState<AssignedSubprocess[]>([]);
  const [selectedSubprocessIds, setSelectedSubprocessIds] = useState<number[]>([]);
  const [subprocessSearch, setSubprocessSearch] = useState('');
  const [subprocessLoading, setSubprocessLoading] = useState(false);

  // Authorization types states (submodal shown when the "Autorización" subprocess is assigned)
  const [authTypeModalOpened, setAuthTypeModalOpened] = useState(false);
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

  // Debounce del buscador (igual que help-desk): no fetch en cada tecla
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim();
      setFilters((prev) => {
        if (prev.search === next) return prev;
        return { ...prev, search: next };
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const prevSearchRef = useRef(filters.search);
  useEffect(() => {
    if (prevSearchRef.current === filters.search) return;
    prevSearchRef.current = filters.search;
    setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [filters.search]);

  const fetchUsers = useCallback(async () => {
    try {
      if (hasLoadedOnce.current) setRefreshing(true);
      else setLoading(true);

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
      setRefreshing(false);
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
    setSelectedCompany('');
    setSelectedSubprocessIds([]);
    setSubprocessSearch('');
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

        if (assigned.length > 0) {
          const defaultCompany = assigned[0];
          setSelectedCompany(defaultCompany.companyId.toString());
          setSelectedSubprocessIds(
            defaultCompany.subprocesses.map((s: { subprocessId: number }) => s.subprocessId)
          );
        } else if (companiesData.length > 0) {
          setSelectedCompany(companiesData[0].id.toString());
        }
      } else if (companiesData.length > 0) {
        setSelectedCompany(companiesData[0].id.toString());
      }
    } catch (error) {
      console.error('Error loading subprocess data:', error);
      toast.error('Error al cargar los datos de subprocesos');
    } finally {
      setSubprocessLoading(false);
    }
  };

  const handleCompanyChange = (companyId: string) => {
    setSelectedCompany(companyId);

    // Load assigned subprocesses for this company
    const companyAssignments = assignedSubprocesses.find(
      (a) => a.companyId === parseInt(companyId)
    );

    if (companyAssignments) {
      setSelectedSubprocessIds(companyAssignments.subprocesses.map((s) => s.subprocessId));
    } else {
      setSelectedSubprocessIds([]);
    }
  };

  const handleSubprocessToggle = (subprocessId: number) => {
    setSelectedSubprocessIds((prev) => {
      const isSelected = prev.includes(subprocessId);
      // When the "Autorización" subprocess is turned ON, open the types submodal
      if (!isSelected && subprocessId === authSubprocessId) {
        setAuthTypeModalOpened(true);
      }
      return isSelected ? prev.filter((id) => id !== subprocessId) : [...prev, subprocessId];
    });
  };

  const handleSelectAll = () => {
    const filteredSubprocesses = getFilteredSubprocesses();
    const allIds = filteredSubprocesses.map((s) => s.id_subprocess);
    setSelectedSubprocessIds(allIds);
  };

  const handleDeselectAll = () => {
    setSelectedSubprocessIds([]);
  };

  const getFilteredSubprocesses = () => {
    if (!subprocessSearch) return allSubprocesses;

    const searchLower = subprocessSearch.toLowerCase();
    return allSubprocesses.filter(
      (s) =>
        s.subprocess.toLowerCase().includes(searchLower) ||
        s.process.process.toLowerCase().includes(searchLower)
    );
  };

  const getTotalAssignedSubprocessCount = () => {
    const uniqueIds = new Set<number>();
    for (const company of assignedSubprocesses) {
      for (const subprocess of company.subprocesses) {
        uniqueIds.add(subprocess.subprocessId);
      }
    }
    return uniqueIds.size;
  };

  const getOtherCompanyAssignments = () => {
    if (!selectedCompany) return [];
    const companyId = parseInt(selectedCompany, 10);
    return assignedSubprocesses.filter(
      (assignment) => assignment.companyId !== companyId && assignment.subprocesses.length > 0
    );
  };

  const handleSaveSubprocesses = async () => {
    if (!selectedUser || !selectedCompany) {
      toast.error('Por favor seleccione una empresa');
      return;
    }

    // Determine whether the "Autorización" subprocess will remain assigned to the user (global,
    // per-user rule): either it's selected for the current company, or it's already assigned in
    // another company.
    const currentHasAuth = authSubprocessId !== null && selectedSubprocessIds.includes(authSubprocessId);
    const otherHasAuth = assignedSubprocesses.some(
      (a) =>
        a.companyId !== parseInt(selectedCompany, 10) &&
        a.subprocesses.some((s) => s.subprocessUrl === '/process/authorization')
    );
    const authAssignedAfterSave = currentHasAuth || otherHasAuth;

    if (authAssignedAfterSave && selectedAuthorizationTypeIds.length === 0) {
      toast.error('Debe seleccionar al menos un tipo de autorización');
      return;
    }

    try {
      setSubprocessLoading(true);
      const response = await fetch(`/api/users/${selectedUser.id}/subprocesses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId: parseInt(selectedCompany),
          subprocessIds: selectedSubprocessIds,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update subprocesses');
      }

      const result = await response.json();

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
        `Subprocesos actualizados: ${result.added} agregados, ${result.removed} removidos`
      );

      const assignedResponse = await fetch(`/api/users/${selectedUser.id}/subprocesses`, {
        cache: 'no-store',
      });
      if (assignedResponse.ok) {
        const { assignedSubprocesses: assigned } = await assignedResponse.json();
        setAssignedSubprocesses(assigned);
        const companyAssignments = assigned.find(
          (a: AssignedSubprocess) => a.companyId === parseInt(selectedCompany, 10)
        );
        setSelectedSubprocessIds(
          companyAssignments?.subprocesses.map(
            (s: AssignedSubprocess['subprocesses'][number]) => s.subprocessId
          ) ?? []
        );
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
                    Gestiona accesos, roles y subprocesos · {pagination.total} usuarios
                  </Text>
                </div>
              </Group>
            </div>

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
                variant='light'
                leftSection={<IconDownload size={14} />}
                onClick={exportToCSV}
              >
                Exportar CSV
              </Button>
            </Group>
          </Flex>
        </Card>

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

        <Card shadow='sm' radius='md' withBorder p='md' style={{ position: 'relative' }}>
          {refreshing ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'color-mix(in srgb, var(--mantine-color-body) 70%, transparent)',
                borderRadius: 'inherit',
              }}
            >
              <Loader size='sm' />
            </div>
          ) : null}

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

      {/* Subprocess Assignment Modal */}
      <Modal
        opened={subprocessModalOpened}
        onClose={() => setSubprocessModalOpened(false)}
        title={`Asignar Subprocesos - ${selectedUser?.name || selectedUser?.email}`}
        size='xl'
      >
        <Stack>
          {subprocessLoading ? (
            <div className='flex justify-center py-8'>
              <Loader size='lg' />
            </div>
          ) : (
            <>
              <Select
                label='Empresa'
                placeholder='Seleccione una empresa'
                data={companies.map((c) => {
                  const assignment = assignedSubprocesses.find((a) => a.companyId === c.id);
                  const count = assignment?.subprocesses.length ?? 0;
                  return {
                    value: c.id.toString(),
                    label: count > 0 ? `${c.name} (${count} asignados)` : c.name,
                  };
                })}
                value={selectedCompany}
                onChange={(value) => handleCompanyChange(value || '')}
                required
                disabled={companies.length === 0}
              />

              {getTotalAssignedSubprocessCount() > 0 && (
                <Alert color='gray' variant='light'>
                  <div className='text-sm'>
                    Este usuario tiene <strong>{getTotalAssignedSubprocessCount()}</strong>{' '}
                    subproceso(s) en total en la página de Procesos (suma de todas las empresas).
                  </div>
                </Alert>
              )}

              {getOtherCompanyAssignments().length > 0 && (
                <Alert color='yellow' variant='light'>
                  <div className='text-sm'>
                    <strong>Atención:</strong> también tiene asignaciones en otras empresas:{' '}
                    {getOtherCompanyAssignments()
                      .map(
                        (assignment) =>
                          `${assignment.companyName} (${assignment.subprocesses.length})`
                      )
                      .join(', ')}
                    . Cambie de empresa arriba para revisarlas o quitarlas.
                  </div>
                </Alert>
              )}

              {companies.length === 0 && (
                <Alert color='yellow' variant='light'>
                  No hay empresas disponibles. Por favor, asegúrese de que el usuario esté asociado
                  a al menos una empresa.
                </Alert>
              )}

              {selectedCompany && (
                <>
                  <TextInput
                    label='Buscar subprocesos'
                    placeholder='Buscar por nombre de subproceso o proceso'
                    leftSection={<IconSearch size={16} />}
                    value={subprocessSearch}
                    onChange={(e) => setSubprocessSearch(e.target.value)}
                  />

                  <Group justify='space-between'>
                    <div>
                      <Badge color='blue' variant='light'>
                        {selectedSubprocessIds.length} seleccionados
                      </Badge>
                    </div>
                    <Group gap='xs'>
                      <Button
                        size='xs'
                        variant='light'
                        leftSection={<IconCheck size={14} />}
                        onClick={handleSelectAll}
                      >
                        Seleccionar Todos
                      </Button>
                      <Button
                        size='xs'
                        variant='light'
                        color='red'
                        leftSection={<IconX size={14} />}
                        onClick={handleDeselectAll}
                      >
                        Deseleccionar Todos
                      </Button>
                    </Group>
                  </Group>

                  <Paper withBorder p='md' style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <Stack gap='xs'>
                      {getFilteredSubprocesses().length === 0 ? (
                        <div className='text-center py-4 text-gray-500'>
                          No se encontraron subprocesos
                        </div>
                      ) : (
                        getFilteredSubprocesses().map((subprocess) => (
                          <Paper
                            key={subprocess.id_subprocess}
                            p='sm'
                            withBorder
                            style={{
                              cursor: 'pointer',
                              backgroundColor: selectedSubprocessIds.includes(
                                subprocess.id_subprocess
                              )
                                ? 'rgba(102, 126, 234, 0.1)'
                                : 'transparent',
                            }}
                            onClick={() => handleSubprocessToggle(subprocess.id_subprocess)}
                          >
                            <Group justify='space-between'>
                              <div>
                                <div className='font-medium'>{subprocess.subprocess}</div>
                                <div className='text-sm text-gray-600'>
                                  Proceso: {subprocess.process.process}
                                </div>
                                {subprocess.subprocess_url && (
                                  <div className='text-xs text-gray-500'>
                                    URL: {subprocess.subprocess_url}
                                  </div>
                                )}
                                {isHubHiddenRequestDashboardSubprocess(subprocess) ? (
                                  <Badge size='xs' variant='light' color='teal' mt={4}>
                                    {isValentineWallSubprocess(subprocess)
                                      ? 'Permiso OLP: corazón en el header (muro Dosis de Amor)'
                                      : isOrionFirmaPrepareSubprocess(subprocess)
                                        ? 'Permiso: preparar PDF, firmantes y enviar a firma'
                                        : isOrionFirmaSignSubprocess(subprocess)
                                          ? 'Permiso obligatorio para firmar (aunque esté como firmante)'
                                          : isDeleteAttachmentsSubprocess(subprocess)
                                            ? 'Permiso: eliminar archivos adjuntos de solicitudes'
                                            : subprocess.subprocess_url ===
                                                  DASHBOARD_SOLICITADO_URL ||
                                                (subprocess.subprocess_url ?? '').includes(
                                                  'dashboard-solicitado'
                                                )
                                              ? 'Da acceso a Dashboard personal en el menú'
                                              : subprocess.subprocess_url ===
                                                    DASHBOARD_SOLICITANTE_URL ||
                                                  (subprocess.subprocess_url ?? '').includes(
                                                    'dashboard-solicitante'
                                                  )
                                                ? 'Da acceso a Dashboard solicitudes en el menú'
                                                : 'Da acceso al dashboard en el menú'}
                                  </Badge>
                                ) : null}
                              </div>
                              <Group gap='xs'>
                                {subprocess.id_subprocess === authSubprocessId &&
                                  selectedSubprocessIds.includes(subprocess.id_subprocess) && (
                                    <Button
                                      size='xs'
                                      variant='light'
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAuthTypeModalOpened(true);
                                      }}
                                    >
                                      Configurar tipos
                                      {selectedAuthorizationTypeIds.length > 0 &&
                                        ` (${selectedAuthorizationTypeIds.length})`}
                                    </Button>
                                  )}
                                {selectedSubprocessIds.includes(subprocess.id_subprocess) && (
                                  <IconCheck size={20} color='#113562' />
                                )}
                              </Group>
                            </Group>
                          </Paper>
                        ))
                      )}
                    </Stack>
                  </Paper>

                  <Alert color='blue' variant='light'>
                    <div className='text-sm'>
                      <strong>Nota:</strong> Los subprocesos seleccionados serán asignados al
                      usuario para la empresa seleccionada. Los cambios se guardarán al hacer clic
                      en &quot;Guardar Cambios&quot;.
                    </div>
                  </Alert>
                </>
              )}

              <Group justify='flex-end'>
                <Button variant='default' onClick={() => setSubprocessModalOpened(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSaveSubprocesses}
                  loading={subprocessLoading}
                  disabled={!selectedCompany}
                >
                  Guardar Cambios
                </Button>
              </Group>
            </>
          )}
        </Stack>
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
