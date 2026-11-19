'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Spoiler,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowRight,
  IconCalendarEvent,
  IconHistory,
  IconRefresh,
  IconUser,
} from '@tabler/icons-react';
import IosSearchField from '../ui/IosSearchField';
import { filterByText } from '../../lib/requests-general/textSearch';

const HISTORY_URL = '/api/requests-general/reassignment-workflow-request/history';

export interface ReassignmentLog {
  id: number;
  reason: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  user_removed: string | null;
  user_removed_name: string | null;
  user_new: string | null;
  user_new_name: string | null;
  date_to_return: string | null;
  returned_at: string | null;
  active: number | boolean | null;
}

type ReturnState = 'none' | 'pending' | 'overdue' | 'returned' | 'inactive';
type StateFilter = 'all' | 'pending' | 'returned' | 'none';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function returnState(log: ReassignmentLog, today = todayIso()): ReturnState {
  if (log.active === 0 || log.active === false) return 'inactive';
  if (log.returned_at) return 'returned';
  if (!log.date_to_return) return 'none';
  return log.date_to_return < today ? 'overdue' : 'pending';
}

const formatDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const formatDateTime = (raw: string) => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
};

function StateBadge({ log }: { log: ReassignmentLog }) {
  const state = returnState(log);
  const props = { variant: 'light' as const, styles: { root: { textTransform: 'none' as const } } };
  switch (state) {
    case 'inactive':
      return <Badge color='gray' {...props}>Inactiva</Badge>;
    case 'returned':
      return (
        <Badge color='green' {...props}>
          Retornada {log.returned_at ? formatDay(log.returned_at) : ''}
        </Badge>
      );
    case 'overdue':
      return (
        <Badge color='red' {...props}>
          Retorno vencido ({formatDay(log.date_to_return!)})
        </Badge>
      );
    case 'pending':
      return (
        <Badge color='blue' leftSection={<IconCalendarEvent size={12} />} {...props}>
          Retorna el {formatDay(log.date_to_return!)}
        </Badge>
      );
    default:
      return <Badge color='gray' variant='outline' styles={props.styles}>Sin retorno</Badge>;
  }
}

function People({ log }: { log: ReassignmentLog }) {
  return (
    <Group gap={6} wrap='wrap'>
      <Text size='sm' fw={600}>
        {log.user_removed_name || 'Sin asignar'}
      </Text>
      <IconArrowRight size={14} />
      <Text size='sm' fw={600} c='blue'>
        {log.user_new_name || log.user_new || '—'}
      </Text>
    </Group>
  );
}

function Reason({ text }: { text: string }) {
  return (
    <Spoiler maxHeight={66} showLabel='Ver todo' hideLabel='Ver menos' styles={{ control: { fontSize: 12 } }}>
      <Text size='sm' style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </Text>
    </Spoiler>
  );
}

export default function ReassignmentHistory({
  departmentIds,
  refreshKey,
  isMobile,
}: {
  departmentIds: number[];
  refreshKey: number;
  isMobile: boolean;
}) {
  const [logs, setLogs] = useState<ReassignmentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const deferredSearch = useDeferredValue(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(HISTORY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: departmentIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar el historial');
      setLogs(Array.isArray(data?.history) ? data.history : []);
    } catch (err) {
      console.error('Error cargando historial de reasignaciones:', err);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
  }, [departmentIds]);

  useEffect(() => {
    if (departmentIds.length) void load();
  }, [load, refreshKey, departmentIds.length]);

  const visible = useMemo(() => {
    const byState = logs.filter((log) => {
      const s = returnState(log);
      if (stateFilter === 'pending') return s === 'pending' || s === 'overdue';
      if (stateFilter === 'returned') return s === 'returned';
      if (stateFilter === 'none') return s === 'none';
      return true;
    });
    return filterByText(byState, deferredSearch, (log) => [
      log.id,
      log.reason,
      log.created_by_name,
      log.user_removed_name,
      log.user_new_name,
    ]);
  }, [logs, stateFilter, deferredSearch]);

  const pendingCount = logs.filter((l) => {
    const s = returnState(l);
    return s === 'pending' || s === 'overdue';
  }).length;

  return (
    <Card withBorder radius='lg' p={isMobile ? 'sm' : 'lg'} mt='md'>
      <Group justify='space-between' align='flex-start' mb='md' gap='sm'>
        <Group gap='xs'>
          <IconHistory size={20} />
          <Text fw={700}>Historial de reasignaciones</Text>
          <Badge variant='light' color='gray'>
            {logs.length}
          </Badge>
          {pendingCount > 0 && (
            <Badge variant='light' color='blue'>
              {pendingCount} con retorno pendiente
            </Badge>
          )}
        </Group>
        <Button
          size='xs'
          variant='subtle'
          leftSection={<IconRefresh size={14} />}
          onClick={() => void load()}
          loading={loading}
        >
          Actualizar
        </Button>
      </Group>

      <Stack gap='sm' mb='md'>
        <SegmentedControl
          fullWidth={isMobile}
          value={stateFilter}
          onChange={(v) => setStateFilter(v as StateFilter)}
          data={[
            { value: 'all', label: 'Todas' },
            { value: 'pending', label: 'Por retornar' },
            { value: 'returned', label: 'Retornadas' },
            { value: 'none', label: 'Sin retorno' },
          ]}
        />
        <IosSearchField
          value={search}
          onChange={setSearch}
          placeholder='Buscar persona, motivo, flujo, solicitud o tarea'
          ariaLabel='Buscar en el historial de reasignaciones'
          meta={search || stateFilter !== 'all' ? `${visible.length} de ${logs.length} coinciden` : undefined}
        />
      </Stack>

      {error ? (
        <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md'>
          {error}
        </Alert>
      ) : loading && logs.length === 0 ? (
        <Group gap='sm' justify='center' py='xl'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando historial...</Text>
        </Group>
      ) : visible.length === 0 ? (
        <Text c='dimmed' ta='center' py='xl'>
          {logs.length === 0 ? 'Todavía no hay reasignaciones registradas.' : 'Ninguna reasignación coincide.'}
        </Text>
      ) : isMobile ? (
        <Stack gap='sm'>
          {visible.map((log) => (
            <Paper key={log.id} withBorder radius='md' p='sm'>
              <Group justify='space-between' gap='xs' mb={6}>
                <Text size='xs' c='dimmed'>
                  #{log.id} · {formatDateTime(log.created_at)}
                </Text>
                <StateBadge log={log} />
              </Group>
              <People log={log} />
              <Group gap={4} mt={4} mb='xs'>
                <IconUser size={12} />
                <Text size='xs' c='dimmed'>
                  Realizada por {log.created_by_name || log.created_by || '—'}
                </Text>
              </Group>
              <Reason text={log.reason} />
            </Paper>
          ))}
        </Stack>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table verticalSpacing='sm' highlightOnHover striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={150}>Fecha</Table.Th>
                <Table.Th w={260}>De → A</Table.Th>
                <Table.Th w={170}>Realizada por</Table.Th>
                <Table.Th w={170}>Retorno</Table.Th>
                <Table.Th>Motivo y detalle</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((log) => (
                <Table.Tr key={log.id} style={{ verticalAlign: 'top' }}>
                  <Table.Td>
                    <Text size='sm'>{formatDateTime(log.created_at)}</Text>
                    <Text size='xs' c='dimmed'>
                      #{log.id}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <People log={log} />
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{log.created_by_name || log.created_by || '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <StateBadge log={log} />
                  </Table.Td>
                  <Table.Td>
                    <Reason text={log.reason} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Card>
  );
}
