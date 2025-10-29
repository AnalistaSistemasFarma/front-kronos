'use client';

import { useState, useEffect, Suspense } from 'react';
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
  Select,
  Button,
  Group,
  Badge,
  Modal,
  Textarea,
} from '@mantine/core';
import { IconAlertCircle, IconChevronRight, IconSearch } from '@tabler/icons-react';

interface Ticket {
  id_case: number;
  subject_case: string;
  priority: string;
  status: string;
  creation_date: string;
  nombreTecnico: string;
  subprocess_id: number;
}

function TicketsBoard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    priority: '',
    status: '',
    assigned_user: '',
    date_from: '',
    date_to: '',
  });
  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState({
    requestType: '',
    priority: '',
    technician: '',
    category: '',
    site: '',
    asunto: '',
    subcategory: '',
    department: '',
    activity: '',
    description: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  // Options for selects
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [subcategories, setSubcategories] = useState<{ value: string; label: string }[]>([]);
  const [activities, setActivities] = useState<{ value: string; label: string }[]>([]);
  const [technicals, setTechnicals] = useState<{ value: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [idUser, setIdUser] = useState("");

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchTickets();
    fetchOptions();
    fetchSubprocessUsers();
  }, [session, status, router, filters]);

  useEffect(() => {
    const globalStore = localStorage.getItem("global-store");
    if (globalStore) {
      try {
        const parsedStore = JSON.parse(globalStore);
        const idUserValue = parsedStore?.state?.idUser || "";
        setIdUser(idUserValue);
      } catch (error) {
        console.error("Error parsing global-store from localStorage:", error);
        setIdUser("");
      }
    } else {
      setIdUser("");
    }
  }, []);

  const fetchOptions = async () => {
    try {
      setLoadingOptions(true);
      const [categoriesRes, departmentsRes] = await Promise.all([
        fetch('/api/help-desk/categories'),
        fetch('/api/help-desk/departments'),
      ]);

      if (categoriesRes.ok) {
        const categoriesData: { id_category: number; category: string }[] = await categoriesRes.json();
        setCategories(categoriesData.map((cat) => ({ value: cat.id_category.toString(), label: cat.category })));
      }

      if (departmentsRes.ok) {
        const departmentsData: { id_department: number; department: string }[] = await departmentsRes.json();
        setDepartments(departmentsData.map((dep) => ({ value: dep.id_department.toString(), label: dep.department })));
      }
    } catch (error) {
      console.error('Error fetching options:', error);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchSubcategories = async (categoryId: string) => {
    console.log('Frontend - fetchSubcategories called with categoryId:', categoryId);
    try {
      const response = await fetch(`/api/help-desk/subcategories?category_id=${categoryId}`);
      console.log('Frontend - fetchSubcategories response status:', response.status);
      if (response.ok) {
        const data: { id_subcategory: number; subcategory: string }[] = await response.json();
        console.log('Frontend - fetchSubcategories received data:', data);
        setSubcategories(data.map((sub) => ({ value: sub.id_subcategory.toString(), label: sub.subcategory })));
        console.log('Frontend - subcategories state updated:', data.map((sub) => ({ value: sub.id_subcategory.toString(), label: sub.subcategory })));
      } else {
        console.error('Frontend - fetchSubcategories failed with status:', response.status);
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
        const data: { id_activity: number; activity: string }[] = await response.json();
        setActivities(data.map((act) => ({ value: act.id_activity.toString(), label: act.activity })));
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
  };

  const fetchTickets = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (subprocessId) params.append('subprocess_id', subprocessId);
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.status) params.append('status', filters.status);
      if (filters.assigned_user) params.append('assigned_user', filters.assigned_user);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);

      // ✅ usar los parámetros en la URL
      const response = await fetch(`/api/help-desk/tickets?${params.toString()}`);

      if (!response.ok) throw new Error('Failed to fetch tickets');

      const data = await response.json();
      setTickets(data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Handle dependent selects
    if (field === 'category' && value) {
      fetchSubcategories(value);
      // Reset dependent fields
      setFormData((prev) => ({
        ...prev,
        subcategory: '',
        activity: '',
      }));
      setSubcategories([]);
      setActivities([]);
    } else if (field === 'subcategory' && value) {
      fetchActivities(value);
      // Reset dependent field
      setFormData((prev) => ({
        ...prev,
        activity: '',
      }));
      setActivities([]);
    }
  };

  const handleCreateTicket = async () => {
    try {
      setCreateLoading(true);
      const response = await fetch('/api/help-desk/create_ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestType: formData.requestType,
          priority: formData.priority,
          technician: formData.technician,
          category: formData.category,
          site: formData.site,
          requester: idUser,
          asunto: formData.asunto,
          subcategory: formData.subcategory,
          department: formData.department,
          activity: formData.activity,
          description: formData.description,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create ticket');
      }

      const newTicket = await response.json();

      // Add the new ticket to the list
      setTickets((prev) => [newTicket, ...prev]);

      // Reset form and close modal
      setFormData({
        requestType: '',
        priority: '',
        technician: '',
        category: '',
        site: '',
        asunto: '',
        subcategory: '',
        department: '',
        activity: '',
        description: '',
      });

      fetchTickets();
      setModalOpened(false);
    } catch (err) {
      console.error('Error creating ticket:', err);
      setError('Failed to create ticket. Please try again.');
    } finally {
      setCreateLoading(false);
    }
  };


  if (status === 'loading' || loading) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div>Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const breadcrumbItems = [
    { title: 'Process', href: '/process' },
    { title: 'Help Desk', href: '#' },
    { title: 'Tickets Board', href: '#' },
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

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'alta': return 'orange';
      case 'media': return 'yellow';
      case 'baja': return 'green';
      default: return 'gray';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'abierto': return 'green';
      case 'in progress': return 'blue';
      case 'closed': return 'red';
      default: return 'gray';
    }
  };

  return (
    <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8'>
      <div className='mb-8'>
        <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
          {breadcrumbItems}
        </Breadcrumbs>
        <Title order={1} className='text-3xl font-bold text-gray-900 mb-2'>
          Mesa de Ayuda
        </Title>
        <p className='text-gray-600'>
          Vista y Administración de Tickets
        </p>
        <br />
        <Button onClick={() => setModalOpened(true)}>
          Crear Ticket
        </Button>
      </div>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='md'>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Paper shadow='sm' p='md' radius='md' withBorder mb='md'>
        <Title order={4} mb='md'>Filters</Title>
        <Group grow>
          <Select
            label='Priority'
            placeholder='All priorities'
            data={[
              { value: '', label: '' },
              { value: 'Baja', label: 'Baja' },
              { value: 'Media', label: 'Media' },
              { value: 'Alta', label: 'Alta' },
            ]}
            value={filters.priority}
            onChange={(value) => handleFilterChange('priority', value || '')}
          />
          <TextInput
            label='Assigned User'
            placeholder='Search by user'
            leftSection={<IconSearch size={16} />}
            value={filters.assigned_user}
            onChange={(e) => handleFilterChange('assigned_user', e.target.value)}
          />
          <TextInput
            label='Date From'
            type='date'
            value={filters.date_from}
            onChange={(e) => handleFilterChange('date_from', e.target.value)}
          />
          <TextInput
            label='Date To'
            type='date'
            value={filters.date_to}
            onChange={(e) => handleFilterChange('date_to', e.target.value)}
          />
        </Group>
      </Paper>

      {/* Tickets Table */}
      <Paper shadow='sm' radius='md' withBorder>
        <div className='overflow-x-auto'>
          <Table stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Asunto</Table.Th>
                <Table.Th>Prioridad</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Fecha de Creación</Table.Th>
                <Table.Th>Usuario Asignado</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tickets.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6} className='text-center py-8 text-gray-500'>
                    No tickets found
                  </Table.Td>
                </Table.Tr>
              ) : (
                tickets.map((ticket) => (
                  <Table.Tr 
                    key={ticket.id_case}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => {
                      sessionStorage.setItem("selectedTicket", JSON.stringify(ticket));

                      router.push(`/process/help-desk/view-ticket?id=${ticket.id_case}`);
                    }}
                  >
                    <Table.Td>{ticket.id_case}</Table.Td>
                    <Table.Td className='font-Media'>{ticket.subject_case}</Table.Td>
                    <Table.Td>
                      <Badge color={getPriorityColor(ticket.priority)} variant='light'>
                        {ticket.priority}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={getStatusColor(ticket.status)} variant='light'>
                        {ticket.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {ticket.creation_date.split('T')[0]}
                    </Table.Td>
                    <Table.Td>{ticket.nombreTecnico}</Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </div>
      </Paper>

      {/* Modal for creating ticket */}
      <Modal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        title="Crear Nuevo Ticket"
        size="lg"
      >
        <Stack>
          <Select
            label="Tipo Solicitud"
            placeholder="Seleccione el tipo de solicitud"
            data={[
              { value: 'Incidente', label: 'Incidente' },
              { value: 'Solicitud', label: 'Solicitud' },
            ]}
            value={formData.requestType}
            onChange={(value) => setFormData({ ...formData, requestType: value || '' })}
          />
          <Select
            label="Prioridad"
            placeholder="Seleccione la prioridad"
            data={[
              { value: 'Baja', label: 'Baja' },
              { value: 'Media', label: 'Media' },
              { value: 'Alta', label: 'Alta' },
            ]}
            value={formData.priority}
            onChange={(value) => setFormData({ ...formData, priority: value || '' })}
          />
          <TextInput
            label="Asunto"
            placeholder="Ingrese el asunto"
            value={formData.asunto}
            onChange={(e) => setFormData({ ...formData, asunto: e.target.value })}
          />
          <Select
            label="Técnico"
            placeholder="Seleccione el técnico asignado"
            data={technicals}
            value={formData.technician}
            onChange={(value) => handleFormChange('technician', value || '')}
          />
          <Select
            label="Categoría"
            placeholder="Seleccione la categoría"
            data={categories}
            value={formData.category}
            onChange={(value) => handleFormChange('category', value || '')}
            disabled={loadingOptions}
          />
          <Select
            label="Sitio"
            placeholder="Seleccione el sitio"
            data={[
              { value: 'Administrativa', label: 'Administrativa' },
              { value: 'Planta', label: 'Planta' },
              { value: 'Celta', label: 'Celta' },
            ]}
            value={formData.site}
            onChange={(value) => setFormData({ ...formData, site: value || '' })}
          />
          <Select
            label="Subcategoría"
            placeholder="Seleccione la subcategoría"
            data={subcategories}
            value={formData.subcategory}
            onChange={(value) => handleFormChange('subcategory', value || '')}
            disabled={!formData.category || loadingOptions}
          />
          <Select
            label="Departamento"
            placeholder="Seleccione el departamento"
            data={departments}
            value={formData.department}
            onChange={(value) => handleFormChange('department', value || '')}
            disabled={loadingOptions}
          />
          <Select
            label="Actividad"
            placeholder="Seleccione la actividad"
            data={activities}
            value={formData.activity}
            onChange={(value) => handleFormChange('activity', value || '')}
            disabled={!formData.subcategory || loadingOptions}
          />
          <Textarea
            label="Descripción"
            placeholder="Describa el problema o solicitud"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            minRows={4}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpened(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateTicket} loading={createLoading}>
              Crear Ticket
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

export default function TicketsBoardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TicketsBoard />
    </Suspense>
  );
}
