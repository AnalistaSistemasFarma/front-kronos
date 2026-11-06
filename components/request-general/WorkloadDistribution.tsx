'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
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
  IconListCheck,
  IconLock,
  IconScale,
  IconUserBolt,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';
import { KpiTile, ToneChip, avatarColor, initialsOf, panelStyles as ps, type StatusTone } from '../ui/panel/Panel';
import progressStyles from './requestProgressBar.module.css';
import styles from './workloadDistribution.module.css';

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

/** Valor de `tasksFor` para ver las tareas de todo el equipo. */
const ALL_TASKS = '__todas__';

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

/** Nivel de carga frente a la parte justa (100 % / personas del área). */
function loadTone(percent: number, openTasks: number, fairShare: number): StatusTone {
  if (openTasks === 0) return 'idle';
  if (fairShare <= 0) return 'info';
  if (percent >= fairShare * 1.5) return 'critical';
  if (percent >= fairShare * 1.15) return 'warning';
  return 'ok';
}

const LOAD_LABEL: Record<StatusTone, string> = {
  ok: 'Equilibrada',
  warning: 'Alta',
  critical: 'Muy alta',
  info: 'Carga',
  idle: 'Sin tareas',
};

/**
 * La barrita de las listas de solicitudes (se rellena al abrir y un destello la recorre),
 * con el color del nivel de carga. Mismo CSS que RequestProgressBar.
 */
