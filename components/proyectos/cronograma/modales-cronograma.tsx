'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Radio,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Timeline,
  UnstyledButton,
} from '@mantine/core';
import { IconCalendarEvent, IconExternalLink, IconHistory, IconKey, IconListDetails, IconPencil, IconTicket, IconTrash } from '@tabler/icons-react';
import AgentAvatar from '../../chat/AgentAvatar';
import {
  ESTADO_VISUAL_COLOR,
  ESTADO_VISUAL_LABELS,
  estadoVisualTarea,
  fechaLargaIso,
  fechasDeActividad,
  fechasDeSolicitud,
  MAX_TASK_DESCRIPTION_CHARS,
  MAX_TASK_TITLE_CHARS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from '../../../lib/proyectos/cronograma-rules';
import type { ConcesionProyectoDto, CronogramaDto, EventoAuditoriaDto, ProyectoDetalleDto, SolicitudCronogramaDto, TareaDto } from '../../../lib/proyectos/tipos';
import { apiGet, apiSend, fechaCorta } from '../api';
import { ErrorArriba, Marco } from '../modales';
import { EsqueletoFilas } from '../ui';
import css from '../proyectos.module.css';

/* ───────────────────────────── Crear / editar tarea ───────────────────────────── */

interface Formulario {
  title: string;
  description: string;
  idResponsible: string;
  startDate: string;
  endDate: string;
  status: TaskStatus;
  progress: number | '';
  isMilestone: boolean;
}

function vacio(hoy: string): Formulario {
  return { title: '', description: '', idResponsible: '', startDate: hoy, endDate: hoy, status: 'pendiente', progress: '', isMilestone: false };
}

function desdeTarea(t: TareaDto): Formulario {
  return {
    title: t.title,
    description: t.description ?? '',
    idResponsible: t.responsible?.id ?? '',
    startDate: t.startDate,
    endDate: t.endDate,
    status: t.status,
    progress: t.progress ?? '',
    isMilestone: t.isMilestone,
  };
}

/**
 * Nueva tarea o edición. Responsable con NativeSelect (en el celular el Select de Mantine se
 * cierra solo cerca del final de la página: memoria «gotcha-select-mantine-movil-se-cierra»);
 * fechas con el selector nativo del navegador (sin librerías nuevas). El error va ARRIBA.
 */
export function TareaModal({
  opened,
  idProject,
  cronograma,
  tarea,
  onClose,
  onGuardada,
}: {
  opened: boolean;
  idProject: number;
  cronograma: CronogramaDto;
  tarea: TareaDto | null;
  onClose: () => void;
  onGuardada: (texto: string) => void;
}) {
  const [f, setF] = useState<Formulario>(() => vacio(cronograma.hoy));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setF(tarea ? desdeTarea(tarea) : vacio(cronograma.hoy));
    setError(null);
  }, [opened, tarea, cronograma.hoy]);

  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));

  const guardar = async () => {
    setError(null);
    if (!f.title.trim()) return setError('Escriba el título de la tarea.');
    if (!f.startDate) return setError('Escoja la fecha de inicio.');
    if (!f.isMilestone && f.endDate && f.endDate < f.startDate) return setError('La fecha de fin no puede ser anterior a la de inicio.');
    setGuardando(true);
    const cuerpo = {
      title: f.title,
      description: f.description.trim() || null,
      idResponsible: f.idResponsible || null,
      startDate: f.startDate,
      endDate: f.isMilestone ? f.startDate : f.endDate || f.startDate,
      status: f.status,
      progress: f.progress === '' ? null : f.progress,
      isMilestone: f.isMilestone,
    };
    const base = `/api/proyectos/${idProject}/cronograma/tareas`;
    const r = tarea ? await apiSend('PATCH', `${base}/${tarea.id}`, cuerpo, 'No se pudo guardar la tarea.') : await apiSend('POST', base, cuerpo, 'No se pudo crear la tarea.');
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    onGuardada(tarea ? 'Tarea actualizada.' : f.isMilestone ? 'Hito creado en el cronograma.' : 'Tarea creada en el cronograma.');
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo={tarea ? 'Editar tarea' : 'Nueva tarea'}
      icono={<IconListDetails size={20} />}
      testId='cronograma-modal-tarea'
      pie={
        <>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} loading={guardando} data-testid='cronograma-guardar-tarea'>
            {tarea ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <TextInput label='Título' required value={f.title} maxLength={MAX_TASK_TITLE_CHARS} onChange={(e) => set('title', e.currentTarget.value)} data-autofocus data-testid='tarea-titulo' />
      <Textarea label='Descripción' autosize minRows={2} maxRows={6} maxLength={MAX_TASK_DESCRIPTION_CHARS} value={f.description} onChange={(e) => set('description', e.currentTarget.value)} />
      <NativeSelect
        label='Responsable'
        value={f.idResponsible}
        onChange={(e) => set('idResponsible', e.currentTarget.value)}
        data={[{ value: '', label: 'Sin responsable' }, ...cronograma.members.map((m) => ({ value: m.id, label: m.name }))]}
        data-testid='tarea-responsable'
      />
      <Switch label='Es un hito (un solo día)' checked={f.isMilestone} onChange={(e) => set('isMilestone', e.currentTarget.checked)} />
      <Group grow align='flex-start' gap='sm' wrap='wrap'>
        <TextInput type='date' label={f.isMilestone ? 'Fecha' : 'Inicio'} required value={f.startDate} onChange={(e) => set('startDate', e.currentTarget.value)} miw={150} data-testid='tarea-inicio' />
        {!f.isMilestone && <TextInput type='date' label='Fin' value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.currentTarget.value)} miw={150} data-testid='tarea-fin' />}
      </Group>
      <div>
        <Text size='sm' fw={500} mb={4}>
          Estado
        </Text>
        <SegmentedControl fullWidth value={f.status} onChange={(v) => set('status', v as TaskStatus)} data={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))} data-testid='tarea-estado' />
      </div>
      <NumberInput hideControls inputMode='numeric' label='Avance (%)' description='Opcional.' min={0} max={100} clampBehavior='strict' allowDecimal={false} value={f.progress} onChange={(v) => set('progress', v === '' ? '' : Number(v))} maw={200} />
    </Marco>
  );
}

