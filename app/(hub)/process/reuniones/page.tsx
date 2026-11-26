'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconClockHour4,
  IconCrown,
  IconCircleCheck,
  IconFileText,
  IconFolder,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import AssignMeetingModal from '../../../../components/meetings/AssignMeetingModal';
import { SUGGESTION_REASON_LABELS } from '../../../../lib/meetings/projects/rules';
import type { MeetingProjectItemDto, MeetingsProjectsDto } from '../../../../lib/meetings/projects/types';
import { deltaPct, formatDay, formatMinutes, formatTime } from '../../../../lib/meetings/format';
import type { Meeting, PeriodSummary, TranscriptLine, WeekBucket, ActualsSummary } from '../../../../lib/meetings/metrics';
import { ON_TIME_TOLERANCE_MIN, OVERRUN_TOLERANCE_MIN } from '../../../../lib/meetings/metrics';

/**
 * "Mis reuniones" (/process/reuniones, 2026-11-23): history of the meetings of
 * the SIGNED-IN account (calendar + Teams), comparison with the previous
 * period, weekly trend, punctuality / real duration from the Teams attendance
 * reports and the transcript of each meeting. Graph only runs on the server
 * (app/api/meetings/**); the module is enabled per person with REUNIONES_USUARIOS.
 */

const RANGES = [
  { value: '7', label: '7 días' },
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '180', label: '6 meses' },
];

interface Overview {
  enabled: boolean;
  days: number;
  from: string;
  to: string;
  meetings: Meeting[];
  summary: PeriodSummary;
  previous: PeriodSummary;
  trend: WeekBucket[];
  error?: string;
}

interface AnalysisRow {
  id: string;
  actualMinutes: number | null;
  startDelayMinutes: number | null;
  overrunMinutes: number | null;
  participants: number | null;
  hasTranscript: boolean;
  available: boolean;
}

interface Analysis {
  rows: AnalysisRow[];
  summary: ActualsSummary;
  truncated: boolean;
}

interface Transcript {
  meeting: Meeting;
  available: boolean;
  reason?: string;
  lines: TranscriptLine[];
  error?: string;
}

