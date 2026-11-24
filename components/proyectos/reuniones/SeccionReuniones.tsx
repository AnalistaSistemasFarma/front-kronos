'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  ActionIcon,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDotsVertical,
  IconFileText,
  IconMail,
  IconPlus,
  IconRefresh,
  IconRepeat,
  IconSearch,
  IconSparkles,
  IconTrash,
} from '@tabler/icons-react';
import type { ProyectoDetalleDto } from '../../../lib/proyectos/tipos';
import { formatDay, formatMinutes, formatTime } from '../../../lib/meetings/format';
import type { SpeakerShare, TranscriptLine } from '../../../lib/meetings/metrics';
import { ORIGIN_LABELS } from '../../../lib/meetings/projects/rules';
import type { MeetingAnalysisDto, ProjectMeetingDto, ProjectMeetingsDto } from '../../../lib/meetings/projects/types';
import AssignMeetingModal from '../../meetings/AssignMeetingModal';
import { apiGet, apiSend } from '../api';
import { ConfirmarModal } from '../modales';
import type { Aviso } from '../ui';

/**
 * Sección «Reuniones» de un proyecto (2026-11-24; aprobado por Nicolás Rivera, conv. 1, msg 38206).
 *
 * Lo que ve cualquier miembro: las reuniones asignadas al proyecto (asunto, fecha, duración, cuántos
 * asistieron y el resumen de quien la asignó), los indicadores del periodo y el análisis del asistente.
 * La transcripción y la participación por persona solo las ven quienes asistieron. Sin ranking de personas:
 * el índice de efectividad es de la REUNIÓN. El análisis es a demanda (botón «Analizar»), lo hace el
 * asistente del proyecto y sus compromisos llegan al Cronograma como propuestas para confirmar.
 */

const RANGOS = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '180', label: '6 meses' },
  { value: '365', label: '1 año' },
];
const REFRESCO_MS = 10_000;

type Respuesta = ProjectMeetingsDto & { available: boolean; error?: string };

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder radius='md' padding='sm'>
      <Text size='xs' c='dimmed'>
        {label}
      </Text>
      <Text fw={700} fz={22}>
        {value}
      </Text>
      {hint && (
        <Text size='xs' c='dimmed'>
          {hint}
        </Text>
      )}
    </Card>
  );
}

function colorPuntaje(score: number): string {
  return score >= 75 ? 'teal' : score >= 50 ? 'yellow' : 'orange';
}

function EstadoAnalisis({
  m,
  puedePedir,
  pidiendo,
  onAnalizar,
  onVer,
}: {
  m: ProjectMeetingDto;
  puedePedir: boolean;
  pidiendo: boolean;
  onAnalizar: () => void;
  onVer: () => void;
}) {
  const a = m.analysis;
  if (a?.status === 'analizando') {
    return (
      <Badge variant='light' color='blue' leftSection={<Loader size={10} />} data-testid='reunion-analizando'>
        Analizando…
      </Badge>
    );
  }
  if (a?.status === 'listo' && a.score !== null) {
    return (
      <Button size='compact-xs' variant='light' color={colorPuntaje(a.score)} onClick={onVer} data-testid='reunion-ver-analisis'>
        {a.score}/100 · Ver
      </Button>
    );
  }
  return (
    <Group gap={4} wrap='nowrap'>
      {a?.status === 'fallido' && (
        <Tooltip label={a.error ?? 'El análisis falló.'} withArrow multiline w={260}>
          <Badge variant='light' color='red' style={{ cursor: 'pointer' }} onClick={onVer}>
            Falló
          </Badge>
        </Tooltip>
      )}
      {puedePedir && m.online && m.hasTranscript !== false && (
        <Button size='compact-xs' variant='light' leftSection={<IconSparkles size={14} />} loading={pidiendo} onClick={onAnalizar} data-testid='reunion-analizar'>
          {a ? 'Reintentar' : 'Analizar'}
        </Button>
      )}
      {!a && (!m.online || m.hasTranscript === false) && (
        <Text size='xs' c='dimmed'>
          Sin transcripción
        </Text>
      )}
    </Group>
  );
}