/* ───────────────────────────── Detalle de una tarea ───────────────────────────── */

const ACCION: Record<string, string> = { crear: 'Creó', editar: 'Editó', estado: 'Cambió el estado', borrar: 'Borró', fecha_objetivo: 'Fecha objetivo' };

function Historial({ url }: { url: string }) {
  const [eventos, setEventos] = useState<EventoAuditoriaDto[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void apiGet<{ eventos: EventoAuditoriaDto[] }>(url, 'No se pudo leer el historial.', ac.signal).then((r) => !ac.signal.aborted && setEventos(r.ok ? r.data.eventos : []));
    return () => ac.abort();
  }, [url]);
  if (eventos === null) return <EsqueletoFilas n={2} />;
  if (eventos.length === 0) return <Text size='xs' c='dimmed'>Sin cambios registrados.</Text>;
  return (
    <Timeline bulletSize={14} lineWidth={2} active={eventos.length - 1}>
      {eventos.map((e) => (
        <Timeline.Item key={e.id} title={<Text size='xs' fw={600}>{`${ACCION[e.action] ?? e.action} · ${e.by?.name ?? 'Sistema'}${e.agent ? ` (propuesta de ${e.agent})` : ''}`}</Text>}>
          <Text size='xs' c='dimmed' className={css.resumen}>
            {e.detail}
          </Text>
          <Text size='xs' c='dimmed'>
            {new Date(e.at).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

export function DetalleTareaModal({
  opened,
  idProject,
  tarea,
  hoy,
  onClose,
  onEditar,
  onBorrar,
}: {
  opened: boolean;
  idProject: number;
  tarea: TareaDto | null;
  hoy: string;
  onClose: () => void;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  if (!tarea) return null;
  const estado = estadoVisualTarea(tarea, hoy);
  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo={tarea.isMilestone ? 'Hito' : 'Tarea'}
      icono={<IconListDetails size={20} />}
      testId='cronograma-detalle-tarea'
      pie={
        <>
          {tarea.puedoBorrar && (
            <Button variant='subtle' color='red' leftSection={<IconTrash size={16} />} onClick={onBorrar}>
              Borrar
            </Button>
          )}
          <Button variant='default' onClick={onClose}>
            Cerrar
          </Button>
          {tarea.puedoEditar && (
            <Button leftSection={<IconPencil size={16} />} onClick={onEditar} data-testid='cronograma-editar-tarea'>
              Editar
            </Button>
          )}
        </>
      }
    >
      <Group gap={6}>
        <Badge color={ESTADO_VISUAL_COLOR[estado]} variant='light'>
          {ESTADO_VISUAL_LABELS[estado]}
        </Badge>
        {tarea.progress !== null && (
          <Badge color='gray' variant='light'>
            {tarea.progress} %
          </Badge>
        )}
        {tarea.origin === 'agente' && (
          <Badge color='grape' variant='light'>
            Propuesta por un asistente
          </Badge>
        )}
      </Group>
      <Text fw={700} size='lg' className={css.resumen}>
        {tarea.title}
      </Text>
      {tarea.description && (
        <Text size='sm' className={css.resumen}>
          {tarea.description}
        </Text>
      )}
      <Stack gap={4}>
        <Text size='sm'>
          <b>{tarea.isMilestone ? 'Fecha' : 'Inicio'}:</b> {fechaLargaIso(tarea.startDate)}
        </Text>
        {!tarea.isMilestone && (
          <Text size='sm'>
            <b>Fin:</b> {fechaLargaIso(tarea.endDate)}
          </Text>
        )}
        <Text size='sm'>
          <b>Responsable:</b> {tarea.responsible?.name ?? 'Sin responsable'}
        </Text>
        <Text size='xs' c='dimmed'>
          Creada por {tarea.createdBy?.name ?? '—'} el {fechaCorta(tarea.createdAt)}
          {tarea.updatedBy ? ` · último cambio de ${tarea.updatedBy.name} el ${fechaCorta(tarea.updatedAt)}` : ''}
        </Text>
      </Stack>
      <Group gap={6}>
        <IconHistory size={16} />
        <Text size='sm' fw={600}>
          Historial
        </Text>
      </Group>
      <Historial url={`/api/proyectos/${idProject}/cronograma/tareas/${tarea.id}`} />
    </Marco>
  );
}

/* ───────────────────────────── Detalle de una solicitud ───────────────────────────── */

export function DetalleSolicitudModal({
  opened,
  idProject,
  solicitud,
  hoy,
  onClose,
  onGuardada,
}: {
  opened: boolean;
  idProject: number;
  solicitud: SolicitudCronogramaDto | null;
  hoy: string;
  onClose: () => void;
  onGuardada: (texto: string) => void;
}) {
  const [objetivo, setObjetivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (opened && solicitud) {
      setObjetivo(solicitud.targetDate ?? '');
      setError(null);
    }
  }, [opened, solicitud]);
  if (!solicitud) return null;
  const f = fechasDeSolicitud(solicitud, hoy);

  const guardar = async (valor: string | null) => {
    setGuardando(true);
    setError(null);
    const r = await apiSend('PATCH', `/api/proyectos/${idProject}/cronograma/solicitudes/${solicitud.idLink}`, { targetDate: valor }, 'No se pudo guardar la fecha objetivo.');
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    onGuardada(valor ? 'Fecha objetivo guardada.' : 'Fecha objetivo quitada.');
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo={`Solicitud #${solicitud.idRequest}`}
      icono={<IconTicket size={20} />}
      testId='cronograma-detalle-solicitud'
      pie={
        <>
          <Button variant='default' onClick={onClose}>
            Cerrar
          </Button>
          <Button component={Link} href={solicitud.url} variant='light' leftSection={<IconExternalLink size={16} />}>
            Abrir la solicitud
          </Button>
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <Group gap={6}>
        <Badge color={ESTADO_VISUAL_COLOR[f.estadoVisual]} variant='light'>
          {ESTADO_VISUAL_LABELS[f.estadoVisual]}
        </Badge>
        {solicitud.estado && (
          <Badge color='gray' variant='light' style={{ textTransform: 'none' }}>
            {solicitud.estado}
          </Badge>
        )}
      </Group>
      <Text fw={700} size='lg' className={css.resumen}>
        {solicitud.subject}
      </Text>
      <Stack gap={4}>
        {solicitud.processName && (
          <Text size='sm'>
            <b>Proceso:</b> {solicitud.processName}
          </Text>
        )}
        <Text size='sm'>
          <b>Radicada:</b> {fechaLargaIso(solicitud.createdAt)}
        </Text>
        <Text size='sm'>
          <b>Cerrada:</b> {solicitud.resolvedAt && !f.abierta ? fechaLargaIso(solicitud.resolvedAt) : 'Sigue abierta'}
        </Text>
        <Text size='xs' c='dimmed'>
          Vinculada por {solicitud.linkedBy?.name ?? '—'}. Abrir el caso sigue sujeto a su permiso en SynerLink.
        </Text>
      </Stack>
      {solicitud.puedoFijarFecha ? (
        <Group align='flex-end' gap='sm' wrap='wrap'>
          <TextInput type='date' label='Fecha objetivo del proyecto' description='El «vencimiento» que se ve en el calendario.' value={objetivo} onChange={(e) => setObjetivo(e.currentTarget.value)} miw={180} data-testid='solicitud-objetivo' />
          <Button onClick={() => void guardar(objetivo || null)} loading={guardando} disabled={(objetivo || null) === solicitud.targetDate}>
            Guardar
          </Button>
          {solicitud.targetDate && (
            <Button variant='subtle' color='gray' onClick={() => void guardar(null)} disabled={guardando}>
              Quitar
            </Button>
          )}
        </Group>
      ) : (
        <Text size='sm'>
          <b>Fecha objetivo:</b> {solicitud.targetDate ? fechaLargaIso(solicitud.targetDate) : '—'}
        </Text>
      )}
      <Text size='sm' fw={600}>
        Actividades del flujo ({solicitud.actividades.length})
      </Text>
      {solicitud.actividades.length === 0 ? (
        <Text size='xs' c='dimmed'>
          Esta solicitud no tiene actividades de flujo.
        </Text>
      ) : (
        <Stack gap={4}>
          {solicitud.actividades.map((a) => {
            const fa = fechasDeActividad(a, f.inicio, hoy);
            return (
              <Group key={a.id} gap='xs' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)', minHeight: 44 }}>
                <Badge size='sm' variant='light' color={ESTADO_VISUAL_COLOR[fa.estadoVisual]} style={{ flexShrink: 0 }}>
                  {a.status ?? ESTADO_VISUAL_LABELS[fa.estadoVisual]}
                </Badge>
                <div className={css.item} style={{ flex: 1 }}>
                  <Text size='sm' className={css.truncar}>
                    {a.task}
                  </Text>
                  <Text size='xs' c='dimmed' className={css.truncar}>
                    {[a.assignedTo, a.resolvedAt ? `cerrada ${fechaLargaIso(a.resolvedAt)}` : a.startDate ? `desde ${fechaLargaIso(a.startDate)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </div>
              </Group>
            );
          })}
        </Stack>
      )}
    </Marco>
  );
}

/* ───────────────────────────── Gestionar con un asistente ───────────────────────────── */

/**
 * La PERSONA le da a un asistente acceso de 24 h a este proyecto (o a todos los suyos) para que
 * lo gestione por kronos-mcp: lee lo que ella ve y solo PROPONE cambios, que ella confirma aquí.
 */
export function GestionarAsistenteModal({ opened, proyecto, onClose, onListo }: { opened: boolean; proyecto: ProyectoDetalleDto; onClose: () => void; onListo: (texto: string) => void }) {
  const [datos, setDatos] = useState<{ concesiones: ConcesionProyectoDto[]; agentes: ConcesionProyectoDto['agent'][] } | null>(null);
  const [idAgent, setIdAgent] = useState<number | null>(null);
  const [alcance, setAlcance] = useState<'proyecto' | 'todos'>('proyecto');
  const [pedido, setPedido] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<{ code: string; nombre: string } | null>(null);

  const cargar = async () => {
    const r = await apiGet<{ concesiones: ConcesionProyectoDto[]; agentes: ConcesionProyectoDto['agent'][] }>(`/api/proyectos/concesiones?idProject=${proyecto.idProject}`, 'No se pudieron cargar los asistentes.');
    if (r.ok) {
      setDatos(r.data);
      setIdAgent((x) => x ?? r.data.agentes[0]?.idAgent ?? null);
    } else {
      setDatos({ concesiones: [], agentes: [] });
      setError(r.error);
    }
  };

  useEffect(() => {
    if (!opened) return;
    setDatos(null);
    setError(null);
    setListo(null);
    setPedido('');
    setAlcance('proyecto');
    void cargar();
  }, [opened, proyecto.idProject]);

  const dar = async () => {
    if (!idAgent) return setError('Escoja el asistente.');
    setEnviando(true);
    setError(null);
    const r = await apiSend('POST', '/api/proyectos/concesiones', { idAgent, idProject: alcance === 'proyecto' ? proyecto.idProject : null, pedido: pedido.trim() || null }, 'No se pudo dar el acceso.');
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    const a = datos?.agentes.find((x) => x.idAgent === idAgent);
    setListo(a ? { code: a.code, nombre: a.displayName } : null);
    onListo(`Acceso dado por 24 horas a ${a?.displayName ?? 'el asistente'}. Siga la conversación en su chat.`);
    void cargar();
  };

  const revocar = async (id: number) => {
    const r = await apiSend('DELETE', `/api/proyectos/concesiones?id=${id}`, undefined, 'No se pudo revocar el acceso.');
    if (!r.ok) return setError(r.error);
    onListo('Acceso revocado. Sus propuestas pendientes ya no se pueden confirmar.');
    void cargar();
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo='Gestionar con un asistente'
      icono={<IconKey size={20} />}
      testId='cronograma-modal-asistente'
      pie={
        <>
          <Button variant='default' onClick={onClose}>
            Cerrar
          </Button>
          {!listo && (
            <Button onClick={() => void dar()} loading={enviando} disabled={!datos || datos.agentes.length === 0}>
              Dar acceso por 24 horas
            </Button>
          )}
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      {listo ? (
        <Alert color='green' radius='md'>
          <Text size='sm'>
            Le dejamos el acceso a <b>{listo.nombre}</b> en su chat. Pídale allí lo que necesite: <b>leerá lo que usted ve y solo le propondrá cambios</b>, que usted confirma aquí, en el Cronograma.
          </Text>
          <Button component={Link} href={`/process/chat?agent=${encodeURIComponent(listo.code)}`} variant='light' color='green' mt='xs'>
            Abrir el chat con {listo.nombre}
          </Button>
        </Alert>
      ) : (
        <Text size='sm' c='dimmed'>
          El asistente podrá <b>leer</b> lo que usted ve (con su mismo rol) y <b>proponerle</b> tareas, avances, solicitudes o conversaciones durante 24 horas. Nada cambia sin su confirmación.
        </Text>
      )}
      {datos === null ? (
        <EsqueletoFilas n={3} />
      ) : (
        <>
          {!listo &&
            (datos.agentes.length === 0 ? (
              <Alert color='yellow' radius='md'>
                No tiene asistentes asignados en {proyecto.company.companyName}.
              </Alert>
            ) : (
              <Stack gap={6}>
                <Text size='sm' fw={500}>
                  Asistente
                </Text>
                {datos.agentes.map((a) => (
                  <UnstyledButton key={a.idAgent} className={css.opcion} data-checked={idAgent === a.idAgent} onClick={() => setIdAgent(a.idAgent)} aria-pressed={idAgent === a.idAgent}>
                    <Group gap='sm' wrap='nowrap'>
                      <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={32} showStatus={false} withTooltip={false} />
                      <Text size='sm' fw={600}>
                        {a.displayName}
                      </Text>
                    </Group>
                  </UnstyledButton>
                ))}
                <Radio.Group value={alcance} onChange={(v) => setAlcance(v as 'proyecto' | 'todos')} label='Alcance'>
                  <Stack gap={4} mt={4}>
                    <Radio value='proyecto' label={`Solo este proyecto («${proyecto.name}»)`} />
                    <Radio value='todos' label='Todos mis proyectos' />
                  </Stack>
                </Radio.Group>
                <Textarea label='¿Qué necesita?' placeholder='Por ejemplo: arme el cronograma de la importación y dígame qué está vencido.' autosize minRows={2} maxRows={5} maxLength={500} value={pedido} onChange={(e) => setPedido(e.currentTarget.value)} />
              </Stack>
            ))}
          {datos.concesiones.length > 0 && (
            <Stack gap={4}>
              <Text size='sm' fw={600}>
                Accesos vigentes
              </Text>
              {datos.concesiones.map((c) => (
                <Group key={c.id} gap='sm' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }}>
                  <AgentAvatar code={c.agent.code} displayName={c.agent.displayName} avatarUrl={c.agent.avatarUrl} avatarVersion={c.agent.avatarVersion} size={28} showStatus={false} withTooltip={false} />
                  <div className={css.item} style={{ flex: 1 }}>
                    <Text size='sm' className={css.truncar}>
                      {c.agent.displayName} · {c.project ? 'este proyecto' : 'todos sus proyectos'}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      <IconCalendarEvent size={11} style={{ display: 'inline-block', verticalAlign: -1 }} /> vence {new Date(c.expiresAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })}
                    </Text>
                  </div>
                  <Button size='xs' variant='subtle' color='red' onClick={() => void revocar(c.id)}>
                    Revocar
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </>
      )}
    </Marco>
  );
}