function Delta({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  const d = deltaPct(current, previous);
  if (d === null) return <Text size='xs' c='dimmed'>Sin periodo anterior para comparar</Text>;
  if (d === 0) return <Text size='xs' c='dimmed'>Igual que el periodo anterior</Text>;
  const up = d > 0;
  const good = invert ? !up : up;
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  return (
    <Group gap={4} wrap='nowrap'>
      <Icon size={14} color={`var(--mantine-color-${good ? 'teal' : 'gray'}-6)`} />
      <Text size='xs' c={good ? 'teal' : 'dimmed'}>
        {up ? '+' : ''}
        {d}% vs periodo anterior ({previous})
      </Text>
    </Group>
  );
}

function Kpi({ label, value, children, hint }: { label: string; value: string; children?: React.ReactNode; hint?: string }) {
  return (
    <Card withBorder radius='md' padding='md'>
      <Group gap={4} justify='space-between' wrap='nowrap'>
        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
          {label}
        </Text>
        {hint && (
          <Tooltip label={hint} multiline w={260} withArrow>
            <Text size='xs' c='dimmed' style={{ cursor: 'help' }}>
              ⓘ
            </Text>
          </Tooltip>
        )}
      </Group>
      <Text size='xl' fw={700} mt={4}>
        {value}
      </Text>
      {children}
    </Card>
  );
}

function WeeklyBars({ trend }: { trend: WeekBucket[] }) {
  const max = Math.max(1, ...trend.map((w) => w.minutes));
  return (
    <Card withBorder radius='md' padding='md'>
      <Text fw={600} size='sm' mb='sm'>
        Horas en reuniones por semana
      </Text>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, overflowX: 'auto' }}>
        {trend.map((w) => (
          <Tooltip
            key={w.week}
            label={`Semana del ${formatDay(`${w.week}T17:00:00Z`)}: ${w.meetings} reuniones, ${formatMinutes(w.minutes)}`}
            withArrow
          >
            <div style={{ flex: '1 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
              <Text size='10px' c='dimmed'>
                {w.minutes ? Math.round((w.minutes / 60) * 10) / 10 : ''}
              </Text>
              <div
                style={{
                  width: '100%',
                  maxWidth: 36,
                  height: `${Math.max(2, (w.minutes / max) * 100)}%`,
                  background: 'var(--mantine-color-blue-5)',
                  borderRadius: '4px 4px 0 0',
                  opacity: w.minutes ? 1 : 0.25,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {trend.map((w) => (
          <Text key={w.week} size='10px' c='dimmed' ta='center' style={{ flex: '1 0 22px' }}>
            {w.week.slice(8, 10)}/{w.week.slice(5, 7)}
          </Text>
        ))}
      </div>
    </Card>
  );
}

function TranscriptModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [data, setData] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setData(null);
    setFilter('');
    setLoading(true);
    fetch(`/api/meetings/transcript?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Transcript;
        if (!cancelled) setData(res.ok ? body : ({ ...body, available: false, lines: [], reason: body.error ?? 'No se pudo cargar la transcripción.' } as Transcript));
      })
      .catch(() => {
        if (!cancelled) setData({ available: false, lines: [], reason: 'No se pudo cargar la transcripción.' } as unknown as Transcript);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const lines = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!data?.lines) return [];
    return q ? data.lines.filter((l) => l.text.toLowerCase().includes(q) || l.speaker.toLowerCase().includes(q)) : data.lines;
  }, [data, filter]);

  const copy = () => {
    if (!data?.lines?.length) return;
    const text = data.lines.map((l) => `[${l.at}] ${l.speaker}: ${l.text}`).join('\n');
    void navigator.clipboard?.writeText(text);
  };

  return (
    <Modal
      opened={!!id}
      onClose={onClose}
      size='xl'
      title={<Text fw={600}>{data?.meeting?.subject ?? 'Transcripción'}</Text>}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {loading && (
        <Group justify='center' py='xl'>
          <Loader size='sm' />
          <Text size='sm' c='dimmed'>
            Cargando transcripción…
          </Text>
        </Group>
      )}
      {!loading && data && (
        <Stack gap='sm'>
          {data.meeting && (
            <Text size='sm' c='dimmed'>
              {formatDay(data.meeting.start)} · {formatTime(data.meeting.start)} – {formatTime(data.meeting.end)} · Organiza{' '}
              {data.meeting.isOrganizer ? 'usted' : data.meeting.organizerName}
            </Text>
          )}
          {!data.available ? (
            <Alert color='gray' icon={<IconFileText size={18} />}>
              {data.reason ?? 'La reunión no tiene transcripción.'}
            </Alert>
          ) : (
            <>
              <Group gap='sm'>
                <TextInput
                  placeholder='Buscar en la transcripción'
                  leftSection={<IconSearch size={14} />}
                  value={filter}
                  onChange={(e) => setFilter(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button variant='light' onClick={copy}>
                  Copiar
                </Button>
              </Group>
              <Text size='xs' c='dimmed'>
                {data.lines.length} intervenciones
                {filter ? ` · ${lines.length} con «${filter}»` : ''}
              </Text>
              <Stack gap={8}>
                {lines.map((l, i) => (
                  <div key={`${l.at}-${i}`}>
                    <Text size='xs' c='dimmed'>
                      <b>{l.speaker}</b> · {l.at}
                    </Text>
                    <Text size='sm'>{l.text}</Text>
                  </div>
                ))}
              </Stack>
            </>
          )}
        </Stack>
      )}
    </Modal>
  );
}

/** «Proyecto» column (2026-11-24): assigned project, simple suggestion (no AI) or «Asignar». */
function ProjectCell({
  meeting,
  item,
  onAssign,
}: {
  meeting: Meeting;
  item: MeetingProjectItemDto | undefined;
  onAssign: (m: Meeting, defaultProjectId: number | null, origin: 'manual' | 'sugerencia') => void;
}) {
  if (meeting.private) {
    return (
      <Text size='xs' c='dimmed'>
        Privada
      </Text>
    );
  }
  if (!item) return null;
  if (item.link) {
    return item.link.idProject ? (
      <Anchor component={Link} href={`/process/proyectos/${item.link.idProject}?seccion=reuniones`} size='sm'>
        <Group gap={4} wrap='nowrap'>
          <IconFolder size={14} />
          <Text size='sm' lineClamp={1}>
            {item.link.projectName}
          </Text>
        </Group>
        {item.link.origin === 'serie' && (
          <Text size='xs' c='dimmed'>
            por la serie
          </Text>
        )}
      </Anchor>
    ) : (
      <Text size='xs' c='dimmed'>
        En otro proyecto
      </Text>
    );
  }
  if (!item.canAssign) return null;
  if (item.suggestion) {
    const s = item.suggestion;
    return (
      <Stack gap={2}>
        <Tooltip label={`Sugerencia: ${SUGGESTION_REASON_LABELS[s.reason]}`} withArrow multiline w={240}>
          <Text size='xs' c='dimmed' lineClamp={1}>
            ¿{s.projectName}?
          </Text>
        </Tooltip>
        <Group gap={4} wrap='nowrap'>
          <Button size='compact-xs' variant='light' onClick={() => onAssign(meeting, s.idProject, 'sugerencia')} data-testid='reunion-sugerencia-si'>
            Sí
          </Button>
          <Button size='compact-xs' variant='subtle' color='gray' onClick={() => onAssign(meeting, null, 'manual')}>
            Otro
          </Button>
        </Group>
      </Stack>
    );
  }
  return (
    <Button size='compact-xs' variant='subtle' leftSection={<IconFolder size={14} />} onClick={() => onAssign(meeting, null, 'manual')} data-testid='reunion-asignar'>
      Asignar
    </Button>
  );
}

function MeetingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [days, setDays] = useState('30');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const transcriptId = params.get('reunion');
  // Meetings per project (2026-11-24).
  const [links, setLinks] = useState<MeetingsProjectsDto | null>(null);
  const [assign, setAssign] = useState<{ meeting: Meeting; defaultProjectId: number | null; origin: 'manual' | 'sugerencia' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLinks = useCallback(async (range: string) => {
    try {
      const res = await fetch(`/api/meetings/projects?days=${range}`, { cache: 'no-store' });
      if (res.ok) setLinks((await res.json()) as MeetingsProjectsDto);
    } catch {
      /* the column simply stays empty */
    }
  }, []);

  const load = useCallback(async (range: string) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch(`/api/meetings?days=${range}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as Overview;
      if (!res.ok) throw new Error(body.error ?? 'No se pudieron cargar sus reuniones.');
      setOverview(body);
      if (!body.enabled) return;
      void loadLinks(range);
      setAnalyzing(true);
      const a = await fetch(`/api/meetings/analysis?days=${range}`, { cache: 'no-store' });
      if (a.ok) setAnalysis((await a.json()) as Analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar sus reuniones.');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  }, [loadLinks]);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const byId = useMemo(() => new Map((analysis?.rows ?? []).map((r) => [r.id, r])), [analysis]);

  const meetings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = overview?.meetings ?? [];
    return q ? all.filter((m) => m.subject.toLowerCase().includes(q) || m.organizerName.toLowerCase().includes(q)) : all;
  }, [overview, search]);

  const openTranscript = (id: string) => router.replace(`/process/reuniones?reunion=${encodeURIComponent(id)}`, { scroll: false });
  const closeTranscript = () => router.replace('/process/reuniones', { scroll: false });

  const s = overview?.summary;
  const p = overview?.previous;
  const a = analysis?.summary;

  return (
    <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'>
      <Breadcrumbs mb='sm'>
        <Anchor component={Link} href='/process' size='sm'>
          Procesos
        </Anchor>
        <Text size='sm'>Mis reuniones</Text>
      </Breadcrumbs>

      <Group justify='space-between' align='flex-end' mb='md' wrap='wrap'>
        <div>
          <Title order={2}>Mis reuniones</Title>
          <Text size='sm' c='dimmed'>
            Reuniones de Teams y del calendario de {session?.user?.email ?? 'su cuenta'}.
          </Text>
        </div>
        <Group gap='sm'>
          <SegmentedControl value={days} onChange={setDays} data={RANGES} />
          <Tooltip label='Actualizar' withArrow>
            <Button variant='subtle' onClick={() => void load(days)} aria-label='Actualizar' px={8}>
              <IconRefresh size={18} />
            </Button>
          </Tooltip>
        </Group>
      </Group>

      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} mb='md'>
          {error}
        </Alert>
      )}

      {notice && (
        <Alert color='green' icon={<IconCircleCheck size={18} />} mb='md' withCloseButton onClose={() => setNotice(null)} role='status' data-testid='reuniones-aviso'>
          {notice}
        </Alert>
      )}

      {overview && !overview.enabled && (
        <Alert color='gray' mb='md'>
          El módulo de reuniones todavía no está habilitado para su cuenta.
        </Alert>
      )}

      {loading && !overview && (
        <Group justify='center' py='xl'>
          <Loader />
        </Group>
      )}

      {overview?.enabled && s && p && (
        <Stack gap='md'>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            <Kpi label='Reuniones' value={String(s.meetings)}>
              <Delta current={s.meetings} previous={p.meetings} />
            </Kpi>
            <Kpi label='Tiempo en reuniones' value={formatMinutes(s.minutes)}>
              <Delta current={s.minutes} previous={p.minutes} invert />
            </Kpi>
            <Kpi label='Duración promedio' value={formatMinutes(s.averageMinutes)}>
              <Delta current={s.averageMinutes} previous={p.averageMinutes} invert />
            </Kpi>
            <Kpi label='Organizadas por usted' value={`${s.organizedByMe} de ${s.meetings}`}>
              <Text size='xs' c='dimmed'>
                {s.meetingsPerWorkday} reuniones por día hábil · {s.longMeetings} de más de 1 h
              </Text>
            </Kpi>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            <Kpi
              label='Puntualidad'
              value={a?.onTimePct != null ? `${a.onTimePct}%` : analyzing ? '…' : '—'}
              hint={`Reuniones de Teams que arrancaron a más tardar ${ON_TIME_TOLERANCE_MIN} min después de la hora programada (informe de asistencia de Teams).`}
            >
              <Text size='xs' c='dimmed'>
                {a ? `Retraso promedio ${formatMinutes(a.averageDelayMinutes)} · ${a.withData} medidas` : analyzing ? 'Analizando asistencia…' : ''}
              </Text>
            </Kpi>
            <Kpi
              label='Se pasaron de tiempo'
              value={a?.overranPct != null ? `${a.overranPct}%` : analyzing ? '…' : '—'}
              hint={`Reuniones que duraron ${OVERRUN_TOLERANCE_MIN} min o más de lo programado.`}
            >
              <Text size='xs' c='dimmed'>{a ? `Duración real promedio ${formatMinutes(a.averageActualMinutes)}` : ''}</Text>
            </Kpi>
            <Kpi label='Con transcripción' value={a ? `${a.withTranscript} de ${a.analyzed}` : analyzing ? '…' : '—'}>
              <Text size='xs' c='dimmed'>Reuniones de Teams transcritas</Text>
            </Kpi>
            <Kpi label='Periodo' value={`${overview.days} días`}>
              <Text size='xs' c='dimmed'>
                {formatDay(overview.from)} – {formatDay(overview.to)}
              </Text>
            </Kpi>
          </SimpleGrid>
          {analysis?.truncated && (
            <Text size='xs' c='dimmed'>
              La puntualidad y la transcripción se midieron en las 60 reuniones de Teams más recientes del periodo.
            </Text>
          )}

          <WeeklyBars trend={overview.trend} />

          <Card withBorder radius='md' padding='md'>
            <Group justify='space-between' mb='sm' wrap='wrap'>
              <Text fw={600} size='sm'>
                Historial ({meetings.length})
              </Text>
              <TextInput
                placeholder='Buscar por asunto u organizador'
                leftSection={<IconSearch size={14} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                w={280}
              />
            </Group>
            {meetings.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py='lg'>
                No hay reuniones en este periodo.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={900}>
                <Table highlightOnHover verticalSpacing='xs'>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Reunión</Table.Th>
                      <Table.Th>Organiza</Table.Th>
                      <Table.Th>Programada</Table.Th>
                      <Table.Th>Real</Table.Th>
                      <Table.Th>Inicio</Table.Th>
                      {links?.available && <Table.Th>Proyecto</Table.Th>}
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {meetings.map((m) => {
                      const r = byId.get(m.id);
                      const late = r?.startDelayMinutes != null && r.startDelayMinutes > ON_TIME_TOLERANCE_MIN;
                      return (
                        <Table.Tr key={m.id}>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            <Text size='sm'>{formatDay(m.start)}</Text>
                            <Text size='xs' c='dimmed'>
                              {formatTime(m.start)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap='nowrap'>
                              {m.isOrganizer && <IconCrown size={14} color='var(--mantine-color-yellow-6)' aria-label='Usted organizó' />}
                              <Text size='sm' fw={500} lineClamp={2}>
                                {m.subject}
                              </Text>
                            </Group>
                            <Text size='xs' c='dimmed'>
                              {m.attendees} invitados{m.recurring ? ' · periódica' : ''}
                              {r?.participants ? ` · ${r.participants} se conectaron` : ''}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{m.isOrganizer ? 'Usted' : m.organizerName}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{formatMinutes(m.scheduledMinutes)}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' c={r?.overrunMinutes != null && r.overrunMinutes >= OVERRUN_TOLERANCE_MIN ? 'orange' : undefined}>
                              {r?.actualMinutes != null ? formatMinutes(r.actualMinutes) : m.online ? (analyzing ? '…' : '—') : 'Presencial'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {r?.startDelayMinutes != null ? (
                              <Badge size='sm' variant='light' color={late ? 'orange' : 'teal'} leftSection={<IconClockHour4 size={12} />}>
                                {late ? `+${formatMinutes(r.startDelayMinutes)}` : 'A tiempo'}
                              </Badge>
                            ) : (
                              <Text size='sm' c='dimmed'>
                                —
                              </Text>
                            )}
                          </Table.Td>
                          {links?.available && (
                            <Table.Td style={{ maxWidth: 200 }}>
                              <ProjectCell
                                meeting={m}
                                item={links.items[m.id]}
                                onAssign={(meeting, defaultProjectId, origin) => setAssign({ meeting, defaultProjectId, origin })}
                              />
                            </Table.Td>
                          )}
                          <Table.Td>
                            {m.online && (
                              <Button
                                size='compact-xs'
                                variant={r?.hasTranscript ? 'light' : 'subtle'}
                                color={r?.hasTranscript ? 'blue' : 'gray'}
                                leftSection={<IconFileText size={14} />}
                                onClick={() => openTranscript(m.id)}
                              >
                                {r?.hasTranscript ? 'Transcripción' : 'Ver'}
                              </Button>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </Stack>
      )}

      <TranscriptModal id={transcriptId} onClose={closeTranscript} />
      <AssignMeetingModal
        opened={assign !== null}
        onClose={() => setAssign(null)}
        meeting={assign?.meeting ?? null}
        projects={links?.projects ?? []}
        defaultProjectId={assign?.defaultProjectId ?? null}
        origin={assign?.origin ?? 'manual'}
        onDone={(r) => {
          const name = links?.projects.find((p) => p.idProject === r.idProject)?.name ?? 'el proyecto';
          const text = r.seriesRule
            ? `Reunión asignada a «${name}» con toda su serie: las próximas quedarán asignadas solas.`
            : `Reunión asignada a «${name}». El equipo del proyecto ya la ve en su sección «Reuniones».`;
          setNotice(text);
          toast.success(text);
          setAssign(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          void loadLinks(days);
        }}
      />
    </div>
  );
}

export default function MeetingsPageRoute() {
  return (
    <Suspense
      fallback={
        <Group justify='center' py='xl'>
          <Loader />
        </Group>
      }
    >
      <MeetingsPage />
    </Suspense>
  );
}