function LoadBar({ percent, tone, label }: { percent: number; tone: StatusTone; label: string }) {
  const toneVar: Record<StatusTone, string> = {
    ok: 'var(--pn-ok)',
    warning: 'var(--pn-warning)',
    critical: 'var(--pn-critical)',
    info: 'var(--pn-info)',
    idle: 'var(--pn-idle)',
  };
  return (
    <div className={`${progressStyles.progress} ${styles.loadBar}`} style={{ '--tone': toneVar[tone] } as CSSProperties}>
      <span
        className={progressStyles.track}
        role='progressbar'
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span className={progressStyles.fill} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </span>
    </div>
  );
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
  // Ventana de tareas: id de la persona, ALL_TASKS para todas, null cerrada.
  const [tasksFor, setTasksFor] = useState<string | null>(null);
  const personFilter = tasksFor && tasksFor !== ALL_TASKS ? tasksFor : null;
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
  const { isDark } = useDashboardChartPalette();

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

  /** Abre la ventana con las tareas de una persona (o de todos) para elegir cuáles reasignar. */
  const openTasksOf = (personId: string) => {
    setSelected(new Set());
    setExpanded(new Set());
    setTasksFor(personId);
  };
  const closeTasks = () => {
    if (saving) return;
    setTasksFor(null);
    setSelected(new Set());
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
      setTasksFor(null);
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

  const activeFilters = [processFilter, statusFilter].filter(Boolean).length;
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

  const busiest = filteredLoad.members[0];
  const busiestTone = busiest ? loadTone(busiest.percent, busiest.openTasks, fairShare) : 'idle';

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
        radius={isDesktop ? 'lg' : 0}
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
            <Text fw={700} size='lg'>
              Distribución de carga
            </Text>
          </Group>
        }
      >
        {/* panelStyles.root: colores y modo oscuro del diseño de paneles (mismo de "Mi equipo"). */}
        <div className={ps.root} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className={styles.body} data-testid='workload-panel'>
            <div className={styles.stack}>
              <p className={ps.cardHint} style={{ margin: 0 }}>
                Tareas abiertas de {data.departments?.map((d) => d.name).join(', ')}. El porcentaje es la parte de la carga del
                área que tiene cada persona. Solo puedes reasignar tareas de solicitudes de las que eres responsable; las demás
                llevan candado.
              </p>

              {error && (
                <Alert color='red' radius='lg' icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              {success && (
                <Alert color='teal' radius='lg' icon={<IconCheck size={18} />} withCloseButton onClose={() => setSuccess(null)}>
                  {success}
                </Alert>
              )}

              <div className={ps.grid4}>
                <KpiTile
                  icon={<IconListCheck size={15} />}
                  label='Tareas abiertas'
                  value={String(filteredLoad.total)}
                  foot={activeFilters > 0 ? 'con los filtros aplicados' : 'en tu área'}
                />
                <KpiTile
                  icon={<IconUsersGroup size={15} />}
                  label='Personas'
                  value={String(members.length)}
                  foot={fairShare > 0 ? `Lo equilibrado: ~${Math.round(fairShare)} % cada una` : undefined}
                />
                <KpiTile
                  icon={<IconScale size={15} />}
                  label='Reasignables'
                  value={String(selectable.length)}
                  foot='de solicitudes a tu cargo'
                />
                <KpiTile
                  icon={<IconUserBolt size={15} />}
                  label='Mayor carga'
                  value={busiest && busiest.openTasks > 0 ? busiest.name : '—'}
                  textValue
                  tone={busiestTone}
                  foot={busiest && busiest.openTasks > 0 ? <ToneChip tone={busiestTone} label={`${busiest.percent} % · ${LOAD_LABEL[busiestTone]}`} /> : undefined}
                />
              </div>

              {/* Filtros: cajón plegable en móvil, siempre visibles en escritorio */}
              <div className={ps.card} style={{ padding: 0 }}>
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
                    {activeFilters > 0 && <ToneChip tone='info' label={String(activeFilters)} />}
                  </Group>
                  <IconChevronDown size={18} style={{ transform: filtersOpen ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
                </UnstyledButton>
                <Collapse in={filtersOpen || isDesktop}>
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm' p='md' pt={isDesktop ? 'md' : 0}>
                    <Select size='md' radius='md' label='Proceso' placeholder='Todos los procesos' data={processOptions} value={processFilter} onChange={setProcessFilter} clearable searchable comboboxProps={{ withinPortal: true }} />
                    <Select size='md' radius='md' label='Estado' placeholder='Todos los estados abiertos' data={statusOptions} value={statusFilter} onChange={setStatusFilter} clearable comboboxProps={{ withinPortal: true }} />
                  </SimpleGrid>
                </Collapse>
              </div>

              {/* Carga por persona: avatar · nombre + barrita · % · nivel */}
              <section>
                <div className={styles.blockHead}>
                  <h3 className={styles.blockTitle}>Carga por persona</h3>
                  <Button size='compact-sm' radius='xl' variant='subtle' disabled={filteredLoad.total === 0} onClick={() => openTasksOf(ALL_TASKS)}>
                    Ver todas las tareas ({filteredLoad.total})
                  </Button>
                </div>
                {loading && !data.members ? (
                  <Loader size='sm' />
                ) : (
                  <div className={ps.list} data-testid='workload-members'>
                    {filteredLoad.members.map((m) => {
                      const tone = loadTone(m.percent, m.openTasks, fairShare);
                      return (
                        <div key={m.id} className={styles.memberRow}>
                          <span className={ps.avatar} style={{ background: avatarColor(m.email ?? m.id, isDark) }} aria-hidden>
                            {initialsOf(m.name)}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className={styles.memberName}>
                              {m.name}
                              {m.id === data.actorId ? ' (tú)' : ''}
                            </span>
                            <span className={styles.memberSub}>
                              {m.openTasks} {m.openTasks === 1 ? 'tarea abierta' : 'tareas abiertas'}
                            </span>
                            <LoadBar percent={m.percent} tone={tone} label={`Carga de ${m.name}: ${m.percent}%`} />
                          </span>
                          <span className={styles.memberPercent}>{m.percent}%</span>
                          <span className={styles.memberSide}>
                            <ToneChip tone={tone} label={LOAD_LABEL[tone]} />
                            <Button size='compact-sm' radius='xl' variant='light' disabled={m.openTasks === 0} onClick={() => openTasksOf(m.id)}>
                              Ver sus tareas
                            </Button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </Modal>

      {/* Tareas de una persona (o de todos): se eligen aquí, sin bajar por la ventana principal. */}
      <Modal
        opened={tasksFor != null}
        onClose={closeTasks}
        fullScreen={!isDesktop}
        size='min(900px, 92vw)'
        radius={isDesktop ? 'lg' : 0}
        padding={0}
        zIndex={250}
        transitionProps={{ transition: 'fade', duration: 150 }}
        closeButtonProps={{ size: 'lg', 'aria-label': 'Cerrar' }}
        styles={{
          header: { paddingInline: 16, minHeight: 56, borderBottom: '1px solid var(--mantine-color-default-border)' },
          content: { display: 'flex', flexDirection: 'column', maxHeight: isDesktop ? '90dvh' : '100dvh' },
          body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 0 },
        }}
        title={
          <Group gap='xs' wrap='nowrap'>
            <IconListCheck size={22} />
            <Text fw={700} size='lg'>
              {personFilter ? `Tareas de ${memberName.get(personFilter) ?? 'la persona'}` : 'Todas las tareas abiertas'}
            </Text>
          </Group>
        }
      >
        <div className={ps.root} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className={styles.body}>
            <div className={styles.blockHead}>
              <h3 className={styles.blockTitle}>Tareas abiertas ({filteredTasks.length})</h3>
              <ToneChip tone={selected.size > 0 ? 'info' : 'idle'} label={`${selected.size} seleccionadas`} />
            </div>
            <div className={ps.list} data-testid='workload-tasks'>
              {selectable.length > 0 && (
                <div className={styles.selectAll}>
                  <Checkbox
                    size='md'
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
                </div>
              )}
              {filteredTasks.map((t) => {
                const isSel = selected.has(t.id);
                const open = expanded.has(t.id);
                return (
                  <div
                    key={t.id}
                    data-testid='workload-task'
                    className={`${styles.taskRow} ${isSel ? styles.taskSelected : ''} ${!t.reassignable ? styles.taskLocked : ''}`}
                  >
                    <Box component={t.reassignable ? 'label' : 'div'} className={styles.taskMain} style={{ cursor: t.reassignable ? 'pointer' : 'default' }}>
                      <span className={styles.taskPick}>
                        {t.reassignable ? (
                          <Checkbox size='md' aria-label={`Seleccionar tarea ${t.id}`} checked={isSel} onChange={() => toggle(t.id)} />
                        ) : (
                          <IconLock size={20} color='var(--pn-muted)' aria-hidden />
                        )}
                      </span>
                      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                        <Group gap={6} wrap='wrap'>
                          <span className={styles.taskTitle}>{t.task}</span>
                          {t.is_authorization && <ToneChip tone='info' label='Autorización' />}
                        </Group>
                        <Text className={styles.taskSubject} lineClamp={open ? undefined : 1}>
                          #{t.id_request_general} {t.subject_request ?? ''}
                        </Text>
                        <span className={styles.taskMeta}>
                          <span className={ps.pill}>{t.status_task}</span>
                          <span>
                            {t.process ?? '—'} · {memberName.get(t.id_assigned) ?? '—'}
                          </span>
                        </span>
                        {!t.reassignable && (
                          <span className={styles.taskMeta}>
                            <IconLock size={14} style={{ flexShrink: 0 }} />
                            {t.is_signature ? 'Autorización de firma: va ligada al firmante' : 'Solicitud de la que no eres responsable'}
                          </span>
                        )}
                        <Collapse in={open}>
                          <div className={styles.taskDetails}>
                            <span>Tarea #{t.id}</span>
                            {t.category && <span>Categoría: {t.category}</span>}
                            {t.company && <span>Empresa: {t.company}</span>}
                            {t.start_date && <span>Inicio: {new Date(t.start_date).toLocaleDateString('es-CO')}</span>}
                            {t.is_authorization && <span>Quien la reciba queda como aprobador. No puede ir a quien creó la solicitud.</span>}
                          </div>
                        </Collapse>
                      </Stack>
                    </Box>
                    <ActionIcon
                      variant='subtle'
                      color='gray'
                      size={44}
                      radius='xl'
                      m={4}
                      onClick={() => toggleExpanded(t.id)}
                      aria-label={open ? 'Ocultar detalles' : 'Ver detalles'}
                      aria-expanded={open}
                    >
                      <IconChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
                    </ActionIcon>
                  </div>
                );
              })}
              {filteredTasks.length === 0 && <div className={styles.empty}>No hay tareas abiertas con estos filtros</div>}
            </div>
          </div>

          {/* Barra de acción fija abajo, al alcance del pulgar */}
          <div className={styles.actionBar} data-testid='workload-actionbar'>
            <span className={styles.actionCount}>
              {selected.size > 0
                ? `${selected.size} ${selected.size === 1 ? 'tarea seleccionada' : 'tareas seleccionadas'}`
                : 'Selecciona tareas para reasignar'}
            </span>
            <Group gap='sm' wrap='nowrap'>
              <Button variant='default' radius='xl' size='md' onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Limpiar
              </Button>
              <Button
                size='md'
                radius='xl'
                leftSection={<IconArrowsShuffle size={18} />}
                disabled={selected.size === 0}
                onClick={() => {
                  setConfirming(false);
                  setReassignOpen(true);
                }}
                data-testid='workload-reassign'
              >
                Reasignar {selected.size > 0 ? `(${selected.size})` : ''}
              </Button>
            </Group>
          </div>
        </div>
      </Modal>

      {/* Destino, motivo y confirmación. En móvil, a pantalla completa con los botones justo debajo de los campos para que el teclado no los tape. */}
      <Modal
        opened={reassignOpen}
        onClose={closeReassign}
        fullScreen={!isDesktop}
        centered
        radius={isDesktop ? 'lg' : 0}
        size={isDesktop ? 'md' : '100%'}
        zIndex={300}
        transitionProps={{ transition: 'fade', duration: 150 }}
        closeButtonProps={{ size: 'lg', 'aria-label': 'Cerrar' }}
        title={
          <Text fw={700} size='lg'>
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
              <Button variant='default' radius='xl' size='md' onClick={() => setConfirming(false)} disabled={saving}>
                Volver
              </Button>
              <Button size='md' radius='xl' onClick={submit} loading={saving} data-testid='workload-confirm'>
                Confirmar
              </Button>
            </SimpleGrid>
          </Stack>
        ) : (
          <Stack>
            <Select
              size='md'
              radius='md'
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
              radius='md'
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
              <Button variant='default' radius='xl' size='md' onClick={closeReassign}>
                Cancelar
              </Button>
              <Button size='md' radius='xl' disabled={selected.size === 0 || !toUserId || invalidTarget} onClick={() => setConfirming(true)} data-testid='workload-continue'>
                Continuar
              </Button>
            </SimpleGrid>
          </Stack>
        )}
      </Modal>
    </>
  );
}
