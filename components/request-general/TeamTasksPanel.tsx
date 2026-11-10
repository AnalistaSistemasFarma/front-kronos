'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  LoadingOverlay,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowsExchange,
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconEye,
  IconListCheck,
  IconSelector,
  IconUser,
  IconUserCheck,
  IconUsers,
  IconX,
} from '@tabler/icons-react';

/** Tarea tal como la devuelve /api/requests-general/team/team-activities-assigned. */
export interface TeamTask {
  id: number;
  id_task: number;
  task: string;
  id_request_general: number;
  subject_request: string;
  company: string;
  process: string;
  created_at: string;
  status_task: string;
  assigned: string;
}

interface TeamMember {
  id: string;
  name: string;
  email?: string;
  departments: string[];
  openTasks: number;
  notStartedTasks: number;
  oldestPendingDays: number | null;
  isSelf: boolean;
}

type TeamSortKey = 'name' | 'openTasks' | 'notStartedTasks' | 'oldestPendingDays';

export type TeamDepartment = { value: string; label: string };

/**
 * Acceso del Líder de solicitudes (permiso "Ver tareas de mi equipo"). `null` mientras carga.
 * Sin permiso: canViewTeam=false y la pestaña no se muestra.
 */
export function useTeamAccess() {
  const [access, setAccess] = useState<{ canViewTeam: boolean; departments: TeamDepartment[] } | null>(
    null
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/requests-general/team/access');
        if (!res.ok) throw new Error('team access');
        const data = await res.json();
        const departments: TeamDepartment[] = Array.isArray(data?.departments)
          ? data.departments
              .map((d: { id_department?: number | string; department?: string }) => ({
                value: String(d?.id_department ?? ''),
                label: String(d?.department ?? ''),
              }))
              .filter((d: TeamDepartment) => d.value && d.label)
          : [];
        if (!cancelled) setAccess({ canViewTeam: Boolean(data?.canViewTeam), departments });
      } catch {
        if (!cancelled) setAccess({ canViewTeam: false, departments: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return access;
}

interface TeamTasksPanelProps {
  departments: TeamDepartment[];
  renderStatusBadge: (status: string) => ReactNode;
  formatDate: (raw: string) => string;
  /** Tras reasignar: la bandeja propia puede haber cambiado (si me la reasigné a mí). */
  onReassigned?: () => void;
  /** Cantidad de personas, para la etiqueta de la pestaña. */
  onMembersCount?: (count: number) => void;
}

const getOldestDaysColor = (days: number | null) =>
  days == null ? 'gray' : days >= 15 ? 'red' : days >= 7 ? 'orange' : 'green';

/** Pestaña "Mi equipo": carga por persona de mis departamentos, sus tareas y reasignación. */
export default function TeamTasksPanel({
  departments,
  renderStatusBadge,
  formatDate,
  onReassigned,
  onMembersCount,
}: TeamTasksPanelProps) {
  const [teamDepartment, setTeamDepartment] = useState('');
  const teamDepartmentRef = useRef('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSort, setTeamSort] = useState<{ key: TeamSortKey; dir: 'asc' | 'desc' }>({
    key: 'oldestPendingDays',
    dir: 'desc',
  });
  const [selectedTeamMember, setSelectedTeamMember] = useState('');
  const [memberTasks, setMemberTasks] = useState<TeamTask[]>([]);
  const [memberTasksLoading, setMemberTasksLoading] = useState(false);
  const [memberTasksError, setMemberTasksError] = useState<string | null>(null);
  const [reassignTask, setReassignTask] = useState<TeamTask | null>(null);
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  const [reassignReason, setReassignReason] = useState('');
  const [reassignSaving, setReassignSaving] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const fetchTeamMembers = async (department: string = teamDepartmentRef.current) => {
    const departmentIds = department ? [department] : departments.map((d) => d.value);
    if (departmentIds.length === 0) {
      setTeamMembers([]);
      onMembersCount?.(0);
      return;
    }
    try {
      setTeamLoading(true);
      setTeamError(null);
      const params = new URLSearchParams({ departments: departmentIds.join(',') });
      const res = await fetch(`/api/requests-general/team/members?${params.toString()}`);
      if (!res.ok) throw new Error('team members');
      const data = await res.json();
      const list: TeamMember[] = Array.isArray(data?.members)
        ? data.members.map(
            (m: Omit<Partial<TeamMember>, 'departments'> & { departments?: string[] | string | null }) => ({
              id: String(m.id ?? ''),
              name: String(m.name ?? ''),
              email: m.email ?? '',
              departments: Array.isArray(m.departments)
                ? m.departments
                : String(m.departments ?? '')
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean),
              openTasks: Number(m.openTasks) || 0,
              notStartedTasks: Number(m.notStartedTasks) || 0,
              oldestPendingDays: m.oldestPendingDays == null ? null : Number(m.oldestPendingDays),
              isSelf: Boolean(m.isSelf),
            })
          )
        : [];
      setTeamMembers(list);
      onMembersCount?.(list.length);
    } catch (err) {
      console.error('Error fetching team members:', err);
      setTeamError('No se pudo cargar la información de tu equipo. Intenta de nuevo.');
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    void fetchTeamMembers();
    // Solo al montar o si cambian los departamentos del líder.
  }, [departments]);

  const teamMemberName = (id: string) => teamMembers.find((m) => m.id === id)?.name || '';

  const sortedTeamMembers = useMemo(() => {
    const list = [...teamMembers];
    const { key, dir } = teamSort;
    const sign = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name, 'es') * sign;
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return a.name.localeCompare(b.name, 'es');
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * sign || a.name.localeCompare(b.name, 'es');
    });
    return list;
  }, [teamMembers, teamSort]);

  const toggleTeamSort = (key: TeamSortKey) =>
    setTeamSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' }
    );

  const fetchMemberTasks = async (memberId: string) => {
    if (!memberId) return;
    try {
      setMemberTasksLoading(true);
      setMemberTasksError(null);
      const load = async (statusValue: string) => {
        const params = new URLSearchParams({ member: memberId, status: statusValue });
        const res = await fetch(`/api/requests-general/team/team-activities-assigned?${params.toString()}`);
        if (!res.ok) throw new Error('member tasks');
        const data = await res.json();
        return Array.isArray(data) ? (data as TeamTask[]) : [];
      };
      const [open, notStarted] = await Promise.all([load('1'), load('4')]);
      const byId = new Map<number, TeamTask>();
      [...open, ...notStarted].forEach((t) => byId.set(t.id, t));
      setMemberTasks(
        [...byId.values()].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      );
    } catch (err) {
      console.error('Error fetching member tasks:', err);
      setMemberTasks([]);
      setMemberTasksError('No se pudieron cargar las tareas de esta persona. Intenta de nuevo.');
    } finally {
      setMemberTasksLoading(false);
    }
  };

  const selectTeamMember = (memberId: string) => {
    if (selectedTeamMember === memberId) {
      setSelectedTeamMember('');
      setMemberTasks([]);
      setMemberTasksError(null);
      return;
    }
    setSelectedTeamMember(memberId);
    void fetchMemberTasks(memberId);
  };

  const openTaskInNewTab = (task: TeamTask) => {
    sessionStorage.setItem('selectedRequest', JSON.stringify(task));
    window.open(`/process/request-general/view-activities?id=${task.id}&from=assigned-activities`);
  };

  const openReassign = (task: TeamTask) => {
    setReassignTask(task);
    setReassignTo(null);
    setReassignReason('');
    setReassignError(null);
  };

  const closeReassign = () => {
    if (reassignSaving) return;
    setReassignTask(null);
  };

  const reassignOptions = teamMembers
    .filter((m) => m.id !== selectedTeamMember)
    .map((m) => ({ value: m.id, label: m.isSelf ? `${m.name} (Yo)` : m.name }));

  const submitReassign = async () => {
    if (!reassignTask || !reassignTo) {
      setReassignError('Selecciona a quién reasignar la tarea.');
      return;
    }
    if (!reassignReason.trim()) {
      setReassignError('Escribe el motivo de la reasignación.');
      return;
    }
    try {
      setReassignSaving(true);
      setReassignError(null);
      const res = await fetch('/api/requests-general/team/reassign-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: reassignTask.id,
          toUserId: reassignTo,
          reason: reassignReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReassignError(data?.error || data?.message || 'No se pudo reasignar la tarea.');
        return;
      }
      toast.success(`Tarea reasignada a ${teamMemberName(reassignTo) || 'la persona seleccionada'}`);
      setReassignTask(null);
      onReassigned?.();
      void fetchTeamMembers();
      if (selectedTeamMember) void fetchMemberTasks(selectedTeamMember);
    } catch (err) {
      console.error('Error reassigning team task:', err);
      setReassignError('No se pudo reasignar la tarea. Intenta de nuevo.');
    } finally {
      setReassignSaving(false);
    }
  };

  const renderReassignAction = (task: TeamTask) => {
    if (['resuelto', 'cancelado'].includes(task.status_task?.toLowerCase())) return null;
    return (
      <Tooltip label='Reasignar tarea' withArrow>
        <ActionIcon
          variant='light'
          color='violet'
          size='sm'
          radius='xl'
          aria-label='Reasignar tarea'
          onClick={(e) => {
            e.stopPropagation();
            openReassign(task);
          }}
        >
          <IconArrowsExchange size={14} />
        </ActionIcon>
      </Tooltip>
    );
  };

  const renderMemberTaskActions = (task: TeamTask) => (
    <Group gap={6} wrap='nowrap' justify='center'>
      <Tooltip label='Ver tarea' withArrow>
        <ActionIcon
          variant='light'
          color='blue'
          size='sm'
          radius='xl'
          aria-label='Ver tarea'
          onClick={() => openTaskInNewTab(task)}
        >
          <IconEye size={14} />
        </ActionIcon>
      </Tooltip>
      {renderReassignAction(task)}
    </Group>
  );

  const renderTeamSortIcon = (key: TeamSortKey) =>
    teamSort.key !== key ? (
      <IconSelector size={14} />
    ) : teamSort.dir === 'asc' ? (
      <IconChevronUp size={14} />
    ) : (
      <IconChevronDown size={14} />
    );

  const renderTeamTh = (key: TeamSortKey, label: string, align: 'left' | 'center' = 'center') => (
    <Table.Th style={{ whiteSpace: 'nowrap', textAlign: align }}>
      <UnstyledButton onClick={() => toggleTeamSort(key)} aria-label={`Ordenar por ${label}`}>
        <Group gap={4} wrap='nowrap' justify={align === 'center' ? 'center' : 'flex-start'}>
          <Text size='sm' fw={600}>
            {label}
          </Text>
          {renderTeamSortIcon(key)}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );

  const renderOldestBadge = (days: number | null) => (
    <Badge variant='light' color={getOldestDaysColor(days)} radius='sm'>
      {days == null ? '—' : `${days} ${days === 1 ? 'día' : 'días'}`}
    </Badge>
  );

  const renderMemberTasks = () => {
    const member = teamMembers.find((m) => m.id === selectedTeamMember);
    return (
      <Paper withBorder radius='lg' p='md' mt='lg'>
        <Group justify='space-between' wrap='wrap' gap='xs' mb='sm'>
          <Group gap={8} wrap='nowrap'>
            <IconListCheck size={18} className='text-violet-500' />
            <Text fw={700} size='sm'>
              Tareas pendientes de {member?.name || 'la persona seleccionada'}
              {member?.isSelf ? ' (Yo)' : ''}
            </Text>
            {!memberTasksLoading && (
              <Badge size='sm' variant='light' color='violet'>
                {memberTasks.length}
              </Badge>
            )}
          </Group>
          <Button
            size='xs'
            variant='subtle'
            color='gray'
            leftSection={<IconX size={14} />}
            onClick={() => selectTeamMember(selectedTeamMember)}
          >
            Cerrar
          </Button>
        </Group>

        {memberTasksError && (
          <Alert icon={<IconAlertCircle size={20} />} color='red' radius='lg' mb='sm'>
            {memberTasksError}
          </Alert>
        )}

        {memberTasksLoading ? (
          <Group justify='center' py='xl'>
            <Loader size='sm' />
          </Group>
        ) : memberTasks.length === 0 ? (
          !memberTasksError && (
            <Text size='sm' c='dimmed' ta='center' py='xl'>
              No tiene tareas abiertas ni sin empezar
            </Text>
          )
        ) : (
          <>
            <Stack gap='xs' hiddenFrom='md'>
              {memberTasks.map((task) => (
                <Paper key={task.id} withBorder radius='md' p='sm'>
                  <Group justify='space-between' wrap='nowrap' gap='xs' mb={4}>
                    <Text size='xs' c='dimmed'>
                      Solicitud #{task.id_request_general} · Tarea #{task.id_task ?? task.id}
                    </Text>
                    {renderStatusBadge(task.status_task)}
                  </Group>
                  <Text size='sm' fw={600} style={{ overflowWrap: 'anywhere' }}>
                    {task.task}
                  </Text>
                  <Text size='xs' c='dimmed' lineClamp={2}>
                    {task.subject_request}
                  </Text>
                  <Group justify='space-between' wrap='nowrap' gap='xs' mt={6}>
                    <Text size='xs' c='dimmed'>
                      {formatDate(task.created_at)}
                    </Text>
                    {renderMemberTaskActions(task)}
                  </Group>
                </Paper>
              ))}
            </Stack>

            <Box visibleFrom='md' className='overflow-x-auto'>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Solicitud</Table.Th>
                    <Table.Th>Tarea</Table.Th>
                    <Table.Th>Proceso</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th style={{ width: 1 }} ta='center'>
                      Acciones
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {memberTasks.map((task) => (
                    <Table.Tr key={task.id}>
                      <Table.Td>
                        <Text size='sm' fw={700} c='var(--mantine-color-violet-light-color)'>
                          {task.id_request_general}
                        </Text>
                        <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
                          Tarea #{task.id_task ?? task.id}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 220, maxWidth: 320 }}>
                        <Text size='sm' fw={600} lineClamp={2}>
                          {task.task}
                        </Text>
                        <Text size='xs' c='dimmed' lineClamp={2}>
                          {task.subject_request}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' fw={500}>
                          {task.process}
                        </Text>
                        <Group gap={4} wrap='nowrap'>
                          <IconBuilding size={13} className='text-gray-400' />
                          <Text size='xs' c='dimmed'>
                            {task.company}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {renderStatusBadge(task.status_task)}
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' c='dimmed'>
                          {formatDate(task.created_at)}
                        </Text>
                      </Table.Td>
                      <Table.Td>{renderMemberTaskActions(task)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          </>
        )}
      </Paper>
    );
  };

  return (
    <>
      <Group justify='space-between' align='flex-end' wrap='wrap' gap='sm' mb='md'>
        <Text size='sm' c='dimmed' style={{ flex: '1 1 260px' }}>
          Personas activas de tus departamentos. Haz clic en una persona para ver sus tareas
          pendientes.
        </Text>
        <Select
          label='Departamento'
          placeholder='Todos mis departamentos'
          data={departments}
          value={teamDepartment || null}
          onChange={(value) => {
            const next = value ?? '';
            setTeamDepartment(next);
            teamDepartmentRef.current = next;
            setSelectedTeamMember('');
            setMemberTasks([]);
            setMemberTasksError(null);
            void fetchTeamMembers(next);
          }}
          clearable
          searchable
          nothingFoundMessage='Sin departamentos'
          radius='md'
          w={{ base: '100%', sm: 280 }}
        />
      </Group>

      {teamError && (
        <Alert icon={<IconAlertCircle size={20} />} color='red' radius='lg' mb='md'>
          {teamError}
        </Alert>
      )}

      <Stack gap='xs' hiddenFrom='md'>
        {teamLoading && teamMembers.length === 0 ? (
          <Group justify='center' py='xl'>
            <Loader size='sm' />
          </Group>
        ) : sortedTeamMembers.length === 0 ? (
          <Text size='sm' c='dimmed' ta='center' py='xl'>
            No hay personas en tu equipo con los filtros actuales
          </Text>
        ) : (
          sortedTeamMembers.map((m) => (
            <Paper
              key={m.id}
              withBorder
              radius='md'
              p='sm'
              role='button'
              tabIndex={0}
              onClick={() => selectTeamMember(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') selectTeamMember(m.id);
              }}
              style={{
                cursor: 'pointer',
                borderColor: selectedTeamMember === m.id ? 'var(--mantine-color-violet-filled)' : undefined,
              }}
            >
              <Group justify='space-between' wrap='nowrap' gap='xs' mb={4}>
                <Text size='sm' fw={600} style={{ overflowWrap: 'anywhere' }}>
                  {m.name}
                  {m.isSelf ? ' (Yo)' : ''}
                </Text>
                {renderOldestBadge(m.oldestPendingDays)}
              </Group>
              <Text size='xs' c='dimmed'>
                {m.openTasks} abiertas · {m.notStartedTasks} sin empezar
              </Text>
              {m.departments.length > 0 && (
                <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                  {m.departments.join(' · ')}
                </Text>
              )}
            </Paper>
          ))
        )}
      </Stack>

      <Box visibleFrom='md' className='overflow-x-auto' pos='relative'>
        <LoadingOverlay visible={teamLoading} />
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {renderTeamTh('name', 'Persona', 'left')}
              {renderTeamTh('openTasks', 'Tareas abiertas')}
              {renderTeamTh('notStartedTasks', 'Tareas sin empezar')}
              {renderTeamTh('oldestPendingDays', 'Pendiente más antigua')}
              <Table.Th style={{ width: 1 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedTeamMembers.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5} className='text-center py-12 text-gray-500'>
                  <div className='flex flex-col items-center gap-3'>
                    <IconUsers size={48} className='text-gray-300' />
                    <Text size='lg' fw={500}>
                      {teamLoading ? 'Cargando tu equipo...' : 'No hay personas en tu equipo'}
                    </Text>
                    {!teamLoading && (
                      <Text size='sm' c='gray.5'>
                        Revisa los departamentos asignados
                      </Text>
                    )}
                  </div>
                </Table.Td>
              </Table.Tr>
            ) : (
              sortedTeamMembers.map((m) => (
                <Table.Tr
                  key={m.id}
                  className='cursor-pointer transition-colors'
                  onClick={() => selectTeamMember(m.id)}
                  bg={selectedTeamMember === m.id ? 'var(--mantine-color-violet-light)' : undefined}
                >
                  <Table.Td>
                    <Group gap={6} wrap='nowrap'>
                      <IconUser size={14} className='text-gray-400' />
                      <Text size='sm' fw={600}>
                        {m.name}
                      </Text>
                      {m.isSelf && (
                        <Badge size='xs' variant='light' color='blue'>
                          Yo
                        </Badge>
                      )}
                    </Group>
                    {m.departments.length > 0 && (
                      <Group gap={4} mt={4} wrap='wrap'>
                        {m.departments.map((d) => (
                          <Badge
                            key={d}
                            size='xs'
                            variant='outline'
                            color='gray'
                            styles={{ root: { textTransform: 'none' } }}
                          >
                            {d}
                          </Badge>
                        ))}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td ta='center'>
                    <Text size='sm' fw={700} c='var(--mantine-color-orange-light-color)'>
                      {m.openTasks}
                    </Text>
                  </Table.Td>
                  <Table.Td ta='center'>
                    <Text size='sm' fw={700} c='dimmed'>
                      {m.notStartedTasks}
                    </Text>
                  </Table.Td>
                  <Table.Td ta='center'>{renderOldestBadge(m.oldestPendingDays)}</Table.Td>
                  <Table.Td>
                    {selectedTeamMember === m.id ? (
                      <IconChevronUp size={16} className='text-gray-500' />
                    ) : (
                      <IconChevronDown size={16} className='text-gray-400' />
                    )}
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Box>

      {selectedTeamMember && renderMemberTasks()}

      <Modal
        opened={reassignTask !== null}
        onClose={closeReassign}
        title={
          <Group gap='sm'>
            <IconArrowsExchange size={20} />
            <Text fw={600}>Reasignar tarea</Text>
          </Group>
        }
        radius='lg'
        centered
        overlayProps={{ blur: 4 }}
      >
        {reassignTask && (
          <Stack gap='md'>
            <Paper withBorder radius='md' p='sm'>
              <Text size='sm' fw={600}>
                {reassignTask.task}
              </Text>
              <Text size='xs' c='dimmed'>
                Solicitud #{reassignTask.id_request_general} · {reassignTask.subject_request}
              </Text>
              <Group gap={4} mt={6} wrap='nowrap'>
                <IconUserCheck size={14} className='text-gray-400' />
                <Text size='xs' c='dimmed'>
                  Asignada actualmente a {reassignTask.assigned}
                </Text>
              </Group>
            </Paper>

            <Select
              label='Reasignar a'
              placeholder='Selecciona una persona de tu equipo'
              searchable
              required
              data={reassignOptions}
              value={reassignTo}
              onChange={setReassignTo}
              leftSection={<IconUsers size={16} />}
              nothingFoundMessage='No hay otras personas en tu equipo'
              comboboxProps={{ withinPortal: true }}
            />

            <Textarea
              label='Motivo'
              placeholder='Ej. Redistribución de carga por vacaciones'
              required
              autosize
              minRows={2}
              maxLength={500}
              value={reassignReason}
              onChange={(e) => setReassignReason(e.currentTarget.value)}
            />

            <Text size='xs' c='dimmed'>
              La reasignación queda registrada como nota en la solicitud.
            </Text>

            {reassignError && (
              <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md'>
                {reassignError}
              </Alert>
            )}

            <Group justify='flex-end' gap='sm'>
              <Button variant='outline' onClick={closeReassign} disabled={reassignSaving}>
                Cancelar
              </Button>
              <Button
                leftSection={<IconCheck size={16} />}
                onClick={() => void submitReassign()}
                loading={reassignSaving}
                disabled={!reassignTo || !reassignReason.trim()}
              >
                Reasignar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
