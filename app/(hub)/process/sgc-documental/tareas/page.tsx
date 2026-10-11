'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Collapse,
  Flex,
  Grid,
  Group,
  Loader,
  LoadingOverlay,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import SgcSelect from '../../../../../components/sgc/SgcSelect';
import {
  IconAlertCircle,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
  IconChevronRight,
  IconCircleCheckFilled,
  IconClock,
  IconFilter,
  IconFlag,
  IconProgress,
  IconRefresh,
  IconTicket,
  IconUser,
  IconUserCheck,
  IconX,
} from '@tabler/icons-react';
import { formatDateCO } from '../../../../../components/sgc/tareas/format';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import type { SgcInboxRow } from '../../../../../lib/sgc/db/requests';

/**
 * «Tareas documentales» — bandeja propia del SGC. COPIA CONGELADA
 * (2026-09-30) de «Tareas Asignadas» de SynerLink
 * (app/(hub)/process/request-general/assigned-activities): misma cabecera,
 * mismos indicadores, filtros y columnas, sobre /api/sgc/tasks. Una fila por
 * cupo de la persona (incluye los cupos de grupo de Calidad).
 */

const STATUS_FILTER = [
  { value: 'todas', label: 'Todos' },
  { value: 'sin_empezar', label: 'Sin Empezar' },
  { value: 'abierta', label: 'Abierto' },
  { value: 'cancelada', label: 'Cancelado' },
  { value: 'resuelta', label: 'Resuelto' },
];

const EMPTY = { id: '', status: '', company: '', date_from: '', date_to: '' };

function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case 'sin empezar':
      return 'gray';
    case 'abierto':
      return 'blue';
    case 'resuelto':
      return 'green';
    default:
      return 'red';
  }
}

function getStatusIcon(status: string) {
  switch (status?.toLowerCase()) {
    case 'sin empezar':
      return IconClock;
    case 'abierto':
      return IconProgress;
    case 'resuelto':
      return IconCircleCheckFilled;
    default:
      return IconX;
  }
}

function inRange(iso: string, from: string, to: string): boolean {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso));
  return (!from || day >= from) && (!to || day <= to);
}

