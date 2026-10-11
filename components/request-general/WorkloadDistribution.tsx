'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowsShuffle,
  IconCheck,
  IconLock,
  IconUsersGroup,
} from '@tabler/icons-react';

interface MemberLoad {
  id: string;
  name: string;
  email: string | null;
  openTasks: number;
  percent: number;
}

interface WorkloadTaskRow {
  id: number;
  id_assigned: string;
  id_status: number;
  status_task: string;
  task: string;
  id_process_category: number | null;
  process: string | null;
  category: string | null;
  id_request_general: number;
  subject_request: string | null;
  company: string | null;
  start_date: string | null;
  is_authorization: boolean;
  is_signature?: boolean;
  id_requester?: string | null;
  reassignable: boolean;
}

interface WorkloadResponse {
  isResponsible: boolean;
  actorId?: string;
  departments?: { id: number; name: string }[];
  total?: number;
  members?: MemberLoad[];
  tasks?: WorkloadTaskRow[];
}

const REJECTION_TEXT: Record<string, string> = {
  NOT_FOUND: 'no existe',
  CLOSED: 'ya está cerrada',
  REQUEST_NOT_OWNED: 'es de una solicitud de la que no eres responsable',
  SIGNATURE_AUTHORIZATION: 'es una autorización de firma (va ligada al firmante)',
  SELF_APPROVAL_REQUESTER: 'es una autorización y el destino es el solicitante (autoaprobación)',
  SELF_APPROVAL_ACTOR: 'es una autorización y no puedes asignártela a ti mismo',
  ASSIGNEE_OUTSIDE_AREA: 'su responsable actual no es de tu área',
  SAME_ASSIGNEE: 'ya está asignada a esa persona',
};

function loadColor(percent: number, fairShare: number) {
  if (fairShare <= 0) return 'blue';
  if (percent >= fairShare * 1.5) return 'red';
  if (percent >= fairShare * 1.15) return 'orange';
  return 'teal';
}

/**
 * Botón «Distribuir carga» + panel. Solo se muestra si el servidor confirma que la
 * persona es responsable de al menos una solicitud con tareas abiertas y tiene
 * compañeros activos en su departamento.
 */
