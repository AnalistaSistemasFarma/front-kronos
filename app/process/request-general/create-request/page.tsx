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
  id: number;
  description: string;
  user: string;
  status: string;
  created_at: string;
  category: string;
  id_company: number;
  requester: string;
  company: string;
}

function RequestBoard() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState({
    company: '',
    usuario: '',
    descripcion: '',
    category: '',
  });
  const [createLoading, setCreateLoading] = useState(false);

  // Options for selects
  const [companies, setCompany] = useState<{ value: string; label: string }[]>([]);
  const [idUser, setIdUser] = useState("");

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchTickets();
    fetchCompanies();
  }, [session, status, router]);

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

  const fetchTickets = async () => {
    try {
      setLoading(true);

      const response = await fetch(`/api/requests-general`);

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

  const fetchCompanies= async () => {
    try {
      setLoading(true);

      const response = await fetch(`/api/requests-general/consult-request`);

      if (response.ok) {
        const data: { id_company: number; company: string }[] = await response.json();
        console.log('Frontend - fetchCompanies received data:', data);
        setCompany(data.map((sub) => ({ value: sub.id_company.toString(), label: sub.company })));
        console.log('Frontend - fetchCompanies state updated:', data.map((sub) => ({ value: sub.id_company.toString(), label: sub.company })));
      } else {
        console.error('Frontend - fetchCompanies failed with status:', response.status);
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
      setError('Unable to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  const handleCreateTicket = async () => {
    try {
      setCreateLoading(true);
      const response = await fetch('/api/requests-general/create-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company: formData.company,
          usuario: formData.usuario,
          descripcion: formData.descripcion,
          category: formData.category,
          createdby: userName,
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
        company: '',
        usuario: '',
        descripcion: '',
        category: '',
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

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'pendiente': return 'orange';
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
        <Title order={1} className='text-3xl font-bold text-gray-900 mb-2'>
          Solicitudes
        </Title>
        <p className='text-gray-600'>
          Vista y Administración de Solicitudes
        </p>
        <br />
        <Button onClick={() => setModalOpened(true)}>
          Crear Solicitud
        </Button>
      </div>

      <Paper shadow='sm' radius='md' withBorder>
        <div className='overflow-x-auto'>
          <Table stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Fecha de Solicitud</Table.Th>
                <Table.Th>Categoria</Table.Th>
                <Table.Th>Solicitado por</Table.Th>
                <Table.Th>Solicitado a</Table.Th>
                <Table.Th>Descripción</Table.Th>
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
                  <Table.Tr>
                    <Table.Td>{ticket.id}</Table.Td>
                    <Table.Td>{ticket.company}</Table.Td>
                    <Table.Td>
                      <Badge color={getPriorityColor(ticket.status)} variant='light'>
                        {ticket.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{ticket.created_at.split('T')[0]}</Table.Td>
                    <Table.Td>{ticket.category}</Table.Td>
                    <Table.Td>{ticket.requester}</Table.Td>
                    <Table.Td>{ticket.user}</Table.Td>
                    <Table.Td>{ticket.description}</Table.Td>
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
            label="Empresa"
            placeholder="Seleccione la empresa"
            data={companies}
            value={formData.company}
            onChange={(value) => handleFormChange('company', value || '')}
          />
          <TextInput
            label="Categoria"
            placeholder="Ingrese la categoria que necesite"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          />
          <Select
            label="Asignado a"
            placeholder="Seleccione a quien asignar esta solicitud"
            data={[
              { value: '', label: '' },
              { value: 'Catalina Sanchez', label: 'Catalina Sanchez' },
              { value: 'Camila Murillo', label: 'Camila Murillo' },
              { value: 'Lina Ramirez', label: 'Lina Ramirez' },
            ]}
            value={formData.usuario}
            onChange={(value) => handleFormChange('usuario', value || '')}
          />
          <Textarea
            label="Descripción"
            placeholder="Describa la solicitud"
            value={formData.descripcion}
            onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
            minRows={4}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpened(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateTicket} loading={createLoading}>
              Crear Solicitud
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
      <RequestBoard />
    </Suspense>
  );
}