function TaskBoard() {
  const router = useRouter();
  const rowLink = useSgcRowLink();
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const { data, error, loading, reload } = useSgcFetch<{ tasks: SgcInboxRow[] }>('/api/sgc/tasks');
  const all = useMemo(() => data?.tasks ?? [], [data]);
  const companies = useMemo(() => [...new Map(all.map((t) => [String(t.idCompany), t.company])).entries()].map(([value, label]) => ({ value, label })), [all]);

  const tasks = useMemo(
    () =>
      all.filter(
        (t) =>
          (!applied.id || String(t.idRequest) === applied.id.trim()) &&
          (!applied.status || applied.status === 'todas' || t.status === applied.status) &&
          (!applied.company || String(t.idCompany) === applied.company) &&
          inRange(t.createdAt, applied.date_from, applied.date_to)
      ),
    [all, applied]
  );

  const handleFilterChange = (field: keyof typeof EMPTY, value: string) => setFilters((prev) => ({ ...prev, [field]: value }));

  if (loading && !data) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }} className='flex items-center justify-center'>
        <Group gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando...</Text>
        </Group>
      </div>
    );
  }

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Tareas documentales', href: '#' },
    { title: 'Tarea', href: '#' },
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

  const count = (status: string) => all.filter((t) => t.status === status).length;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' data-testid='bandeja-cabecera'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='bandeja-titulo'>
                <IconTicket size={32} className='text-blue-600' />
                Tareas documentales
              </Title>
              <Text size='lg' c='dimmed'>
                Gestión de Tareas documentales asignadas a ti
              </Text>
            </div>
          </Flex>

          <Grid>
            {[
              { label: 'Total de Tareas', value: all.length, icon: IconTicket, color: 'blue' },
              { label: 'Sin Empezar', value: count('sin_empezar'), icon: IconClock, color: 'gray' },
              { label: 'En Ejecución', value: count('abierta'), icon: IconProgress, color: 'blue' },
              { label: 'Completadas', value: count('resuelta'), icon: IconCheck, color: 'green' },
            ].map((k) => (
              <Grid.Col key={k.label} span={{ base: 12, sm: 6, md: 3 }}>
                <Card p='md' radius='md' withBorder style={{ backgroundColor: `var(--mantine-color-${k.color}-light)` }} data-testid='bandeja-indicador'>
                  <Group>
                    <k.icon size={24} color={`var(--mantine-color-${k.color}-light-color)`} />
                    <div>
                      <Text size='xs' c={`var(--mantine-color-${k.color}-light-color)`}>
                        {k.label}
                      </Text>
                      <Text size='lg' fw={600}>
                        {k.value}
                      </Text>
                    </div>
                  </Group>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        </Card>

        {error && (
          <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md' className='border-red-200 bg-red-50'>
            {error}
          </Alert>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
          <Group justify='space-between' mb='md'>
            <Title order={3} className='flex items-center gap-2'>
              <IconFilter size={20} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon variant='subtle' onClick={() => setFiltersExpanded(!filtersExpanded)} aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}>
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='ID Solicitud' type='text' value={filters.id} onChange={(e) => handleFilterChange('id', e.target.value)} leftSection={<IconFilter size={16} />} data-testid='id-filter' />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <SgcSelect label='Estado' placeholder='Todos los estados' clearable data={STATUS_FILTER} value={filters.status} onChange={(value) => handleFilterChange('status', value || '')} leftSection={<IconFlag size={16} />} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <SgcSelect label='Empresa' placeholder='Todas las empresas' clearable data={companies} value={filters.company} onChange={(value) => handleFilterChange('company', value || '')} leftSection={<IconBuilding size={16} />} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Fecha Desde' type='date' value={filters.date_from} onChange={(e) => handleFilterChange('date_from', e.target.value)} leftSection={<IconCalendarEvent size={16} />} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Fecha Hasta' type='date' value={filters.date_to} onChange={(e) => handleFilterChange('date_to', e.target.value)} leftSection={<IconCalendarEvent size={16} />} />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={() => {
                    setFilters(EMPTY);
                    setApplied(EMPTY);
                    reload();
                  }}
                  leftSection={<IconX size={16} />}
                >
                  Limpiar Filtros
                </Button>
                <Button
                  onClick={() => {
                    setApplied(filters);
                    reload();
                  }}
                  leftSection={<IconRefresh size={16} />}
                >
                  Aplicar Filtros
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconTicket size={20} />
            Lista de Tareas Asignadas
          </Title>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover data-testid='bandeja-tabla'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID Solicitud</Table.Th>
                  <Table.Th>Tarea</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Solicitante / Asignado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tasks.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={7} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconTicket size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          No se encontraron tareas asignadas
                        </Text>
                        <Text size='sm' c='gray.5'>
                          No tienes tareas asignadas actualmente
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  tasks.map((task) => {
                    const StatusIcon = getStatusIcon(task.statusLabel);
                    return (
                      <Table.Tr
                        key={task.idAssignee}
                        {...rowLink(`/process/sgc-documental/tareas/${task.idTask}?empresa=${task.idCompany}`)}
                        data-testid='bandeja-fila'
                        data-request={task.idRequest}
                        data-task={task.idTask}
                        data-status={task.status}
                      >
                        <Table.Td>
                          <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                            {task.idRequest}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' fw={500} lineClamp={2}>
                            {task.task}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 220, maxWidth: 320 }}>
                          <Text size='sm' lineClamp={2}>
                            {task.subject}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} className='flex'>
                            <IconBuilding size={12} className='text-gray-400' />
                            <Text size='sm' className='max-w-xs truncate'>
                              {task.company}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Badge color={getStatusColor(task.statusLabel)} variant='light' size='sm' leftSection={<StatusIcon size={12} />} styles={{ label: { overflow: 'visible' } }}>
                            {task.statusLabel}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap='nowrap' align='flex-start'>
                            <IconCalendarEvent size={14} className='text-gray-400' style={{ marginTop: 2 }} />
                            <Text size='sm' c='dimmed'>
                              {formatDateCO(task.createdAt, { fallback: 'Sin fecha' })}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            <Group gap={4} wrap='nowrap'>
                              <IconUser size={14} className='text-gray-400' />
                              <Text size='sm'>{task.requester}</Text>
                            </Group>
                            <Group gap={4} wrap='nowrap'>
                              <IconUserCheck size={14} className='text-gray-400' />
                              <Text size='sm' c='dimmed'>
                                {task.assigned}
                              </Text>
                            </Group>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function SgcTaskBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <TaskBoard />
    </Suspense>
  );
}
