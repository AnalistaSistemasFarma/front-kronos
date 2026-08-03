'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Breadcrumbs,
  Card,
  Grid,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Anchor,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconChevronRight,
  IconClipboardList,
  IconListDetails,
  IconProgress,
  IconSearch,
} from '@tabler/icons-react';

export type DashboardCounts = {
  total: number;
  abierto: number;
  enProgreso: number;
  resuelto: number;
  cancelado: number;
  otros: number;
};

export type DashboardRequestRow = {
  id: number;
  subject?: string;
  description?: string;
  created_at?: string;
  date_resolution?: string | null;
  status?: string;
  company?: string;
  category?: string;
  process?: string;
  requester?: string;
  assigned_user?: string;
  executor_final?: string;
};

export type DashboardActivityRow = {
  id: number;
  id_request_general?: number;
  task?: string;
  status_task?: string;
  assigned?: string;
  requester?: string;
  subject?: string;
  company?: string;
  process?: string;
  category?: string;
  start_date?: string | null;
  date_resolution?: string | null;
};

type Props = {
  kind: 'solicitante' | 'solicitado';
  title: string;
  subtitle: string;
  requests: DashboardRequestRow[];
  activities: DashboardActivityRow[];
  requestCounts: DashboardCounts;
  activityCounts: DashboardCounts;
};

function statusColor(status?: string) {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('resuelt') || s.includes('complet')) return 'green';
  if (s.includes('abiert') || s.includes('sin empezar')) return 'orange';
  if (s.includes('progreso') || s.includes('proceso')) return 'blue';
  if (s.includes('cancel') || s.includes('cerrad')) return 'gray';
  return 'gray';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO');
}

function KpiCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: ReactNode;
}) {
  return (
    <Card p='md' radius='md' withBorder style={{ backgroundColor: `var(--mantine-color-${color}-light)` }}>
      <Group>
        {icon}
        <div>
          <Text size='xs' c={`var(--mantine-color-${color}-light-color)`}>
            {label}
          </Text>
          <Text size='lg' fw={700}>
            {value}
          </Text>
        </div>
      </Group>
    </Card>
  );
}

export function RequestRoleDashboard({
  kind,
  title,
  subtitle,
  requests,
  activities,
  requestCounts,
  activityCounts,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'requests' | 'activities'>('requests');
  const [search, setSearch] = useState('');

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) =>
      [r.id, r.subject, r.process, r.category, r.company, r.status, r.requester, r.assigned_user]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [requests, search]);

  const filteredActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) =>
      [a.id, a.task, a.subject, a.process, a.company, a.status_task, a.assigned, a.requester]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [activities, search]);

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Solicitudes', href: '#' },
    { title, href: '#' },
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

  const counts = tab === 'requests' ? requestCounts : activityCounts;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb='md'>
            {breadcrumbItems}
          </Breadcrumbs>
          <Title order={1} mb={4}>
            {title}
          </Title>
          <Text c='dimmed'>{subtitle}</Text>
        </Card>

        <Grid mb='md'>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <KpiCard
              label={tab === 'requests' ? 'Total procesos' : 'Total actividades'}
              value={counts.total}
              color='blue'
              icon={<IconClipboardList size={22} color='var(--mantine-color-blue-light-color)' />}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <KpiCard
              label='Abiertos'
              value={counts.abierto}
              color='orange'
              icon={<IconProgress size={22} color='var(--mantine-color-orange-light-color)' />}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <KpiCard
              label='En progreso'
              value={counts.enProgreso}
              color='cyan'
              icon={<IconListDetails size={22} color='var(--mantine-color-cyan-light-color)' />}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <KpiCard
              label='Resueltos'
              value={counts.resuelto}
              color='green'
              icon={<IconCheck size={22} color='var(--mantine-color-green-light-color)' />}
            />
          </Grid.Col>
        </Grid>

        <Paper shadow='sm' p='md' radius='md' withBorder mb='md'>
          <Group justify='space-between' mb='md' wrap='wrap'>
            <SegmentedControl
              value={tab}
              onChange={(v) => setTab(v as 'requests' | 'activities')}
              data={[
                { label: 'Procesos / Solicitudes', value: 'requests' },
                { label: 'Actividades', value: 'activities' },
              ]}
            />
            <TextInput
              placeholder='Buscar...'
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              style={{ minWidth: 240 }}
            />
          </Group>

          {tab === 'requests' ? (
            filteredRequests.length === 0 ? (
              <Alert icon={<IconAlertCircle size={16} />} color='gray'>
                No hay procesos para mostrar.
              </Alert>
            ) : (
              <div className='overflow-x-auto'>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>ID</Table.Th>
                      <Table.Th>Asunto</Table.Th>
                      <Table.Th>Proceso</Table.Th>
                      <Table.Th>Empresa</Table.Th>
                      <Table.Th>{kind === 'solicitante' ? 'Asignado' : 'Solicitante'}</Table.Th>
                      <Table.Th>Estado</Table.Th>
                      <Table.Th>Creación</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredRequests.map((row) => (
                      <Table.Tr
                        key={row.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          router.push(`/process/request-general/view-request?id=${row.id}`)
                        }
                      >
                        <Table.Td>
                          <Badge variant='light'>#{row.id}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text fw={500} lineClamp={1}>
                            {row.subject || 'Sin asunto'}
                          </Text>
                        </Table.Td>
                        <Table.Td>{row.process || '—'}</Table.Td>
                        <Table.Td>{row.company || '—'}</Table.Td>
                        <Table.Td>
                          {kind === 'solicitante'
                            ? row.assigned_user || '—'
                            : row.requester || '—'}
                        </Table.Td>
                        <Table.Td>
                          <Badge color={statusColor(row.status)} variant='light'>
                            {row.status || '—'}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{formatDate(row.created_at)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )
          ) : filteredActivities.length === 0 ? (
            <Alert icon={<IconAlertCircle size={16} />} color='gray'>
              No hay actividades para mostrar.
            </Alert>
          ) : (
            <div className='overflow-x-auto'>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>ID</Table.Th>
                    <Table.Th>Actividad</Table.Th>
                    <Table.Th>Solicitud</Table.Th>
                    <Table.Th>Proceso</Table.Th>
                    <Table.Th>{kind === 'solicitante' ? 'Asignado' : 'Solicitante'}</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Inicio</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredActivities.map((row) => (
                    <Table.Tr
                      key={row.id}
                      style={{ cursor: 'pointer' }}
                        onClick={() =>
                          router.push(`/process/request-general/view-activities?id=${row.id}`)
                        }
                    >
                      <Table.Td>
                        <Badge variant='light'>#{row.id}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={500} lineClamp={1}>
                          {row.task || 'Sin actividad'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text size='sm'>#{row.id_request_general}</Text>
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {row.subject || '—'}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>{row.process || '—'}</Table.Td>
                      <Table.Td>
                        {kind === 'solicitante' ? row.assigned || '—' : row.requester || '—'}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={statusColor(row.status_task)} variant='light'>
                          {row.status_task || '—'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{formatDate(row.start_date)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}
        </Paper>
      </div>
    </div>
  );
}
