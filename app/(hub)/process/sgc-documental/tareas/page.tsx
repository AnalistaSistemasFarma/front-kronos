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
  RingProgress,
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
  IconListCheck,
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
 * «Tareas documentales» — bandeja propia del SGC. COPIA de la vista de
 * TAREAS de «Solicitudes y Tareas Asignadas» de SynerLink
 * (app/(hub)/process/request-general/assigned-requests?type=tasks, unificada
 * el 2026-10-09): misma cabecera, indicadores (los de tareas), filtros y
 * columnas, sobre /api/sgc/tasks. Una fila por cupo de la persona (incluye
 * los cupos de grupo de Calidad). D5 de la E2E del 2026-10-10.
 */

const STATUS_FILTER = [
  { value: 'todas', label: 'Todos' },
  { value: 'pendientes', label: 'Pendientes' },
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
          (!applied.status || applied.status === 'todas' || t.status === applied.status || (applied.status === 'pendientes' && (t.status === 'sin_empezar' || t.status === 'abierta'))) &&
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
  const pending = count('sin_empezar') + count('abierta');
  // Avance como en SynerLink: resueltas sobre las vigentes (sin las canceladas).
  const done = count('resuelta');
  const live = all.length - count('cancelada');
  const progress = live > 0 ? Math.round((done / live) * 100) : 0;
  const filterByStatus = (status: string) => {
    const next = { ...applied, status };
    setFilters(next);
    setApplied(next);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      {/* S14 (SGC-REQ-032): cabecera igual a la de «Solicitudes y Tareas Asignadas» de SynerLink desde el #4f12039 (título adaptable al celular). */}
      <div className='max-w-7xl mx-auto py-4 px-3 sm:py-8 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='6' data-testid='bandeja-cabecera'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex direction={{ base: 'column', sm: 'row' }} justify='space-between' align={{ base: 'stretch', sm: 'center' }} gap='md' mb='md'>
            <div style={{ minWidth: 0 }}>
              <Title order={1} fz={{ base: 24, sm: 30 }} lh={1.2} className='font-bold mb-2 flex items-center gap-2 sm:gap-3' data-testid='bandeja-titulo'>
                <IconTicket size={28} className='text-blue-600 shrink-0' />
                Tareas documentales
              </Title>
              <Text size='md' c='dimmed'>
                Gestión de Tareas documentales asignadas a ti
              </Text>
            </div>
          </Flex>

          <Grid columns={10}>
            {[
              { label: 'Total Asignado', value: all.length, sub: `${all.length} tareas`, icon: IconTicket, color: 'blue', status: 'todas', aria: 'Mostrar todas las tareas' },
              { label: 'Tareas Pendientes', value: pending, icon: IconListCheck, color: 'violet', status: 'pendientes', aria: 'Filtrar tareas pendientes' },
              { label: 'Completadas', value: count('resuelta'), icon: IconCheck, color: 'green', status: 'resuelta', aria: 'Filtrar tareas completadas' },
            ].map((k) => (
              <Grid.Col key={k.label} span={{ base: 10, sm: 5, md: 2 }}>
                <Card
                  p='md'
                  radius='md'
                  withBorder
                  role='button'
                  aria-label={k.aria}
                  onClick={() => filterByStatus(k.status)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: `var(--mantine-color-${k.color}-light)`,
                    borderColor: (applied.status || 'todas') === k.status ? `var(--mantine-color-${k.color}-filled)` : 'transparent',
                    borderWidth: 2,
                    transition: 'border-color 150ms ease',
                  }}
                  data-testid='bandeja-indicador'
                >
                  <Group wrap='nowrap'>
                    <k.icon size={24} color={`var(--mantine-color-${k.color}-light-color)`} />
                    <div>
                      <Text size='xs' c={`var(--mantine-color-${k.color}-light-color)`}>
                        {k.label}
                      </Text>
                      <Text size='lg' fw={600}>
                        {k.value}
                      </Text>
                      {k.sub && (
                        <Text size='xs' c='dimmed'>
                          {k.sub}
                        </Text>
                      )}
                    </div>
                  </Group>
                </Card>
              </Grid.Col>
            ))}
            <Grid.Col span={{ base: 10, sm: 5, md: 2 }}>
              <Card p='md' radius='md' withBorder>
                <Group wrap='nowrap'>
                  <RingProgress
                    size={56}
                    thickness={6}
                    roundCaps
                    sections={[{ value: progress, color: progress === 100 ? 'green' : 'blue' }]}
                    label={
                      <Text size='xs' ta='center' fw={700}>
                        {progress}%
                      </Text>
                    }
                  />
                  <div>
                    <Text size='xs' c='dimmed'>
                      Avance de tareas
                    </Text>
                    <Text size='lg' fw={600}>
                      {done}/{live}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
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
                  <Table.Th style={{ whiteSpace: 'nowrap', width: 1 }}>Tipo</Table.Th>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Nombre del documento</Table.Th>
                  <Table.Th>Proceso / Empresa</Table.Th>
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
                          No tienes elementos asignados con los filtros actuales
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
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Badge variant='filled' color='violet' size='sm' leftSection={<IconListCheck size={12} />} styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}>
                            Tarea
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' fw={700} c='var(--mantine-color-violet-light-color)'>
                            {task.idRequest}
                          </Text>
                          <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
                            Tarea #{task.idTask}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 240, maxWidth: 320 }}>
                          <Text size='sm' fw={600} lineClamp={2}>
                            {task.task}
                          </Text>
                          <Text size='xs' c='dimmed' lineClamp={2}>
                            {task.subject}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap='nowrap'>
                            <IconBuilding size={13} className='text-gray-400' />
                            <Text size='xs' c='dimmed'>
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
