'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Group, Loader, Modal, Radio, ScrollArea, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconAlertCircle, IconInfoCircle, IconSearch } from '@tabler/icons-react';
import { MAX_LINK_SUMMARY_CHARS } from '../../lib/chat/projects-rules';
import { formatDay, formatMinutes, formatTime } from '../../lib/meetings/format';
import type { Meeting } from '../../lib/meetings/metrics';
import type { MeetingsProjectsDto } from '../../lib/meetings/projects/types';

/**
 * «Asignar a proyecto» (2026-11-24). Two ways in:
 *   - from "Mis reuniones": the meeting is fixed and the person picks the project;
 *   - from the project's «Reuniones» section: the project is fixed and the person picks one of HER
 *     meetings (only her own calendar: the server reads the event again from the session mailbox).
 * Before publishing it says what the project members will see (and that the transcript is not shared).
 */

export interface AssignResult {
  idProject: number;
  seriesRule: boolean;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onDone: (r: AssignResult) => void;
  /** Fixed meeting (from "Mis reuniones"). */
  meeting?: Meeting | null;
  /** Projects to choose from (owner or editor). */
  projects?: { idProject: number; name: string }[];
  defaultProjectId?: number | null;
  origin?: 'manual' | 'sugerencia';
  /** Fixed project (from the project section). */
  project?: { idProject: number; name: string } | null;
}

async function post(idProject: number, body: unknown): Promise<{ ok: true; seriesRule: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/proyectos/${idProject}/vinculos/reuniones`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; seriesRule?: boolean };
    return res.ok ? { ok: true, seriesRule: data.seriesRule === true } : { ok: false, error: data.error ?? 'No se pudo asignar la reunión.' };
  } catch {
    return { ok: false, error: 'No hay conexión con SynerLink. Revise su red e intente de nuevo.' };
  }
}

export default function AssignMeetingModal({ opened, onClose, onDone, meeting, projects = [], defaultProjectId, origin = 'manual', project }: Props) {
  const [idProject, setIdProject] = useState<string | null>(null);
  const [series, setSeries] = useState(false);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Picker of own meetings (project mode).
  const [mine, setMine] = useState<Meeting[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!opened) return;
    setIdProject(defaultProjectId ? String(defaultProjectId) : project ? String(project.idProject) : null);
    setSeries(false);
    setSummary('');
    setError(null);
    setPicked(null);
    setFilter('');
    if (!project) return;
    let cancelled = false;
    setMine(null);
    setMineError(null);
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch('/api/meetings?days=30', { cache: 'no-store', credentials: 'same-origin' }),
          fetch('/api/meetings/projects?days=30', { cache: 'no-store', credentials: 'same-origin' }),
        ]);
        const overview = (await a.json().catch(() => ({}))) as { enabled?: boolean; meetings?: Meeting[]; error?: string };
        const links = (await b.json().catch(() => ({}))) as MeetingsProjectsDto;
        if (cancelled) return;
        if (!a.ok || !overview.enabled) {
          setMineError(overview.error ?? 'El módulo de reuniones no está habilitado para su cuenta.');
          return;
        }
        setMine((overview.meetings ?? []).filter((m) => !m.private && m.icalUid && !links.items?.[m.id]?.link));
      } catch {
        if (!cancelled) setMineError('No se pudieron cargar sus reuniones.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, project, defaultProjectId]);

  const chosen = useMemo(() => meeting ?? mine?.find((m) => m.id === picked) ?? null, [meeting, mine, picked]);
  const visibles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (mine ?? []).filter((m) => !q || m.subject.toLowerCase().includes(q)).slice(0, 60);
  }, [mine, filter]);

  const submit = async () => {
    if (!chosen || !idProject) return;
    setBusy(true);
    setError(null);
    const r = await post(Number(idProject), {
      eventId: chosen.id,
      applyToSeries: series && chosen.recurring,
      summary: summary.trim() || null,
      origin: meeting ? origin : 'manual',
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onDone({ idProject: Number(idProject), seriesRule: r.seriesRule });
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={600}>{project ? `Asignar una reunión a ${project.name}` : 'Asignar reunión a un proyecto'}</Text>} size='lg'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)} py={8} role='alert'>
            {error}
          </Alert>
        )}

        {project && !meeting && (
          <>
            <Text size='sm'>Escoja una de sus reuniones de los últimos 30 días:</Text>
            {mineError && (
              <Alert color='yellow' icon={<IconInfoCircle size={18} />} py={8}>
                {mineError}
              </Alert>
            )}
            {!mine && !mineError && (
              <Group justify='center' py='md'>
                <Loader size='sm' />
              </Group>
            )}
            {mine && (
              <>
                <TextInput size='sm' placeholder='Buscar por asunto' leftSection={<IconSearch size={14} />} value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
                {visibles.length === 0 ? (
                  <Text size='sm' c='dimmed' ta='center' py='sm'>
                    No hay reuniones sin proyecto en ese periodo.
                  </Text>
                ) : (
                  <ScrollArea.Autosize mah={260}>
                    <Radio.Group value={picked} onChange={setPicked}>
                      <Stack gap={6}>
                        {visibles.map((m) => (
                          <Radio
                            key={m.id}
                            value={m.id}
                            label={m.subject}
                            description={`${formatDay(m.start)} · ${formatTime(m.start)} · ${formatMinutes(m.scheduledMinutes)}${m.recurring ? ' · periódica' : ''}`}
                            data-testid='asignar-reunion-opcion'
                          />
                        ))}
                      </Stack>
                    </Radio.Group>
                  </ScrollArea.Autosize>
                )}
              </>
            )}
          </>
        )}

        {meeting && (
          <Text size='sm'>
            <b>{meeting.subject}</b> · {formatDay(meeting.start)} {formatTime(meeting.start)}
          </Text>
        )}

        {!project && (
          <Select
            label='Proyecto'
            placeholder='Escoja el proyecto'
            data={projects.map((p) => ({ value: String(p.idProject), label: p.name }))}
            value={idProject}
            onChange={setIdProject}
            searchable
            nothingFoundMessage='Sin proyectos donde usted sea dueño o editor'
            data-testid='asignar-reunion-proyecto'
          />
        )}

        {chosen?.recurring && (
          <Checkbox
            checked={series}
            onChange={(e) => setSeries(e.currentTarget.checked)}
            label='Aplicar a toda la serie'
            description='Las próximas reuniones de esta serie quedan asignadas solas a este proyecto. La regla se puede quitar cuando quiera.'
          />
        )}

        <Textarea
          label='Resumen para el equipo (opcional)'
          description='Lo único del contenido de la reunión que usted comparte al asignarla.'
          value={summary}
          onChange={(e) => setSummary(e.currentTarget.value)}
          maxLength={MAX_LINK_SUMMARY_CHARS}
          autosize
          minRows={2}
          maxRows={5}
        />

        <Alert color='blue' variant='light' icon={<IconInfoCircle size={18} />} py={8}>
          Los miembros del proyecto verán el asunto, la fecha, la duración, cuántas personas asistieron, este resumen y el análisis del asistente si se pide.
          La transcripción no se comparte: solo la ven quienes asistieron.
        </Alert>

        <Group justify='flex-end' gap='sm'>
          <Button variant='default' onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!chosen || !idProject} data-testid='asignar-reunion-confirmar'>
            Asignar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