function Participacion({ datos }: { datos: SpeakerShare[] }) {
  if (datos.length === 0) return null;
  return (
    <Stack gap={4}>
      {datos.map((s) => (
        <div key={s.speaker}>
          <Group justify='space-between' gap={6}>
            <Text size='xs'>{s.speaker}</Text>
            <Text size='xs' c='dimmed'>
              {s.pct} % · {s.interventions} intervenciones
            </Text>
          </Group>
          <Progress value={s.pct} size='sm' radius='xl' />
        </div>
      ))}
    </Stack>
  );
}

function Lista({ titulo, items }: { titulo: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <Text fw={600} size='sm' mb={4}>
        {titulo}
      </Text>
      <Stack gap={2}>
        {items.map((t, i) => (
          <Text key={i} size='sm'>
            • {t}
          </Text>
        ))}
      </Stack>
    </div>
  );
}

const ESTADO_PROPUESTA: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Por confirmar', color: 'yellow' },
  ejecutando: { label: 'Confirmando', color: 'blue' },
  confirmada: { label: 'En el cronograma', color: 'teal' },
  rechazada: { label: 'Descartada', color: 'gray' },
  vencida: { label: 'Vencida', color: 'gray' },
  fallida: { label: 'Falló', color: 'red' },
};

function AnalisisModal({
  idProject,
  reunion,
  onClose,
  onReanalizar,
  onIrACronograma,
}: {
  idProject: number;
  reunion: ProjectMeetingDto | null;
  onClose: () => void;
  onReanalizar: (m: ProjectMeetingDto) => void;
  onIrACronograma: () => void;
}) {
  const [datos, setDatos] = useState<MeetingAnalysisDto | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripcion, setTranscripcion] = useState<{ lines: TranscriptLine[]; participation: SpeakerShare[]; available: boolean; reason: string | null } | null>(null);
  const [cargandoT, setCargandoT] = useState(false);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    if (!reunion) return;
    let cancelado = false;
    setDatos(null);
    setError(null);
    setTranscripcion(null);
    setFiltro('');
    setCargando(true);
    void apiGet<{ analysis: MeetingAnalysisDto | null }>(`/api/proyectos/${idProject}/reuniones/${reunion.id}/analisis`, 'No se pudo cargar el análisis.').then((r) => {
      if (cancelado) return;
      setCargando(false);
      if (r.ok) setDatos(r.data.analysis);
      else setError(r.error);
    });
    return () => {
      cancelado = true;
    };
  }, [idProject, reunion]);

  const verTranscripcion = async () => {
    if (!reunion) return;
    setCargandoT(true);
    const r = await apiGet<{ lines: TranscriptLine[]; participation: SpeakerShare[]; available: boolean; reason: string | null }>(
      `/api/proyectos/${idProject}/reuniones/${reunion.id}/transcripcion`,
      'No se pudo cargar la transcripción.'
    );
    setCargandoT(false);
    if (r.ok) setTranscripcion(r.data);
    else setError(r.error);
  };

  const lineas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const all = transcripcion?.lines ?? [];
    return q ? all.filter((l) => l.text.toLowerCase().includes(q) || l.speaker.toLowerCase().includes(q)) : all;
  }, [transcripcion, filtro]);

  const res = datos?.result ?? null;
  const met = datos?.metrics ?? null;
  return (
    <Modal opened={reunion !== null} onClose={onClose} size='xl' title={<Text fw={600}>Análisis: {reunion?.subject}</Text>} scrollAreaComponent={ScrollArea.Autosize}>
      {cargando && (
        <Group justify='center' py='lg'>
          <Loader size='sm' />
        </Group>
      )}
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} mb='sm' role='alert'>
          {error}
        </Alert>
      )}
      {!cargando && reunion && (
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            {formatDay(reunion.start)} · {formatTime(reunion.start)} · {reunion.organizerName ? `Organiza ${reunion.organizerName} · ` : ''}
            {datos?.agent ? `Asistente: ${datos.agent.displayName} · ` : ''}
            {datos ? `Lo pidió ${datos.requestedBy}` : 'Sin análisis todavía'}
          </Text>

          {datos?.status === 'analizando' && (
            <Alert color='blue' icon={<Loader size={16} />}>
              {datos.agent?.displayName ?? 'El asistente'} está analizando la reunión. El resultado aparece aquí en unos minutos.
            </Alert>
          )}
          {datos?.status === 'fallido' && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />}>
              {datos.error ?? 'El análisis falló.'}
            </Alert>
          )}

          {met && (
            <Group gap='xs'>
              {res && (
                <Badge size='lg' color={colorPuntaje(res.score)} variant='filled'>
                  Efectividad {res.score}/100
                </Badge>
              )}
              {met.startDelayMinutes !== null && (
                <Badge variant='light' color={met.startDelayMinutes <= 5 ? 'teal' : 'orange'}>
                  {met.startDelayMinutes <= 5 ? 'Puntual' : `Arrancó ${formatMinutes(met.startDelayMinutes)} tarde`}
                </Badge>
              )}
              {met.actualMinutes !== null && (
                <Badge variant='light' color={(met.overrunMinutes ?? 0) >= 5 ? 'orange' : 'gray'}>
                  Duró {formatMinutes(met.actualMinutes)} de {formatMinutes(met.scheduledMinutes)}
                </Badge>
              )}
              {met.attendedCount !== null && (
                <Badge variant='light' color='gray'>
                  Asistieron {met.attendedCount} de {met.attendeesCount}
                </Badge>
              )}
              {met.silentAttendees !== null && met.silentAttendees > 0 && (
                <Badge variant='light' color='gray'>
                  {met.silentAttendees} no intervinieron
                </Badge>
              )}
              {res?.couldBeEmail && (
                <Badge variant='light' color='violet' leftSection={<IconMail size={12} />}>
                  Pudo ser un correo
                </Badge>
              )}
            </Group>
          )}

          {res && (
            <>
              <Text size='sm'>{res.summary}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='md'>
                <Lista titulo={`Decisiones (${res.decisions.length})`} items={res.decisions} />
                <Lista titulo='Solo se discutió' items={res.discussed} />
              </SimpleGrid>
              {res.commitments.length > 0 && (
                <div>
                  <Group justify='space-between' mb={4}>
                    <Text fw={600} size='sm'>
                      Compromisos ({res.commitments.length})
                    </Text>
                    {(datos?.proposals.length ?? 0) > 0 && (
                      <Button size='compact-xs' variant='subtle' onClick={onIrACronograma}>
                        Confirmarlos en el Cronograma
                      </Button>
                    )}
                  </Group>
                  <Stack gap={4}>
                    {res.commitments.map((c, i) => {
                      const p = datos?.proposals[i];
                      const e = p ? ESTADO_PROPUESTA[p.status] : undefined;
                      return (
                        <Group key={i} justify='space-between' wrap='nowrap' gap='xs'>
                          <Text size='sm'>
                            • {c.task}
                            {c.owner ? ` — ${c.owner}` : ''}
                            {c.dueDate ? ` (${c.dueDate})` : ''}
                          </Text>
                          {e && (
                            <Badge size='xs' variant='light' color={e.color} style={{ flexShrink: 0 }}>
                              {e.label}
                            </Badge>
                          )}
                        </Group>
                      );
                    })}
                  </Stack>
                </div>
              )}
              {res.followup.length > 0 && (
                <Lista
                  titulo='Compromisos de la reunión anterior'
                  items={res.followup.map((f) => `${f.commitment}: ${f.status === 'cumplido' ? 'cumplido' : f.status === 'pendiente' ? 'pendiente' : 'sin información'}${f.note ? ` (${f.note})` : ''}`)}
                />
              )}
              <Lista titulo='Temas que se repiten sin resolverse' items={res.recurringTopics} />
              {res.agendaRespected !== null && (
                <Text size='sm'>
                  <b>Agenda:</b> {res.agendaRespected ? 'se respetó' : 'no se respetó'}
                  {res.agendaNote ? ` — ${res.agendaNote}` : ''}
                </Text>
              )}
              <Lista titulo='Recomendaciones para la próxima' items={res.recommendations} />
            </>
          )}

          {datos?.viewerAttended && met?.participation && met.participation.length > 0 && (
            <div>
              <Text fw={600} size='sm' mb={4}>
                Participación (solo la ven quienes asistieron)
              </Text>
              <Participacion datos={met.participation} />
            </div>
          )}

          <Group justify='space-between'>
            {datos?.viewerAttended || !datos ? (
              <Button variant='default' size='xs' leftSection={<IconFileText size={14} />} loading={cargandoT} onClick={() => void verTranscripcion()} data-testid='reunion-ver-transcripcion'>
                Ver transcripción (solo asistentes)
              </Button>
            ) : (
              <Text size='xs' c='dimmed'>
                La transcripción solo la ven quienes asistieron.
              </Text>
            )}
            {datos?.canRequest && datos.status !== 'analizando' && (
              <Button size='xs' variant='light' leftSection={<IconRefresh size={14} />} onClick={() => onReanalizar(reunion)}>
                Volver a analizar
              </Button>
            )}
          </Group>

          {transcripcion && (
            <Card withBorder radius='md' padding='sm'>
              {!transcripcion.available ? (
                <Text size='sm' c='dimmed'>
                  {transcripcion.reason ?? 'La reunión no tiene transcripción.'}
                </Text>
              ) : (
                <Stack gap='xs'>
                  <TextInput size='xs' placeholder='Buscar en la transcripción' leftSection={<IconSearch size={14} />} value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} />
                  {!met?.participation && <Participacion datos={transcripcion.participation} />}
                  <ScrollArea.Autosize mah={320}>
                    <Stack gap={6}>
                      {lineas.map((l, i) => (
                        <div key={`${l.at}-${i}`}>
                          <Text size='xs' c='dimmed'>
                            <b>{l.speaker}</b> · {l.at}
                          </Text>
                          <Text size='sm'>{l.text}</Text>
                        </div>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                </Stack>
              )}
            </Card>
          )}
        </Stack>
      )}
    </Modal>
  );
}