export default function WorkloadDistribution({ onReassigned }: { onReassigned?: () => void }) {
  const [data, setData] = useState<WorkloadResponse | null>(null);
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processFilter, setProcessFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/requests-general/workload-distribution', { cache: 'no-store' });
      if (res.status === 401) {
        setData({ isResponsible: false });
        return;
      }
      const json = (await res.json()) as WorkloadResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || 'No se pudo calcular la carga');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular la carga');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const members = useMemo(() => data?.members ?? [], [data]);
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const fairShare = members.length ? 100 / members.length : 0;

  const processOptions = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach((t) => {
      if (t.id_process_category != null)
        seen.set(String(t.id_process_category), `${t.process ?? 'Proceso'}${t.category ? ` · ${t.category}` : ''}`);
    });
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [tasks]);
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    tasks.forEach((t) => seen.set(String(t.id_status), t.status_task));
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [tasks]);

  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!processFilter || String(t.id_process_category) === processFilter) &&
          (!statusFilter || String(t.id_status) === statusFilter) &&
          (!personFilter || t.id_assigned === personFilter)
      ),
    [tasks, processFilter, statusFilter, personFilter]
  );

  /** La carga respeta los filtros de proceso y estado para comparar por proceso. */
  const filteredLoad = useMemo(() => {
    const base = tasks.filter(
      (t) =>
        (!processFilter || String(t.id_process_category) === processFilter) &&
        (!statusFilter || String(t.id_status) === statusFilter)
    );
    const total = base.length;
    return {
      total,
      members: members
        .map((m) => {
          const openTasks = base.filter((t) => t.id_assigned === m.id).length;
          return { ...m, openTasks, percent: total ? Math.round((openTasks / total) * 1000) / 10 : 0 };
        })
        .sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name, 'es')),
    };
  }, [tasks, members, processFilter, statusFilter]);

  const selectable = filteredTasks.filter((t) => t.reassignable);
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));
  const selectedTasks = tasks.filter((t) => selected.has(t.id));
  const targetOptions = members.map((m) => ({ value: m.id, label: `${m.name} · ${m.percent}%` }));
  const sameTarget = toUserId != null && selectedTasks.some((t) => t.id_assigned === toUserId);
  // Autorizaciones: nunca al solicitante (autoaprobación) ni a quien reasigna. El servidor lo vuelve a validar.
  const selfApproval =
    toUserId != null &&
    selectedTasks.some((t) => t.is_authorization && (t.id_requester === toUserId || toUserId === data?.actorId));
  const invalidTarget = sameTarget || selfApproval;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllOfPerson = (personId: string) => {
    setPersonFilter(personId);
    setSelected(new Set(tasks.filter((t) => t.id_assigned === personId && t.reassignable && (!processFilter || String(t.id_process_category) === processFilter) && (!statusFilter || String(t.id_status) === statusFilter)).map((t) => t.id)));
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/requests-general/workload-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: [...selected], toUserId, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(json.rejected)
          ? ' ' + json.rejected.map((r: { id: number; reason: string }) => `#${r.id} ${REJECTION_TEXT[r.reason] ?? r.reason}`).join('; ')
          : '';
        throw new Error((json.error || 'No se pudo reasignar') + detail);
      }
      setSuccess(`Se reasignaron ${json.reassigned} tareas a ${memberName.get(toUserId ?? '') ?? 'la persona seleccionada'}.`);
      setSelected(new Set());
      setReason('');
      setConfirming(false);
      await load();
      onReassigned?.();
    } catch (e) {
      setConfirming(false);
      setError(e instanceof Error ? e.message : 'No se pudo reasignar');
    } finally {
      setSaving(false);
    }
  };

  if (!data?.isResponsible) return null;

  return (
    <>
      <Button
        leftSection={<IconArrowsShuffle size={18} />}
        variant='light'
        onClick={() => {
          setSuccess(null);
          setOpened(true);
          void load();
        }}
        data-testid='workload-open'
      >
        Distribuir carga
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        size='90%'
        radius='md'
        title={
          <Group gap='xs'>
            <IconUsersGroup size={22} />
            <Text fw={600} size='lg'>
              Distribución de carga
            </Text>
          </Group>
        }
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Tareas abiertas de las personas de {data.departments?.map((d) => d.name).join(', ')} en todos los procesos.
            El porcentaje es la parte de las tareas abiertas del área que tiene cada persona. Solo puedes reasignar tareas de
            las solicitudes de las que eres responsable; las demás aparecen con candado.
          </Text>

          {error && (
            <Alert color='red' icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert color='teal' icon={<IconCheck size={18} />} withCloseButton onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          <Group grow align='flex-end'>
            <Select label='Proceso' placeholder='Todos los procesos' data={processOptions} value={processFilter} onChange={setProcessFilter} clearable searchable />
            <Select label='Estado' placeholder='Todos los estados abiertos' data={statusOptions} value={statusFilter} onChange={setStatusFilter} clearable />
            <Select
              label='Persona'
              placeholder='Todas las personas'
              data={members.map((m) => ({ value: m.id, label: m.name }))}
              value={personFilter}
              onChange={setPersonFilter}
              clearable
              searchable
            />
          </Group>

          <Paper withBorder radius='md' p='md'>
            <Group justify='space-between' mb='xs'>
              <Text fw={600}>Carga por persona</Text>
              <Text size='sm' c='dimmed'>
                {filteredLoad.total} tareas abiertas · {members.length} personas
              </Text>
            </Group>
            {loading && !data.members ? (
              <Loader size='sm' />
            ) : (
              <Table verticalSpacing='xs' highlightOnHover data-testid='workload-members'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Persona</Table.Th>
                    <Table.Th style={{ width: 110 }}>Abiertas</Table.Th>
                    <Table.Th>% de carga</Table.Th>
                    <Table.Th style={{ width: 170 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredLoad.members.map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>
                        <Text size='sm' fw={500}>
                          {m.name}
                          {m.id === data.actorId ? ' (tú)' : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>{m.openTasks}</Table.Td>
                      <Table.Td>
                        <Group gap='xs' wrap='nowrap'>
                          <Progress value={m.percent} color={loadColor(m.percent, fairShare)} style={{ flex: 1 }} size='lg' radius='sm' />
                          <Text size='sm' w={52} ta='right'>
                            {m.percent}%
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Button size='xs' variant='subtle' disabled={m.openTasks === 0} onClick={() => selectAllOfPerson(m.id)}>
                          Seleccionar sus tareas
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>

          <Paper withBorder radius='md' p='md'>
            <Group justify='space-between' mb='xs'>
              <Text fw={600}>Tareas abiertas ({filteredTasks.length})</Text>
              <Badge variant='light'>{selected.size} seleccionadas</Badge>
            </Group>
            <ScrollArea h={320}>
              <Table verticalSpacing='xs' striped highlightOnHover stickyHeader data-testid='workload-tasks'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 40 }}>
                      <Checkbox
                        aria-label='Seleccionar todas las tareas reasignables'
                        checked={allSelected}
                        indeterminate={!allSelected && selectable.some((t) => selected.has(t.id))}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            selectable.forEach((t) => (allSelected ? next.delete(t.id) : next.add(t.id)));
                            return next;
                          })
                        }
                      />
                    </Table.Th>
                    <Table.Th>Tarea</Table.Th>
                    <Table.Th>Solicitud</Table.Th>
                    <Table.Th>Proceso</Table.Th>
                    <Table.Th>Responsable</Table.Th>
                    <Table.Th>Estado</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredTasks.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td>
                        {t.reassignable ? (
                          <Checkbox aria-label={`Seleccionar tarea ${t.id}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                        ) : (
                          <Tooltip label={t.is_signature ? 'Autorización de firma: va ligada al firmante' : 'Solicitud de la que no eres responsable'}>
                            <IconLock size={16} color='var(--mantine-color-dimmed)' />
                          </Tooltip>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap='nowrap'>
                          <Text size='sm'>{t.task}</Text>
                          {t.is_authorization && (
                            <Badge size='xs' variant='light' color='violet'>
                              Autorización
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>
                          #{t.id_request_general} {t.subject_request ?? ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{t.process ?? '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{memberName.get(t.id_assigned) ?? '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant='light' color='gray'>
                          {t.status_task}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {filteredTasks.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <Text size='sm' c='dimmed' ta='center' py='md'>
                          No hay tareas abiertas con estos filtros
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          <Group align='flex-end' grow>
            <Select
              label='Reasignar a'
              placeholder='Elige una persona de tu área'
              data={targetOptions}
              value={toUserId}
              onChange={setToUserId}
              searchable
              error={
                sameTarget
                  ? 'Hay tareas seleccionadas que ya son de esta persona'
                  : selfApproval
                    ? 'Hay autorizaciones seleccionadas: no pueden ir al solicitante ni a ti (autoaprobación)'
                    : undefined
              }
              data-testid='workload-target'
            />
            <Textarea label='Motivo (opcional)' placeholder='Queda en la bitácora de cada solicitud' value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={1} maxLength={500} />
          </Group>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Limpiar selección
            </Button>
            <Button
              leftSection={<IconArrowsShuffle size={18} />}
              disabled={selected.size === 0 || !toUserId || invalidTarget}
              onClick={() => setConfirming(true)}
              data-testid='workload-reassign'
            >
              Reasignar {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={confirming} onClose={() => setConfirming(false)} title='Confirmar reasignación' centered radius='md'>
        <Stack>
          <Text size='sm'>
            Vas a pasar <b>{selected.size}</b> {selected.size === 1 ? 'tarea' : 'tareas'} a <b>{memberName.get(toUserId ?? '')}</b>. Quedará
            registrado en la bitácora de cada solicitud y se le notificará.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setConfirming(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={saving} data-testid='workload-confirm'>
              Confirmar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
