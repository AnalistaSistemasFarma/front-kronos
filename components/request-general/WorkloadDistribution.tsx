'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconArrowsShuffle,
  IconCheck,
  IconChevronDown,
  IconFilter,
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
  const [reassignOpen, setReassignOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Mobile first: por debajo de md (62em) el panel ocupa toda la pantalla.
  const isDesktop = useMediaQuery('(min-width: 62em)') ?? false;

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
      setReassignOpen(false);
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

  const activeFilters = [processFilter, statusFilter, personFilter].filter(Boolean).length;
  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const targetError = sameTarget
    ? 'Hay tareas seleccionadas que ya son de esta persona'
    : selfApproval
      ? 'Hay autorizaciones seleccionadas: no pueden ir al solicitante ni a ti (autoaprobación)'
      : undefined;
  const closeReassign = () => {
    if (saving) return;
    setConfirming(false);
    setReassignOpen(false);
  };

  return (
    <>
      <Button
        leftSection={<IconArrowsShuffle size={18} />}
        variant='light'
        size='md'
        w={{ base: '100%', sm: 'auto' }}
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
        fullScreen={!isDesktop}
        size='min(1200px, 92vw)'
        radius={isDesktop ? 'md' : 0}
        padding={0}
        transitionProps={{ transition: 'fade', duration: 150 }}
        closeButtonProps={{ size: 'lg', 'aria-label': 'Cerrar' }}
        styles={{
          header: { paddingInline: 16, minHeight: 56, borderBottom: '1px solid var(--mantine-color-default-border)' },
          content: { display: 'flex', flexDirection: 'column', maxHeight: isDesktop ? '90dvh' : '100dvh' },
          body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 0 },
        }}
        title={
          <Group gap='xs' wrap='nowrap'>
            <IconUsersGroup size={22} />
            <Text fw={600} size='lg'>
              Distribución de carga
            </Text>
          </Group>
        }
      >
        <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }} px={{ base: 'sm', sm: 'md' }} py='md' data-testid='workload-panel'>
          <Stack gap='md'>
            <Text size='sm' c='dimmed'>
              Tareas abiertas de {data.departments?.map((d) => d.name).join(', ')}. El porcentaje es la parte de la carga del área
              que tiene cada persona. Solo puedes reasignar tareas de solicitudes de las que eres responsable; las demás llevan candado.
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

            {/* Filtros: cajón plegable en móvil, siempre visibles en escritorio */}
            <Paper withBorder radius='md'>
              <UnstyledButton
                onClick={() => setFiltersOpen((v) => !v)}
                w='100%'
                px='md'
                mih={48}
                hiddenFrom='md'
                aria-expanded={filtersOpen}
                data-testid='workload-filters-toggle'
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Group gap='xs'>
                  <IconFilter size={18} />
                  <Text fw={600} size='sm'>
                    Filtros
                  </Text>
                  {activeFilters > 0 && (
                    <Badge size='sm' variant='filled'>
                      {activeFilters}
                    </Badge>
                  )}
                </Group>
                <IconChevronDown size={18} style={{ transform: filtersOpen ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
              </UnstyledButton>
              <Collapse in={filtersOpen || isDesktop}>
                <SimpleGrid cols={{ base: 1, md: 3 }} spacing='sm' p='md' pt={isDesktop ? 'md' : 0}>
                  <Select size='md' label='Proceso' placeholder='Todos los procesos' data={processOptions} value={processFilter} onChange={setProcessFilter} clearable searchable comboboxProps={{ withinPortal: true }} />
                  <Select size='md' label='Estado' placeholder='Todos los estados abiertos' data={statusOptions} value={statusFilter} onChange={setStatusFilter} clearable comboboxProps={{ withinPortal: true }} />
                  <Select
                    size='md'
                    label='Persona'
                    placeholder='Todas las personas'
                    data={members.map((m) => ({ value: m.id, label: m.name }))}
                    value={personFilter}
                    onChange={setPersonFilter}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: true }}
                  />
                </SimpleGrid>
              </Collapse>
            </Paper>

            {/* Carga por persona: tarjetas apiladas, columnas en pantallas grandes */}
            <Box>
              <Group justify='space-between' mb='xs' gap={4}>
                <Text fw={600}>Carga por persona</Text>
                <Text size='sm' c='dimmed'>
                  {filteredLoad.total} abiertas · {members.length} personas
                </Text>
              </Group>
              {loading && !data.members ? (
                <Loader size='sm' />
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='sm' data-testid='workload-members'>
                  {filteredLoad.members.map((m) => (
                    <Paper key={m.id} withBorder radius='md' p='sm' bg={personFilter === m.id ? 'var(--mantine-color-blue-light)' : undefined}>
                      <Group justify='space-between' wrap='nowrap' gap='xs' align='flex-start'>
                        <Text size='sm' fw={600} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                          {m.name}
                          {m.id === data.actorId ? ' (tú)' : ''}
                        </Text>
                        <Text size='sm' fw={700} style={{ whiteSpace: 'nowrap' }}>
                          {m.percent}%
                        </Text>
                      </Group>
                      <Progress value={m.percent} color={loadColor(m.percent, fairShare)} size='lg' radius='sm' my={8} aria-label={`Carga de ${m.name}: ${m.percent}%`} />
                      <Group justify='space-between' wrap='nowrap' gap='xs'>
                        <Text size='sm' c='dimmed'>
                          {m.openTasks} {m.openTasks === 1 ? 'tarea abierta' : 'tareas abiertas'}
                        </Text>
                        <Button size='compact-md' h={40} variant='subtle' disabled={m.openTasks === 0} onClick={() => selectAllOfPerson(m.id)}>
                          Seleccionar sus tareas
                        </Button>
                      </Group>
                    </Paper>
                  ))}
                </SimpleGrid>
              )}
            </Box>

            {/* Tareas: tarjetas seleccionables */}
            <Box>
              <Group justify='space-between' mb='xs' gap='xs'>
                <Text fw={600}>Tareas abiertas ({filteredTasks.length})</Text>
                <Badge variant='light'>{selected.size} seleccionadas</Badge>
              </Group>
              {selectable.length > 0 && (
                <Paper withBorder radius='md' px='sm' mb='xs'>
                  <Checkbox
                    size='md'
                    py={10}
                    label={`Seleccionar todas las reasignables (${selectable.length})`}
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
                </Paper>
              )}
              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='xs' data-testid='workload-tasks'>
                {filteredTasks.map((t) => {
                  const isSel = selected.has(t.id);
                  const open = expanded.has(t.id);
                  return (
                    <Paper
                      key={t.id}
                      withBorder
                      radius='md'
                      p={0}
                      data-testid='workload-task'
                      style={{
                        borderColor: isSel ? 'var(--mantine-color-blue-filled)' : undefined,
                        background: isSel ? 'var(--mantine-color-blue-light)' : t.reassignable ? undefined : 'var(--mantine-color-default-hover)',
                      }}
                    >
                      <Group wrap='nowrap' align='flex-start' gap={0}>
                        <Box
                          component={t.reassignable ? 'label' : 'div'}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0, padding: 12, cursor: t.reassignable ? 'pointer' : 'default' }}
                        >
                          <Box w={28} pt={2} style={{ flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                            {t.reassignable ? (
                              <Checkbox size='md' aria-label={`Seleccionar tarea ${t.id}`} checked={isSel} onChange={() => toggle(t.id)} />
                            ) : (
                              <IconLock size={20} color='var(--mantine-color-dimmed)' aria-hidden />
                            )}
                          </Box>
                          <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                            <Group gap={6} wrap='wrap'>
                              <Text size='sm' fw={600} style={{ overflowWrap: 'anywhere' }}>
                                {t.task}
                              </Text>
                              {t.is_authorization && (
                                <Badge size='sm' variant='light' color='blue'>
                                  Autorización
                                </Badge>
                              )}
                            </Group>
                            <Text size='sm' c='dimmed' lineClamp={open ? undefined : 1} style={{ overflowWrap: 'anywhere' }}>
                              #{t.id_request_general} {t.subject_request ?? ''}
                            </Text>
                            <Group gap={6} wrap='wrap'>
                              <Badge variant='light' color='gray' size='sm' style={{ maxWidth: '100%' }}>
                                {t.status_task}
                              </Badge>
                              <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                                {t.process ?? '—'} · {memberName.get(t.id_assigned) ?? '—'}
                              </Text>
                            </Group>
                            {!t.reassignable && (
                              <Group gap={4} wrap='nowrap' align='flex-start'>
                                <IconLock size={14} style={{ flexShrink: 0, marginTop: 2 }} color='var(--mantine-color-dimmed)' />
                                <Text size='xs' c='dimmed'>
                                  {t.is_signature ? 'Autorización de firma: va ligada al firmante' : 'Solicitud de la que no eres responsable'}
                                </Text>
                              </Group>
                            )}
                            <Collapse in={open}>
                              <Stack gap={2} pt={4}>
                                <Text size='xs' c='dimmed'>Tarea #{t.id}</Text>
                                {t.category && <Text size='xs' c='dimmed'>Categoría: {t.category}</Text>}
                                {t.company && <Text size='xs' c='dimmed'>Empresa: {t.company}</Text>}
                                {t.start_date && <Text size='xs' c='dimmed'>Inicio: {new Date(t.start_date).toLocaleDateString('es-CO')}</Text>}
                                {t.is_authorization && (
                                  <Text size='xs' c='dimmed'>Quien la reciba queda como aprobador. No puede ir a quien creó la solicitud.</Text>
                                )}
                              </Stack>
                            </Collapse>
                          </Stack>
                        </Box>
                        <ActionIcon
                          variant='subtle'
                          color='gray'
                          size={44}
                          m={4}
                          onClick={() => toggleExpanded(t.id)}
                          aria-label={open ? 'Ocultar detalles' : 'Ver detalles'}
                          aria-expanded={open}
                        >
                          <IconChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
                        </ActionIcon>
                      </Group>
                    </Paper>
                  );
                })}
              </SimpleGrid>
              {filteredTasks.length === 0 && (
                <Text size='sm' c='dimmed' ta='center' py='md'>
                  No hay tareas abiertas con estos filtros
                </Text>
              )}
            </Box>
          </Stack>
        </Box>

        {/* Barra de acción fija abajo, al alcance del pulgar */}
        <Box
          px={{ base: 'sm', sm: 'md' }}
          pt='sm'
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--mantine-color-default-border)',
            background: 'var(--mantine-color-body)',
            paddingBottom: 'calc(var(--mantine-spacing-sm) + env(safe-area-inset-bottom))',
          }}
          data-testid='workload-actionbar'
        >
          <Group gap='sm' wrap='nowrap' justify='flex-end'>
            <Button variant='default' size='md' onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Limpiar
            </Button>
            <Button
              size='md'
              leftSection={<IconArrowsShuffle size={18} />}
              disabled={selected.size === 0}
              onClick={() => {
                setConfirming(false);
                setReassignOpen(true);
              }}
              data-testid='workload-reassign'
              style={{ flex: isDesktop ? undefined : 1 }}
            >
              Reasignar {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </Group>
        </Box>
      </Modal>

      {/* Destino, motivo y confirmación. En móvil, a pantalla completa con los botones justo debajo de los campos para que el teclado no los tape. */}
      <Modal
        opened={reassignOpen}
        onClose={closeReassign}
        fullScreen={!isDesktop}
        centered
        radius={isDesktop ? 'md' : 0}
        size={isDesktop ? 'md' : '100%'}
        zIndex={300}
        transitionProps={{ transition: 'fade', duration: 150 }}
        closeButtonProps={{ size: 'lg', 'aria-label': 'Cerrar' }}
        title={
          <Text fw={600} size='lg'>
            {confirming ? 'Confirmar reasignación' : `Reasignar ${selected.size} ${selected.size === 1 ? 'tarea' : 'tareas'}`}
          </Text>
        }
      >
        {confirming ? (
          <Stack>
            <Text size='sm'>
              Vas a pasar <b>{selected.size}</b> {selected.size === 1 ? 'tarea' : 'tareas'} a <b>{memberName.get(toUserId ?? '')}</b>. Quedará
              registrado en la bitácora de cada solicitud y se le notificará.
            </Text>
            {reason.trim() && (
              <Text size='sm' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                Motivo: {reason.trim()}
              </Text>
            )}
            <SimpleGrid cols={2} spacing='sm'>
              <Button variant='default' size='md' onClick={() => setConfirming(false)} disabled={saving}>
                Volver
              </Button>
              <Button size='md' onClick={submit} loading={saving} data-testid='workload-confirm'>
                Confirmar
              </Button>
            </SimpleGrid>
          </Stack>
        ) : (
          <Stack>
            <Select
              size='md'
              label='Reasignar a'
              placeholder='Elige una persona de tu área'
              data={targetOptions}
              value={toUserId}
              onChange={setToUserId}
              searchable
              error={targetError}
              comboboxProps={{ withinPortal: true, zIndex: 400 }}
              maxDropdownHeight={240}
              data-testid='workload-target'
            />
            <Textarea
              size='md'
              label='Motivo (opcional)'
              placeholder='Queda en la bitácora de cada solicitud'
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={4}
              maxLength={500}
            />
            <SimpleGrid cols={2} spacing='sm'>
              <Button variant='default' size='md' onClick={closeReassign}>
                Cancelar
              </Button>
              <Button size='md' disabled={selected.size === 0 || !toUserId || invalidTarget} onClick={() => setConfirming(true)} data-testid='workload-continue'>
                Continuar
              </Button>
            </SimpleGrid>
          </Stack>
        )}
      </Modal>
    </>
  );
}