export default function SeccionReuniones({
  proyecto,
  version,
  avisar,
  onIrACronograma,
}: {
  proyecto: ProyectoDetalleDto;
  version: number;
  avisar: (a: Aviso) => void;
  onIrACronograma: () => void;
}) {
  const [dias, setDias] = useState('90');
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asignar, setAsignar] = useState(false);
  const [viendo, setViendo] = useState<ProjectMeetingDto | null>(null);
  const [pidiendo, setPidiendo] = useState<number | null>(null);
  const [quitar, setQuitar] = useState<ProjectMeetingDto | null>(null);
  const [quitarRegla, setQuitarRegla] = useState<{ id: number; subject: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const borrar = async (url: string, porDefecto: string, ok: string, cerrar: () => void) => {
    setOcupado(true);
    const r = await apiSend('DELETE', url, undefined, porDefecto);
    setOcupado(false);
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error });
      return;
    }
    cerrar();
    avisar({ tipo: 'ok', texto: ok });
    void cargar();
  };

  const cargar = useCallback(async () => {
    const r = await apiGet<Respuesta>(`/api/proyectos/${proyecto.idProject}/reuniones?days=${dias}`, 'No se pudieron cargar las reuniones.');
    if (r.ok) {
      setDatos(r.data);
      setError(null);
    } else setError(r.error);
  }, [proyecto.idProject, dias]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  // While an analysis is running, refresh on its own.
  const enCurso = datos?.meetings?.some((m) => m.analysis?.status === 'analizando') ?? false;
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(() => void cargar(), REFRESCO_MS);
    return () => clearInterval(t);
  }, [enCurso, cargar]);

  const analizar = async (m: ProjectMeetingDto) => {
    setPidiendo(m.id);
    const r = await apiSend<{ id: number; agentName: string }>('POST', `/api/proyectos/${proyecto.idProject}/reuniones/${m.id}/analisis`, undefined, 'No se pudo pedir el análisis.');
    setPidiendo(null);
    if (r.ok) {
      avisar({ tipo: 'ok', texto: `${r.data.agentName} está analizando «${m.subject}». El resultado aparece aquí en unos minutos.` });
      setViendo(null);
      void cargar();
    } else avisar({ tipo: 'error', texto: r.error });
  };

  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} m='sm'>
        {error}
      </Alert>
    );
  }
  if (!datos) {
    return (
      <Group justify='center' py='xl'>
        <Loader size='sm' />
      </Group>
    );
  }
  if (!datos.available) {
    return (
      <Alert color='gray' m='sm'>
        {datos.error ?? 'Las reuniones por proyecto todavía no están disponibles.'}
      </Alert>
    );
  }
  const k = datos.kpis;
  const puedeAnalizar = datos.viewer.meetingsEnabled && proyecto.capabilities.write && !proyecto.archived;

  return (
    <Stack gap='md' p='sm' data-testid='seccion-reuniones'>
      <Group justify='space-between' wrap='wrap' gap='sm'>
        <SegmentedControl size='xs' value={dias} onChange={setDias} data={RANGOS} />
        {datos.viewer.canAssign ? (
          <Button size='xs' leftSection={<IconPlus size={14} />} onClick={() => setAsignar(true)} data-testid='reuniones-asignar'>
            Asignar reunión
          </Button>
        ) : (
          proyecto.capabilities.contribute &&
          !datos.viewer.meetingsEnabled && (
            <Text size='xs' c='dimmed'>
              Para asignar reuniones necesita el módulo «Mis reuniones».
            </Text>
          )
        )}
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing='sm'>
        <Kpi label='Reuniones' value={String(k.meetings)} hint={k.withActuals ? `${k.onTime} de ${k.withActuals} puntuales` : undefined} />
        <Kpi label='Horas-persona' value={`${k.personHours.toLocaleString('es-CO')} h`} hint='Duración × asistentes' />
        <Kpi label='Con decisión' value={`${k.withDecisions} de ${k.analyzed}`} hint='De las reuniones analizadas' />
        <Kpi label='Compromisos' value={String(k.commitments)} hint={`${k.proposalsConfirmed} ya en el cronograma`} />
      </SimpleGrid>

      {datos.rules.length > 0 && (
        <Card withBorder radius='md' padding='sm'>
          <Text fw={600} size='sm' mb={4}>
            Series que se asignan solas
          </Text>
          <Stack gap={4}>
            {datos.rules.map((r) => (
              <Group key={r.id} justify='space-between' wrap='wrap' gap={4}>
                <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                  <IconRepeat size={14} />
                  <Text size='sm'>
                    {r.subject}{' '}
                    <Text span size='xs' c='dimmed'>
                      · regla de {r.createdBy}
                    </Text>
                  </Text>
                </Group>
                {r.canDelete && (
                  <Button size='compact-xs' variant='subtle' color='red' onClick={() => setQuitarRegla({ id: r.id, subject: r.subject })}>
                    Quitar regla
                  </Button>
                )}
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      {datos.meetings.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='lg'>
          No hay reuniones asignadas en este periodo. Asígnelas desde «Mis reuniones» o con el botón «Asignar reunión».
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing='xs' highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Reunión</Table.Th>
                <Table.Th>Duración</Table.Th>
                <Table.Th>Asistentes</Table.Th>
                <Table.Th>Análisis</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {datos.meetings.map((m) => (
                <Table.Tr key={m.id} data-testid='reunion-fila'>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text size='sm'>{formatDay(m.start)}</Text>
                    <Text size='xs' c='dimmed'>
                      {formatTime(m.start)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' fw={500} lineClamp={2}>
                      {m.subject}
                    </Text>
                    {m.summary && (
                      <Text size='xs' c='dimmed' lineClamp={2}>
                        {m.summary}
                      </Text>
                    )}
                    <Text size='xs' c='dimmed'>
                      {ORIGIN_LABELS[m.origin]} por {m.linkedByMe ? 'usted' : m.linkedBy}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text size='sm' c={m.actualMinutes !== null && m.actualMinutes - m.scheduledMinutes >= 5 ? 'orange' : undefined}>
                      {formatMinutes(m.actualMinutes ?? m.scheduledMinutes)}
                    </Text>
                    {m.actualMinutes !== null && (
                      <Text size='xs' c='dimmed'>
                        de {formatMinutes(m.scheduledMinutes)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{m.attendedCount !== null ? `${m.attendedCount} de ${m.attendeesCount}` : m.attendeesCount}</Text>
                  </Table.Td>
                  <Table.Td>
                    <EstadoAnalisis m={m} puedePedir={puedeAnalizar} pidiendo={pidiendo === m.id} onAnalizar={() => void analizar(m)} onVer={() => setViendo(m)} />
                  </Table.Td>
                  <Table.Td>
                    <Menu position='bottom-end' withinPortal>
                      <Menu.Target>
                        <ActionIcon variant='subtle' color='gray' aria-label='Acciones de la reunión'>
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconCircleCheck size={14} />} onClick={() => setViendo(m)}>
                          Ver análisis y transcripción
                        </Menu.Item>
                        {m.canRemove && (
                          <Menu.Item color='red' leftSection={<IconTrash size={14} />} onClick={() => setQuitar(m)}>
                            Quitar del proyecto
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Text size='xs' c='dimmed'>
        El índice de efectividad es de la reunión, nunca de las personas. La transcripción solo la ven quienes asistieron y no se guarda en SynerLink.
      </Text>

      <AssignMeetingModal
        opened={asignar}
        onClose={() => setAsignar(false)}
        project={{ idProject: proyecto.idProject, name: proyecto.name }}
        onDone={(r) => {
          setAsignar(false);
          avisar({ tipo: 'ok', texto: r.seriesRule ? 'Reunión asignada con toda su serie: las próximas quedarán asignadas solas.' : 'Reunión asignada al proyecto.' });
          void cargar();
        }}
      />
      <AnalisisModal idProject={proyecto.idProject} reunion={viendo} onClose={() => setViendo(null)} onReanalizar={(m) => void analizar(m)} onIrACronograma={onIrACronograma} />
      <ConfirmarModal
        opened={quitar !== null}
        titulo='Quitar la reunión del proyecto'
        texto={`«${quitar?.subject ?? ''}» deja de verse en el proyecto, junto con su análisis. Las tareas que ya se crearon en el cronograma no cambian.`}
        accion='Quitar'
        color='red'
        cargando={ocupado}
        onClose={() => setQuitar(null)}
        onConfirmar={() => {
          if (quitar) void borrar(`/api/proyectos/${proyecto.idProject}/vinculos/reuniones/${quitar.id}`, 'No se pudo quitar la reunión.', 'Reunión quitada del proyecto.', () => setQuitar(null));
        }}
      />
      <ConfirmarModal
        opened={quitarRegla !== null}
        titulo='Quitar la regla de la serie'
        texto={`Las próximas reuniones de «${quitarRegla?.subject ?? ''}» ya no se asignarán solas. Las que ya están en el proyecto se quedan.`}
        accion='Quitar regla'
        color='red'
        cargando={ocupado}
        onClose={() => setQuitarRegla(null)}
        onConfirmar={() => {
          if (quitarRegla) void borrar(`/api/meetings/rules/${quitarRegla.id}`, 'No se pudo quitar la regla.', 'Regla de la serie quitada.', () => setQuitarRegla(null));
        }}
      />
    </Stack>
  );
}
