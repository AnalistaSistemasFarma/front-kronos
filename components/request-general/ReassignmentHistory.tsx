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
  Modal,
  Paper,
  SegmentedControl,
  Spoiler,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core';
import toast from 'react-hot-toast';
import {
  IconAlertCircle,
  IconArrowBack,
  IconArrowBackUp,
  IconArrowRight,
  IconCheck,
  IconCalendarEvent,
  IconHistory,
  IconRefresh,
  IconUser,
} from '@tabler/icons-react';
import IosSearchField from '../ui/IosSearchField';
import { filterByText } from '../../lib/requests-general/textSearch';

const HISTORY_URL = '/api/requests-general/reassignment-workflow-request/history';
const REVERT_URL = '/api/requests-general/reassignment-workflow-request/revert';
/** Hora del job 'reassignment_auto_return' del programador central (cron «0 6 * * *»). */
const AUTO_RETURN_HOUR = '6:00 a. m.';

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
  /** 1 si tiene detalle en workflow_task_reassignment_detail (se puede deshacer). */
  has_detail?: number | boolean | null;
}

type ReturnState = 'none' | 'pending' | 'overdue' | 'returned' | 'undone' | 'inactive';
type StateFilter = 'all' | 'pending' | 'returned' | 'none';

interface RevertItem {
  type: 'workflow' | 'task' | 'template_task';
  id: number;
  title: string;
  to?: string;
  reason?: string;
}

