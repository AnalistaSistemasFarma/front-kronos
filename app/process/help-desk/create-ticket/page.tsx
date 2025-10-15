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
  subject: string;
  priority: string;
  status: string;
  created_at: string;
  assigned_user: string;
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
    subject: '',
    description: '',
    priority: '',
    department: '',
    place: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchTickets();
  }, [session, status, router, filters]);

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

      const response = await fetch(`/api/help-desk/tickets?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch tickets');
      }
      const data: Ticket[] = await response.json();
      setTickets(data);
    } catch (err) {
      setError('Unable to load tickets. Please try again.');
      console.error('Error fetching tickets:', err);
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

  const handleCreateTicket = async () => {
    try {
      setCreateLoading(true);
      const response = await fetch('/api/help-desk/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: formData.subject,
          description: formData.description,
          priority: formData.priority,
          department: formData.department,
          place: formData.place,
          subprocess_id: subprocessId ? parseInt(subprocessId) : 1,
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
        subject: '',
        description: '',
        priority: '',
        department: '',
        place: '',
      });
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
    switch (priority.toLowerCase()) {
      case 'critical': return 'red';
      case 'high': return 'orange';
      case 'medium': return 'yellow';
      case 'low': return 'green';
      default: return 'gray';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'open': return 'blue';
      case 'in progress': return 'yellow';
      case 'closed': return 'green';
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
              { value: '', label: 'All' },
              { value: 'Low', label: 'Low' },
              { value: 'Medium', label: 'Medium' },
              { value: 'High', label: 'High' },
              { value: 'Critical', label: 'Critical' },
            ]}
            value={filters.priority}
            onChange={(value) => handleFilterChange('priority', value || '')}
          />
          <Select
            label='Status'
            placeholder='All statuses'
            data={[
              { value: '', label: 'All' },
              { value: 'Open', label: 'Open' },
              { value: 'In Progress', label: 'In Progress' },
              { value: 'Closed', label: 'Closed' },
            ]}
            value={filters.status}
            onChange={(value) => handleFilterChange('status', value || '')}
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
                  <Table.Tr key={ticket.id_case}>
                    <Table.Td>{ticket.id_case}</Table.Td>
                    <Table.Td className='font-medium'>{ticket.subject}</Table.Td>
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
                      {new Date(ticket.created_at).toLocaleDateString('es-ES', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Table.Td>
                    <Table.Td>{ticket.assigned_user}</Table.Td>
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
          <TextInput
            label="Asunto"
            placeholder="Ingrese el asunto del ticket"
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
          />
          <Textarea
            label="Descripción"
            placeholder="Describa el problema o solicitud"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            minRows={4}
          />
          <Select
            label="Prioridad"
            placeholder="Seleccione la prioridad"
            data={[
              { value: 'Low', label: 'Baja' },
              { value: 'Medium', label: 'Media' },
              { value: 'High', label: 'Alta' },
              { value: 'Critical', label: 'Crítica' },
            ]}
            value={formData.priority}
            onChange={(value) => setFormData({ ...formData, priority: value || '' })}
          />
          <TextInput
            label="Departamento"
            placeholder="Ingrese el departamento"
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
          />
          <TextInput
            label="Lugar"
            placeholder="Ingrese el lugar"
            value={formData.place}
            onChange={(e) => setFormData({ ...formData, place: e.target.value })}
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
