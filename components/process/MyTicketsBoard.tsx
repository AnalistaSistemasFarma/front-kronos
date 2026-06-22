'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  Title,
  Stack,
  Alert,
  Breadcrumbs,
  Anchor,
  Select,
  Button,
  Group,
  Grid,
  Card,
  Text,
  LoadingOverlay,
  Collapse,
  Flex,
  TextInput,
  Badge,
} from '@mantine/core';
import { HelpDeskCasesTable } from '../help-desk/HelpDeskCasesTable';
import type { HelpDeskCaseListItem } from '../../lib/help-desk/types';
import {
  IconAlertCircle,
  IconChevronRight,
  IconFilter,
  IconX,
  IconTicket,
  IconCalendarEvent,
  IconAt,
  IconFlag,
  IconCheck,
  IconClock,
  IconDownload,
  IconInbox,
} from '@tabler/icons-react';

interface MyTicketsUser {
  id: string | null;
  name: string | null;
  email: string;
}

interface MyTicketsResponse {
  user: MyTicketsUser;
  tickets: HelpDeskCaseListItem[];
  counts: {
    total: number;
    open: number;
    resolved: number;
    assigned: number;
  };
}

export function MyTicketsBoard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tickets, setTickets] = useState<HelpDeskCaseListItem[]>([]);
  const [profile, setProfile] = useState<MyTicketsUser | null>(null);
  const [counts, setCounts] = useState<MyTicketsResponse['counts'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filters, setFilters] = useState({
    priority: '',
    status: '0',
    date_from: '',
    date_to: '',
  });

  const fetchMyTickets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.status) params.append('status', filters.status);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);

      const response = await fetch(`/api/help-desk/my-tickets?${params.toString()}`);
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (!response.ok) throw new Error('Error al cargar tus tickets');

      const data: MyTicketsResponse = await response.json();
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      setProfile(data.user ?? null);
      setCounts(data.counts ?? null);
      setLoaded(true);
    } catch (err) {
      console.error('Error fetching my tickets:', err);
      setError('No se pudieron cargar tus tickets. Por favor intente nuevamente.');
    } finally {
      setLoading(false);
    }
  }, [filters, router]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    void fetchMyTickets();
  }, [session, status, router]);

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setFilters({
      priority: '',
      status: '0',
      date_from: '',
      date_to: '',
    });
  };

  async function exportToExcel() {
    if (tickets.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Mis tickets');

    const headers = Object.keys(tickets[0]);
    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: 22,
    }));

    tickets.forEach((row) => worksheet.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const safeEmail = (profile?.email || 'mis_tickets').replace(/[^a-zA-Z0-9@._-]/g, '_');
    saveAs(blob, `Mis_Tickets_${safeEmail}.xlsx`);
  }

  if (status === 'loading') {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div>Cargando...</div>
      </div>
    );
  }

  if (!session) return null;

  const displayEmail = profile?.email ?? session.user?.email ?? '';
  const displayName = profile?.name ?? session.user?.name ?? 'Usuario';

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Mis tickets', href: '#' },
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

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' className='bg-white'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='flex-start' mb='4' wrap='wrap' gap='md'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3'
              >
                <IconInbox size={32} className='text-blue-600' />
                Mis tickets
              </Title>
              <Text size='lg' c='dimmed'>
                Casos que has solicitado o que tienes asignados según tu perfil
              </Text>
            </div>
            <Badge size='lg' variant='light' color='blue' leftSection={<IconAt size={14} />}>
              {displayEmail}
            </Badge>
          </Flex>

          <Alert icon={<IconAt size={18} />} color='blue' variant='light' mb='md'>
            Sesión de <strong>{displayName}</strong>. Mostrando tus casos vinculados a{' '}
            {displayEmail}.
          </Alert>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconTicket size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' c='blue.7'>
                      Total
                    </Text>
                    <Text size='lg' fw={600}>
                      {loaded ? (counts?.total ?? tickets.length) : '—'}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-yellow-50 border-yellow-200'>
                <Group>
                  <IconClock size={24} className='text-yellow-600' />
                  <div>
                    <Text size='xs' c='yellow.7'>
                      Abiertos
                    </Text>
                    <Text size='lg' fw={600}>
                      {loaded ? (counts?.open ?? 0) : '—'}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-green-50 border-green-200'>
                <Group>
                  <IconCheck size={24} className='text-green-600' />
                  <div>
                    <Text size='xs' c='green.7'>
                      Resueltos
                    </Text>
                    <Text size='lg' fw={600}>
                      {loaded ? (counts?.resolved ?? 0) : '—'}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-violet-50 border-violet-200'>
                <Group>
                  <Button
                    onClick={exportToExcel}
                    size='lg'
                    leftSection={<IconDownload size={18} />}
                    className='bg-green-500 hover:bg-green-700'
                    disabled={tickets.length === 0}
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
            title='Atención'
            color='red'
            mb='md'
            className='border-red-200 bg-red-50'
          >
            {error}
          </Alert>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6' className='bg-white'>
          <Stack gap='md'>
            <Group justify='space-between' wrap='wrap'>
              <Button
                variant='subtle'
                leftSection={<IconFilter size={16} />}
                onClick={() => setFiltersExpanded(!filtersExpanded)}
              >
                {filtersExpanded ? 'Ocultar filtros' : 'Filtros adicionales'}
              </Button>
              <Group>
                <Button variant='outline' onClick={clearFilters} leftSection={<IconX size={16} />}>
                  Limpiar
                </Button>
                <Button onClick={() => void fetchMyTickets()} leftSection={<IconFilter size={16} />}>
                  Aplicar filtros
                </Button>
              </Group>
            </Group>

            <Collapse in={filtersExpanded}>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label='Estado'
                    data={[
                      { value: '0', label: 'Todos' },
                      { value: '1', label: 'Abierto' },
                      { value: '2', label: 'Resuelto' },
                      { value: '3', label: 'Cancelado' },
                      { value: '4', label: 'En progreso' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '0')}
                    leftSection={<IconFlag size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label='Prioridad'
                    placeholder='Todas'
                    clearable
                    data={[
                      { value: 'Baja', label: 'Baja' },
                      { value: 'Media', label: 'Media' },
                      { value: 'Alta', label: 'Alta' },
                    ]}
                    value={filters.priority}
                    onChange={(value) => handleFilterChange('priority', value || '')}
                    leftSection={<IconFlag size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <TextInput
                    label='Fecha desde'
                    type='date'
                    value={filters.date_from}
                    onChange={(e) => handleFilterChange('date_from', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <TextInput
                    label='Fecha hasta'
                    type='date'
                    value={filters.date_to}
                    onChange={(e) => handleFilterChange('date_to', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                  />
                </Grid.Col>
              </Grid>
            </Collapse>
          </Stack>
        </Card>

        <Card shadow='sm' radius='md' withBorder className='bg-white overflow-hidden' p='lg'>
          <LoadingOverlay visible={loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconTicket size={20} />
            Mis casos
          </Title>

          <HelpDeskCasesTable
            tickets={tickets}
            showRequester
            emptyMessage={loaded ? 'No tienes tickets con estos criterios' : 'Cargando tus tickets...'}
            emptyHint={
              loaded ? 'Ajusta los filtros para ver otros casos' : 'Identificando tu perfil con la sesión activa'
            }
          />
        </Card>
      </div>
    </div>
  );
}