interface RevertPreview {
  back: { workflows: number; tasks: number; templates?: number };
  items: RevertItem[];
  skipped: RevertItem[];
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function returnState(log: ReassignmentLog, today = todayIso()): ReturnState {
  if (log.returned_at) return log.date_to_return ? 'returned' : 'undone';
  if (log.active === 0 || log.active === false) return 'inactive';
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
    case 'undone':
      return (
        <Badge color='orange' {...props}>
          Deshecha {log.returned_at ? formatDay(log.returned_at) : ''}
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

const canRevert = (log: ReassignmentLog) => {
  const s = returnState(log);
  return s === 'none' || s === 'pending' || s === 'overdue';
};

function RevertAction({
  log,
  fullWidth,
  onClick,
}: {
  log: ReassignmentLog;
  fullWidth?: boolean;
  onClick: () => void;
}) {
  if (!canRevert(log)) return null;
  if (!log.has_detail) {
    return (
      <Text size='xs' c='dimmed'>
        No se puede deshacer (registro anterior)
      </Text>
    );
  }
  const isReturn = Boolean(log.date_to_return);
  const overdue = returnState(log) === 'overdue';
  return (
    <Stack gap={4} w={fullWidth ? '100%' : undefined}>
      {isReturn && (
        <Text size='xs' c={overdue ? 'red' : 'dimmed'}>
          {overdue
            ? 'Pendiente del retorno automático'
            : `Se retornará automáticamente el ${formatDay(log.date_to_return!)} a las ${AUTO_RETURN_HOUR}`}
        </Text>
      )}
      <RevertButton isReturn={isReturn} overdue={overdue} fullWidth={fullWidth} onClick={onClick} />
    </Stack>
  );
}

function RevertButton({
  isReturn,
  overdue,
  fullWidth,
  onClick,
}: {
  isReturn: boolean;
  overdue: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size='xs'
      variant={overdue ? 'filled' : 'light'}
      color={isReturn ? 'blue' : 'orange'}
      leftSection={isReturn ? <IconArrowBackUp size={14} /> : <IconArrowBack size={14} />}
      fullWidth={fullWidth}
      onClick={onClick}
    >
      {isReturn ? 'Retornar ahora' : 'Deshacer'}
    </Button>
  );
}

const TYPE_META: Record<RevertItem['type'], { label: string; color: string }> = {
  workflow: { label: 'Flujo', color: 'teal' },
  task: { label: 'Tarea', color: 'violet' },
  template_task: { label: 'Tareas futuras', color: 'blue' },
};

function RevertModal({
  log,
  isMobile,
  onClose,
  onDone,
}: {
  log: ReassignmentLog | null;
  isMobile: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<RevertPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const isReturn = Boolean(log?.date_to_return);
  const logId = log?.id ?? null;

  useEffect(() => {
    setPreview(null);
    setError(null);
    setReason(isReturn ? 'Retorno programado de la reasignación temporal' : '');
    if (logId == null) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(REVERT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: logId, dryRun: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'No se pudo calcular qué se devolverá');
        if (!cancelled) setPreview(data.preview as RevertPreview);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo calcular qué se devolverá');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logId, isReturn]);

  const total = preview ? preview.back.workflows + preview.back.tasks + (preview.back.templates ?? 0) : 0;

  const submit = async () => {
    if (!log || !reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(REVERT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: log.id, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo completar');
      const back = data?.reverted ?? { workflows: 0, tasks: 0 };
      const skipped = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      toast.success(
        `${isReturn ? 'Retornado' : 'Deshecho'}: ${back.workflows} flujo(s) y ${back.tasks} tarea(s) devueltos` +
          (back.templates ? ` · las tareas nuevas de ${back.templates} plantilla(s) vuelven a su responsable` : '') +
          (skipped ? ` · ${skipped} no se pudieron devolver (ver historial)` : ''),
        { duration: 7000 }
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar');
    } finally {
      setSaving(false);
    }
  };

  const renderList = (items: RevertItem[], withReason: boolean) => (
    <Stack gap={4} mah={isMobile ? 220 : 200} style={{ overflowY: 'auto' }}>
      {items.map((i) => (
        <Box key={`${i.type}-${i.id}`}>
          <Text size='sm' lineClamp={2}>
            <Badge size='xs' variant='light' color={TYPE_META[i.type]?.color ?? 'gray'} mr={6}>
              {TYPE_META[i.type]?.label ?? 'Elemento'}
            </Badge>
            {i.title}
            {!withReason && i.to ? (
              <Text span size='sm' c='dimmed'>
                {' '}
                → {i.to}
              </Text>
            ) : null}
          </Text>
          {withReason && i.reason ? (
            <Text size='xs' c='dimmed' ml={4}>
              {i.reason}
            </Text>
          ) : null}
        </Box>
      ))}
    </Stack>
  );

  return (
    <Modal
      opened={log != null}
      onClose={() => !saving && onClose()}
      title={
        <Group gap='sm' wrap='nowrap'>
          {isReturn ? <IconArrowBackUp size={20} /> : <IconArrowBack size={20} />}
          <Text fw={600}>
            {isReturn ? 'Retornar' : 'Deshacer'} reasignación #{log?.id}
          </Text>
        </Group>
      }
      radius={isMobile ? 0 : 'lg'}
      size='lg'
      centered
      fullScreen={isMobile}
      overlayProps={{ blur: 4 }}
    >
      {log && (
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Devuelve los flujos y tareas a quien los tenía antes de la reasignación (de{' '}
            <b>{log.user_new_name || 'quien recibió'}</b> a <b>{log.user_removed_name || 'quien los tenía'}</b>
            ). Solo se devuelve lo que sigue tal como quedó; lo que cambió después se omite.
          </Text>

          {loading ? (
            <Group gap='xs'>
              <Loader size='xs' />
              <Text size='sm' c='dimmed'>
                Revisando qué se puede devolver...
              </Text>
            </Group>
          ) : preview ? (
            <>
              <Paper withBorder radius='md' p='sm'>
                <Group gap='xs' mb={total ? 'xs' : 0}>
                  <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                    Vuelve
                  </Text>
                  <Badge variant='light' color={preview.back.workflows ? 'teal' : 'gray'}>
                    {preview.back.workflows} flujo(s)
                  </Badge>
                  <Badge variant='light' color={preview.back.tasks ? 'violet' : 'gray'}>
                    {preview.back.tasks} tarea(s)
                  </Badge>
                  {(preview.back.templates ?? 0) > 0 && (
                    <Badge variant='light' color='blue'>
                      {preview.back.templates} tarea(s) futura(s)
                    </Badge>
                  )}
                </Group>
                {total > 0 ? (
                  <>
                    {renderList(preview.items, false)}
                    {preview.back.workflows > 0 && (
                      <Text size='xs' c='dimmed' mt='xs'>
                        Las solicitudes abiertas de esos flujos vuelven con su líder.
                      </Text>
                    )}
                    {(preview.back.templates ?? 0) > 0 && (
                      <Text size='xs' c='dimmed' mt={4}>
                        Las tareas que se creen desde ahora volverán a asignarse según la plantilla del flujo.
                      </Text>
                    )}
                  </>
                ) : (
                  <Text size='sm' c='dimmed'>
                    No hay nada que se pueda devolver.
                  </Text>
                )}
              </Paper>

              {preview.skipped.length > 0 && (
                <Alert icon={<IconAlertCircle size={16} />} color='yellow' radius='md' p='sm'>
                  <Text size='sm' fw={600} mb={4}>
                    No se devolverá ({preview.skipped.length})
                  </Text>
                  {renderList(preview.skipped, true)}
                </Alert>
              )}
            </>
          ) : null}

          <Textarea
            label='Motivo'
            description={isReturn ? 'Por qué se retorna' : 'Por qué se deshace la reasignación'}
            placeholder='Ej. Se reasignó a la persona equivocada'
            required
            autosize
            minRows={2}
            maxRows={6}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md'>
              {error}
            </Alert>
          )}

          <Group justify='flex-end' gap='sm' grow={isMobile}>
            <Button variant='outline' onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              color={isReturn ? 'blue' : 'orange'}
              leftSection={<IconCheck size={16} />}
              onClick={() => void submit()}
              loading={saving}
              disabled={loading || total === 0 || !reason.trim()}
            >
              {isReturn ? 'Retornar' : 'Deshacer'}
              {total ? ` (${total})` : ''}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export default function ReassignmentHistory({
  departmentIds,
  refreshKey,
  isMobile,
  onReverted,
}: {
  departmentIds: number[];
  refreshKey: number;
  isMobile: boolean;
  onReverted?: () => void;
}) {
  const [revertLog, setRevertLog] = useState<ReassignmentLog | null>(null);
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
      if (stateFilter === 'returned') return s === 'returned' || s === 'undone';
      if (stateFilter === 'none') return s === 'none';
      return true;
    });
    byState.sort((a, b) => Number(returnState(b) === 'overdue') - Number(returnState(a) === 'overdue'));
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
            { value: 'returned', label: 'Retornadas / deshechas' },
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
              <Box mt='xs'>
                <RevertAction log={log} fullWidth onClick={() => setRevertLog(log)} />
              </Box>
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
                <Table.Th w={190}>Estado</Table.Th>
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
                    <Stack gap={6} align='flex-start'>
                      <StateBadge log={log} />
                      <RevertAction log={log} onClick={() => setRevertLog(log)} />
                    </Stack>
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

      <RevertModal
        log={revertLog}
        isMobile={isMobile}
        onClose={() => setRevertLog(null)}
        onDone={() => {
          setRevertLog(null);
          void load();
          onReverted?.();
        }}
      />
    </Card>
  );
}
