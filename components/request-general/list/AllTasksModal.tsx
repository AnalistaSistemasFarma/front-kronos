'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertTriangle, IconSearch } from '@tabler/icons-react';
import { partitionTasksForDisplay } from '../../../lib/orion/taskProgress';
import { filterByText } from '../../../lib/requests-general/textSearch';

export interface GeneralTask {
  id: number;
  id_request_general: number;
  subject: string | null;
  company: string | null;
  task: string | null;
  id_status: number;
  status_task: string | null;
  resolution: string | null;
  date_resolution: string | null;
  assigned: string | null;
}

type View = 'all' | 'done' | 'open';

function isDone(t: GeneralTask): boolean {
  const s = String(t.status_task ?? '').toLowerCase();
  return t.id_status === 2 || s === 'resuelto' || s === 'completado';
}

const dateFormat = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

function formatDate(raw: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? String(raw) : dateFormat.format(d);
}

const statusColor = (t: GeneralTask) => {
  if (isDone(t)) return 'green';
  const s = String(t.status_task ?? '').toLowerCase();
  if (t.id_status === 3 || s.includes('cancel')) return 'gray';
  if (t.id_status === 4 || s === 'sin empezar') return 'gray';
  return 'orange';
};

export function AllTasksModal({
  opened,
  onClose,
  tasks,
  loading,
  error,
  truncated,
}: {
  opened: boolean;
  onClose: () => void;
  tasks: GeneralTask[] | null;
  loading: boolean;
  error: string | null;
  truncated: boolean;
}) {
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');

  const flowTasks = useMemo(
    () => partitionTasksForDisplay(tasks ?? []).businessTasks,
    [tasks]
  );
  const doneCount = useMemo(() => flowTasks.filter(isDone).length, [flowTasks]);
  const total = flowTasks.length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  const visible = useMemo(() => {
    const byView = flowTasks.filter((t) =>
      view === 'all' ? true : view === 'done' ? isDone(t) : !isDone(t)
    );
    return filterByText(byView, search, (t) => [
      t.id_request_general,
      t.subject,
      t.company,
      t.task,
      t.assigned,
      t.status_task,
    ]);
  }, [flowTasks, view, search]);

  const openRequest = (id: number) =>
    window.open(`/process/request-general/view-request?id=${id}&from=general-requests`);

  return (
    <Modal opened={opened} onClose={onClose} title='Avance de tareas' size='90%' centered>
      {error ? (
        <Alert color='red' icon={<IconAlertTriangle size={16} />} mb='sm'>
          {error}
        </Alert>
      ) : null}
      {truncated ? (
        <Alert color='yellow' icon={<IconAlertTriangle size={16} />} mb='sm'>
          Hay demasiadas tareas para mostrarlas todas. Afina los filtros para ver el conjunto completo.
        </Alert>
      ) : null}

      {tasks === null && loading ? (
        <Group justify='center' py='xl' gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando todas las tareas...</Text>
        </Group>
      ) : (
        <>
          <Group justify='space-between' align='flex-end' mb='xs' wrap='wrap' gap='sm'>
            <div style={{ minWidth: 220, flex: '1 1 260px' }}>
              <Group gap={6} mb={4}>
                <Text size='sm' fw={600}>
                  {doneCount} de {total} completadas ({percent}%)
                </Text>
                {loading ? <Loader size='xs' /> : null}
              </Group>
              <Progress value={percent} color={percent === 100 ? 'green' : 'blue'} radius='xl' />
            </div>
            <SegmentedControl
              value={view}
              onChange={(v) => setView(v as View)}
              data={[
                { value: 'all', label: `Todas (${total})` },
                { value: 'done', label: `Completadas (${doneCount})` },
                { value: 'open', label: `Sin completar (${total - doneCount})` },
              ]}
            />
          </Group>

          <TextInput
            placeholder='Buscar por solicitud, asunto, empresa, tarea o responsable'
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            mb='sm'
          />

          <ScrollArea.Autosize mah='60vh'>
            <Table striped highlightOnHover stickyHeader withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Solicitud</Table.Th>
                  <Table.Th>Tarea</Table.Th>
                  <Table.Th>Responsable</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Completada</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text size='sm' c='dimmed' ta='center' py='md'>
                        No hay tareas para mostrar.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  visible.map((t) => {
                    const done = isDone(t);
                    return (
                      <Table.Tr
                        key={t.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => openRequest(t.id_request_general)}
                      >
                        <Table.Td style={{ minWidth: 200, maxWidth: 320 }}>
                          <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                            #{t.id_request_general}
                          </Text>
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {t.subject || '-'}
                            {t.company ? ` · ${t.company}` : ''}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{t.task || '-'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' c={t.assigned ? undefined : 'dimmed'}>
                            {t.assigned || 'Sin asignar'}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Badge variant='light' size='sm' color={statusColor(t)} style={{ textTransform: 'none' }}>
                            {t.status_task || 'Pendiente'}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          {done ? (
                            <Text size='sm'>{formatDate(t.date_resolution) || 'Sin fecha'}</Text>
                          ) : (
                            <Text size='sm' c='dimmed'>
                              —
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Text size='xs' c='dimmed' mt='xs'>
            {visible.length} tarea(s) · Clic en una fila para abrir la solicitud. No incluye las tareas de
            firma de documentos.
          </Text>
        </>
      )}
    </Modal>
  );
}
