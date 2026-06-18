'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
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
  ActionIcon,
  Collapse,
  Box,
  Flex,
  TextInput,
} from '@mantine/core';
import { HelpDeskSubNav } from '../../../../../components/help-desk/HelpDeskSubNav';
import { HelpDeskCasesTable } from '../../../../../components/help-desk/HelpDeskCasesTable';
import { HelpDeskDashboardLinkButton } from '../../../../../components/help-desk/HelpDeskDashboardLinkButton';
import type { HelpDeskCaseListItem } from '../../../../../lib/help-desk/types';
import {
  IconAlertCircle,
  IconChevronRight,
  IconFilter,
  IconX,
  IconTicket,
  IconCalendarEvent,
  IconUser,
  IconFlag,
  IconBuilding,
  IconCheck,
  IconClock,
  IconDownload,
  IconSearch,
} from '@tabler/icons-react';

interface SelectOption {
  value: string;
  label: string;
}

interface RequesterOption {
  id: string;
  name: string;
  email: string;
  case_count?: number;
}

function formatRequesterLabel(person: RequesterOption) {
  const cases = person.case_count != null ? ` (${person.case_count} casos)` : '';
  if (person.email) {
    return `${person.name} — ${person.email}${cases}`;
  }
  return `${person.name}${cases}`;
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function extractEmailFromLabel(value: string) {
  const match = value.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  return match?.[0] ?? null;
}

function CasesByRequesterBoard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tickets, setTickets] = useState<HelpDeskCaseListItem[]>([]);
  const [requesters, setRequesters] = useState<RequesterOption[]>([]);
  const [companies, setCompanies] = useState<SelectOption[]>([]);
  const [technicals, setTechnicals] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [selectedRequester, setSelectedRequester] = useState<RequesterOption | null>(null);
  const [activeSearchLabel, setActiveSearchLabel] = useState('');
  const [filters, setFilters] = useState({
    priority: '',
    status: '0',
    date_from: '',
    date_to: '',
    technician: '',
    company: '',
  });

  const requesterOptions = useMemo(() => {
    const options = requesters.map((r) => ({
      value: r.id,
      label: formatRequesterLabel(r),
    }));

    if (selectedRequester && !options.some((o) => o.value === selectedRequester.id)) {
      options.unshift({
        value: selectedRequester.id,
        label: formatRequesterLabel(selectedRequester),
      });
    }

    return options;
  }, [requesters, selectedRequester]);

  const resolveRequester = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return selectedRequester;

    if (selectedRequester) {
      const selectedLabel = formatRequesterLabel(selectedRequester);
      if (
        trimmed === selectedLabel ||
        trimmed === selectedRequester.name ||
        trimmed === selectedRequester.email
      ) {
        return selectedRequester;
      }
    }

    const byLabel = requesters.find((r) => formatRequesterLabel(r) === trimmed);
    if (byLabel) return byLabel;

    const emailFromLabel = extractEmailFromLabel(trimmed);
    if (emailFromLabel) {
      const byEmail = requesters.find(
        (r) => r.email?.toLowerCase() === emailFromLabel.toLowerCase()
      );
      if (byEmail) return byEmail;
    }

    const lower = trimmed.toLowerCase();
    return (
      requesters.find((r) => r.email?.toLowerCase() === lower) ??
      requesters.find((r) => r.name.toLowerCase() === lower) ??
      requesters.find((r) => r.email?.toLowerCase().includes(lower)) ??
      requesters.find((r) => r.name.toLowerCase().includes(lower)) ??
      null
    );
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchFilterOptions();
  }, [session, status, router]);

  useEffect(() => {
    const query = searchValue.trim();
    if (query.length < 2) {
      if (!selectedRequester) {
        setRequesters([]);
      }
      return;
    }

    const timer = setTimeout(() => {
      fetchRequesters(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchValue, selectedRequester]);

  const fetchRequesters = async (search: string) => {
    try {
      setLoadingOptions(true);
      const response = await fetch(
        `/api/help-desk/requesters?search=${encodeURIComponent(search)}`
      );
      if (!response.ok) return;
      const data: RequesterOption[] = await response.json();
      setRequesters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching requesters:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      setLoadingOptions(true);
      const [companiesRes, technicalsRes] = await Promise.all([
        fetch('/api/requests-general/consult-request'),
        fetch('/api/help-desk/technical'),
      ]);

      if (companiesRes.ok) {
        const data = await companiesRes.json();
        setCompanies(
          (data.companies ?? []).map((c: { id_company: number; company: string }) => ({
            value: c.id_company.toString(),
            label: c.company,
          }))
        );
      }

      if (technicalsRes.ok) {
        const data = await technicalsRes.json();
        if (Array.isArray(data)) {
          setTechnicals(
            data.map((item: { id_subprocess_user_company: number; name: string }) => ({
              value: item.id_subprocess_user_company.toString(),
              label: item.name,
            }))
          );
        }
      }
    } catch (err) {
      console.error('Error fetching filter options:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchTickets = async (requesterOverride?: RequesterOption | null) => {
    const person = requesterOverride ?? selectedRequester ?? resolveRequester(searchValue.trim());
    const query = searchValue.trim();

    if (!person && !query) {
      setError('Busca por nombre o correo del solicitante.');
      return;
    }

    const emailCandidate =
      person?.email ??
      extractEmailFromLabel(query) ??
      (looksLikeEmail(query) ? query : null);

    if (!person?.id && !emailCandidate && !query) {
      setError('Busca por nombre o correo del solicitante.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (person?.id) {
        params.append('requester_id', person.id);
      } else if (emailCandidate) {
        params.append('requester_email', emailCandidate);
      } else {
        params.append('requester_search', query);
      }
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.status) params.append('status', filters.status);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      if (filters.technician) params.append('technician', filters.technician);
      if (filters.company) params.append('company', filters.company);

      const response = await fetch(`/api/help-desk/tickets?${params.toString()}`);
      if (!response.ok) throw new Error('Error al cargar los casos');

      const data = await response.json();
      setTickets(Array.isArray(data) ? data : []);
      setActiveSearchLabel(
        person ? formatRequesterLabel(person) : emailCandidate ? emailCandidate : query
      );
      if (person) {
        setSelectedRequester(person);
      }
      setHasSearched(true);
    } catch (err) {
      console.error('Error fetching tickets by requester:', err);
      setError('No se pudieron cargar los casos. Por favor intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setSearchValue('');
    setSelectedRequester(null);
    setActiveSearchLabel('');
    setRequesters([]);
    setFilters({
      priority: '',
      status: '0',
      date_from: '',
      date_to: '',
      technician: '',
      company: '',
    });
    setTickets([]);
    setHasSearched(false);
    setError(null);
  };

  async function exportToExcel() {
    if (tickets.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Casos por solicitante');

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

    const safeName = (activeSearchLabel || 'solicitante').replace(/[^a-zA-Z0-9@._-]/g, '_');
    saveAs(blob, `Casos_${safeName}.xlsx`);
  }

  if (status === 'loading') {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div>Cargando...</div>
      </div>
    );
  }

  if (!session) return null;

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Mesa de Ayuda', href: '/process/help-desk/create-ticket' },
    { title: 'Casos por solicitante', href: '#' },
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

          <Flex justify='space-between' align='center' mb='4' wrap='wrap' gap='md'>
            <div>
              <Title
                order={1}
                className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3'
              >
                <IconUser size={32} className='text-blue-600' />
                Casos por solicitante
              </Title>
              <Text size='lg' color='gray.6'>
                Busca por nombre o correo y consulta solo los tickets de esa persona
              </Text>
            </div>

            <HelpDeskDashboardLinkButton />
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
                <Group>
                  <IconTicket size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' color='blue.6'>
                      Resultados
                    </Text>
                    <Text size='lg' fw={600}>
                      {hasSearched ? tickets.length : '—'}
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
                    <Text size='xs' color='green.6'>
                      Resueltos
                    </Text>
                    <Text size='lg' fw={600}>
                      {
                        tickets.filter(
                          (t) =>
                            t.status?.toLowerCase() === 'resuelto' ||
                            t.status?.toLowerCase() === 'cerrado'
                        ).length
                      }
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
                    <Text size='xs' color='yellow.6'>
                      Abiertos
                    </Text>
                    <Text size='lg' fw={600}>
                      {tickets.filter((t) => t.status?.toLowerCase() === 'abierto').length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder className='bg-green-50 border-green-200'>
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

        <HelpDeskSubNav />

        {hasSearched && activeSearchLabel && (
          <Alert
            icon={<IconUser size={20} />}
            title='Búsqueda activa'
            color='blue'
            mb='md'
            className='border-blue-200 bg-blue-50'
          >
            {activeSearchLabel}
          </Alert>
        )}

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
            <Select
              label='Buscar solicitante'
              placeholder={loadingOptions ? 'Buscando...' : 'Escribe nombre o correo (mín. 2 caracteres)'}
              data={requesterOptions}
              value={selectedRequester?.id ?? null}
              searchValue={searchValue}
              onSearchChange={(value) => {
                setSearchValue(value);
                if (
                  selectedRequester &&
                  value !== formatRequesterLabel(selectedRequester) &&
                  value !== selectedRequester.name
                ) {
                  setSelectedRequester(null);
                }
              }}
              onOptionSubmit={(value) => {
                const person = requesters.find((r) => r.id === value);
                if (!person) return;
                setSelectedRequester(person);
                setSearchValue(formatRequesterLabel(person));
                void fetchTickets(person);
              }}
              onChange={(value) => {
                if (!value) {
                  setSelectedRequester(null);
                  return;
                }
                const person = requesters.find((r) => r.id === value);
                if (person) {
                  setSelectedRequester(person);
                  setSearchValue(formatRequesterLabel(person));
                }
              }}
              searchable
              clearable
              onClear={() => {
                setSearchValue('');
                setSelectedRequester(null);
                setRequesters([]);
                setTickets([]);
                setHasSearched(false);
                setActiveSearchLabel('');
                setError(null);
              }}
              nothingFoundMessage={
                searchValue.trim().length < 2
                  ? 'Escribe al menos 2 caracteres'
                  : 'Sin coincidencias; pulsa Buscar casos para intentar igualmente'
              }
              leftSection={<IconSearch size={16} />}
              description='Selecciona un solicitante o pulsa Buscar casos. Al elegir de la lista se cargan automáticamente.'
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchTickets();
              }}
            />

            <Group justify='space-between' wrap='wrap'>
              <Button
                variant='subtle'
                leftSection={<IconFilter size={16} />}
                onClick={() => setFiltersExpanded(!filtersExpanded)}
              >
                {filtersExpanded ? 'Ocultar filtros adicionales' : 'Filtros adicionales'}
              </Button>
              <Group>
                <Button variant='outline' onClick={clearFilters} leftSection={<IconX size={16} />}>
                  Limpiar
                </Button>
                <Button onClick={() => void fetchTickets()} leftSection={<IconSearch size={16} />}>
                  Buscar casos
                </Button>
              </Group>
            </Group>

            <Collapse in={filtersExpanded}>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    data={[
                      { value: '0', label: 'Todos' },
                      { value: '1', label: 'Abierto' },
                      { value: '2', label: 'Resuelto' },
                      { value: '3', label: 'Cancelado' },
                    ]}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value || '0')}
                    leftSection={<IconFlag size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
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
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Empresa'
                    placeholder='Todas'
                    clearable
                    data={companies}
                    value={filters.company}
                    onChange={(value) => handleFilterChange('company', value || '')}
                    leftSection={<IconBuilding size={16} />}
                    disabled={loadingOptions}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Técnico'
                    placeholder='Todos'
                    clearable
                    data={technicals}
                    value={filters.technician}
                    onChange={(value) => handleFilterChange('technician', value || '')}
                    leftSection={<IconUser size={16} />}
                    disabled={loadingOptions}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Fecha desde'
                    type='date'
                    value={filters.date_from}
                    onChange={(e) => handleFilterChange('date_from', e.target.value)}
                    leftSection={<IconCalendarEvent size={16} />}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
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
            Lista de casos
          </Title>

          <HelpDeskCasesTable
            tickets={tickets}
            showRequester
            emptyMessage={
              hasSearched ? 'No se encontraron casos para este solicitante' : 'Busca un solicitante'
            }
            emptyHint={
              hasSearched
                ? 'Prueba con otro nombre, correo o ajusta los filtros adicionales'
                : 'Escribe el nombre o correo y pulsa Buscar casos'
            }
          />
        </Card>
      </div>
    </div>
  );
}

export default function CasesByEmailPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen flex items-center justify-center'>
          <Stack align='center' gap='sm'>
            <Text>Cargando...</Text>
          </Stack>
        </div>
      }
    >
      <CasesByRequesterBoard />
    </Suspense>
  );
}
