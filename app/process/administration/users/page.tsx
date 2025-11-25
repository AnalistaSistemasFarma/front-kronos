'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
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
  Button,
  Group,
  Badge,
  Modal,
  ActionIcon,
  Pagination,
  Loader,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronRight,
  IconSearch,
  IconEdit,
  IconTrash,
  IconPlus,
  IconDownload,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

function UserManagement() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Modal states
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user',
    isActive: true,
  });
  const [formLoading, setFormLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
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
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      setUsers(data.users);
      setPagination((prev) => ({
        ...prev,
        total: data.pagination.total,
        pages: data.pagination.pages,
      }));
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
    fetchUsers();
  }, [session, status, router, fetchUsers]);

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
    setPagination((prev) => ({ ...prev, page: 1 })); // Reset to first page
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

      // Add the new user to the list
      setUsers((prev) => [user, ...prev]);

      // Reset form and close modal
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'user',
        isActive: true,
      });
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

      // Update the user in the list
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));

      // Reset form and close modal
      setEditModalOpened(false);
      setSelectedUser(null);
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

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setFormData({
      name: user.name || '',
      email: user.email,
      password: '', // Don't prefill password
      role: user.role,
      isActive: user.isActive,
    });
    setEditModalOpened(true);
  };

  const openDeleteModal = (user: User) => {
    setSelectedUser(user);
    setDeleteModalOpened(true);
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

  if (status === 'loading' || loading) {
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
        return 'red';
      case 'user':
        return 'blue';
      default:
        return 'gray';
    }
  };

  const getStatusColor = (isActive: boolean) => {
    return isActive ? 'green' : 'red';
  };

  return (
    <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8'>
      <div className='mb-8'>
        <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
          {breadcrumbItems}
        </Breadcrumbs>
        <Title order={1} className='text-3xl font-bold text-gray-900 mb-2'>
          Administración de Usuarios
        </Title>
        <p className='text-gray-600'>Gestiona usuarios del sistema de manera segura y eficiente</p>
        <br />
        <Group>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateModalOpened(true)}>
            Crear Usuario
          </Button>
          <Button variant='outline' leftSection={<IconDownload size={16} />} onClick={exportToCSV}>
            Exportar CSV
          </Button>
        </Group>
      </div>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='md'>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Paper shadow='sm' p='md' radius='md' withBorder mb='md'>
        <Title order={4} mb='md'>
          Filtros
        </Title>
        <Group grow>
          <TextInput
            label='Buscar'
            placeholder='Nombre o email'
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
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
          />
        </Group>
      </Paper>

      {/* Users Table */}
      <Paper shadow='sm' radius='md' withBorder>
        <div className='overflow-x-auto'>
          <Table stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Rol</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Fecha de Registro</Table.Th>
                <Table.Th>Acciones</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={7} className='text-center py-8 text-gray-500'>
                    No se encontraron usuarios
                  </Table.Td>
                </Table.Tr>
              ) : (
                users.map((user) => (
                  <Table.Tr key={user.id}>
                    <Table.Td className='font-mono text-sm'>{user.id.slice(0, 8)}...</Table.Td>
                    <Table.Td className='font-medium'>{user.name || 'Sin nombre'}</Table.Td>
                    <Table.Td>{user.email}</Table.Td>
                    <Table.Td>
                      <Badge color={getRoleColor(user.role)} variant='light'>
                        {user.role}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={getStatusColor(user.isActive)} variant='light'>
                        {user.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {new Date(user.createdAt).toLocaleDateString('es-ES', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Table.Td>
                    <Table.Td>
                      <Group gap='xs'>
                        <ActionIcon
                          variant='subtle'
                          color='blue'
                          onClick={() => openEditModal(user)}
                          title='Editar usuario'
                        >
                          <IconEdit size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant='subtle'
                          color='red'
                          onClick={() => openDeleteModal(user)}
                          title='Desactivar usuario'
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className='flex justify-center p-4'>
            <Pagination
              total={pagination.pages}
              value={pagination.page}
              onChange={(page) => setPagination((prev) => ({ ...prev, page }))}
              size='sm'
            />
          </div>
        )}
      </Paper>

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
