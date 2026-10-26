'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Alert, Badge, Button, Card, Group, SegmentedControl, Skeleton, Stack, Switch, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCalendarMonth, IconCheck, IconKey, IconPlus, IconTicket, IconTimeline, IconX } from '@tabler/icons-react';
import AgentAvatar from '../../chat/AgentAvatar';
import { ESTADO_VISUAL_COLOR, ESTADO_VISUAL_LABELS, ZOOM_LABELS, ZOOMS, type EstadoVisual, type EventoCalendario, type ZoomGantt } from '../../../lib/proyectos/cronograma-rules';
import type { CronogramaDto, PropuestaDto, ProyectoDetalleDto } from '../../../lib/proyectos/tipos';
import { apiGet, apiSend, fechaCorta } from '../api';
import { ConfirmarModal } from '../modales';
import { CONSULTA_ESCRITORIO, type Aviso } from '../ui';
import CalendarioProyecto from './CalendarioProyecto';
import Gantt from './Gantt';
import { DetalleSolicitudModal, DetalleTareaModal, GestionarAsistenteModal, TareaModal } from './modales-cronograma';
import { coloresDe, eventosDeCronograma, gruposGantt, type ItemGantt } from './modelo';
import css from './cronograma.module.css';
import cssP from '../proyectos.module.css';

/**
 * Sección «Cronograma» de un proyecto (2026-10-18): vista de línea de tiempo (Gantt) o de
 * calendario, con las tareas del proyecto y las solicitudes vinculadas (con sus actividades).
 * Arriba, las PROPUESTAS pendientes de los asistentes, que se confirman con un clic.
 *
 * La reja de permisos está en el servidor; `capabilities` y `puedo*` solo dicen qué botones
 * pintar. Los avisos van ARRIBA y con color (lineamiento de SynerLink); refrescar no desmonta
 * los modales (memoria «feedback-ux-feedback-visible»).
 */
const LEYENDA: EstadoVisual[] = ['pendiente', 'en_curso', 'hecha', 'bloqueada', 'vencida', 'abierta', 'cancelada'];

export default function SeccionCronograma({
  proyecto,
  version,
  avisar,
  onVincularSolicitud,
}: {
  proyecto: ProyectoDetalleDto;
  /** Cambia cuando el proyecto se recarga (p. ej. tras vincular una solicitud). */
  version: number;
  avisar: (a: Aviso) => void;
  onVincularSolicitud: () => void;
}) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [datos, setDatos] = useState<CronogramaDto | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [vista, setVista] = useState<'gantt' | 'calendario'>('gantt');
  const [zoom, setZoom] = useState<ZoomGantt>('mes');
  const [porResponsable, setPorResponsable] = useState(false);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<'tarea' | 'detalleTarea' | 'detalleSolicitud' | 'asistente' | 'borrar' | null>(null);
  const [idTarea, setIdTarea] = useState<number | null>(null);
  const [idSolicitud, setIdSolicitud] = useState<number | null>(null);
  const [editando, setEditando] = useState(false);
  const [decidiendo, setDecidiendo] = useState<number | null>(null);
  // En el celular las propuestas arrancan plegadas (un aviso de una línea) para no tapar el cronograma.
  const [verPropuestas, setVerPropuestas] = useState<boolean | null>(null);
  const propuestasAbiertas = verPropuestas ?? escritorio;

  const cargar = useCallback(async () => {
    const r = await apiGet<{ cronograma: CronogramaDto }>(`/api/proyectos/${proyecto.idProject}/cronograma`, 'No se pudo cargar el cronograma.');
    if (r.ok) {
      setDatos(r.data.cronograma);
      setErrorCarga(null);
    } else if (r.error) setErrorCarga(r.error);
  }, [proyecto.idProject]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  const grupos = useMemo(() => (datos ? gruposGantt(datos, porResponsable) : []), [datos, porResponsable]);
  const eventos = useMemo(() => (datos ? eventosDeCronograma(datos) : []), [datos]);
  const tarea = datos?.tasks.find((t) => t.id === idTarea) ?? null;
  const solicitud = datos?.requests.find((s) => s.idRequest === idSolicitud) ?? null;

  const abrirItem = (i: ItemGantt) => {
    if (i.kind === 'tarea') {
      setIdTarea(i.id);
      setModal('detalleTarea');
    } else {
      const idReq = i.kind === 'solicitud' ? i.id : datos?.requests.find((s) => s.actividades.some((a) => a.id === i.id))?.idRequest;
      if (idReq) {
        setIdSolicitud(idReq);
        setModal('detalleSolicitud');
      }
    }
  };
  const abrirEvento = (e: EventoCalendario) => {
    if (e.ref.kind === 'tarea') {
      setIdTarea(e.ref.id);
      setModal('detalleTarea');
    } else {
      setIdSolicitud(e.ref.id);
      setModal('detalleSolicitud');
    }
  };

  // Tras guardar: el aviso va arriba y los datos se refrescan SIN desmontar la sección.
  const listo = (texto: string, cerrar = true) => {
    avisar({ tipo: 'ok', texto });
    if (cerrar) setModal(null);
    void cargar();
  };

  const decidir = async (p: PropuestaDto, accion: 'confirmar' | 'rechazar') => {
    setDecidiendo(p.id);
    const r = await apiSend<{ resultado?: string }>('POST', `/api/proyectos/${proyecto.idProject}/propuestas/${p.id}`, { accion }, 'No se pudo decidir la propuesta.');
    setDecidiendo(null);
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error });
      void cargar();
      return;
    }
    avisar({ tipo: accion === 'confirmar' ? 'ok' : 'advertencia', texto: accion === 'confirmar' ? `Propuesta confirmada. ${r.data.resultado ?? ''}`.trim() : 'Propuesta rechazada: no se cambió nada.' });
    void cargar();
  };

  const borrar = async () => {
    if (!tarea) return false;
    const r = await apiSend('DELETE', `/api/proyectos/${proyecto.idProject}/cronograma/tareas/${tarea.id}`, undefined, 'No se pudo borrar la tarea.');
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error });
      return false;
    }
    listo('Tarea borrada. El historial queda en la auditoría del proyecto.');
    return true;
  };

  if (!datos) {
    return errorCarga ? (
      <Alert color='red' radius='md' icon={<IconAlertTriangle size={18} />}>
        {errorCarga}{' '}
        <Button size='compact-sm' variant='subtle' onClick={() => void cargar()}>
          Reintentar
        </Button>
      </Alert>
    ) : (
      <Stack gap='sm' aria-hidden='true' data-testid='cronograma-esqueleto'>
        <Group gap='sm'>
          <Skeleton height={36} width={220} radius='md' />
          <Skeleton height={36} width={160} radius='md' />
        </Group>
        <Skeleton height={48} radius='md' />
        {Array.from({ length: 6 }, (_, i) => (
          <Group key={i} gap='sm' wrap='nowrap'>
            <Skeleton height={28} width={escritorio ? 220 : 120} radius='sm' />
            <Skeleton height={18} width={`${30 + ((i * 17) % 50)}%`} radius='xl' ml={(i * 23) % 80} />
          </Group>
        ))}
      </Stack>
    );
  }

  const vacio = datos.tasks.length === 0 && datos.requests.length === 0;

  return (
    <Stack gap='sm' data-testid='cronograma'>
      {datos.avisos.map((a) => (
        <Alert key={a} color='yellow' radius='md' icon={<IconAlertTriangle size={18} />} py={8}>
          {a}
        </Alert>
      ))}

      {datos.proposals.length > 0 && (
        <Card withBorder radius='md' p='sm' data-testid='cronograma-propuestas' style={{ borderColor: 'var(--mantine-color-grape-light-color)' }}>
          <Group gap={6} mb={propuestasAbiertas ? 6 : 0} justify='space-between' wrap='nowrap'>
            <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
              <Badge color='grape' variant='light' style={{ flexShrink: 0 }}>
                {datos.proposals.length === 1 ? '1 propuesta' : `${datos.proposals.length} propuestas`}
              </Badge>
              <Text size='sm' fw={600} className={cssP.truncar}>
                {escritorio ? 'de los asistentes, esperando su decisión' : 'esperando su decisión'}
              </Text>
            </Group>
            {!escritorio && (
              <Button size='xs' variant='subtle' color='grape' onClick={() => setVerPropuestas(!propuestasAbiertas)} aria-expanded={propuestasAbiertas} data-testid='cronograma-ver-propuestas'>
                {propuestasAbiertas ? 'Ocultar' : 'Ver'}
              </Button>
            )}
          </Group>
          {propuestasAbiertas && (
          <Stack gap={6}>
            {datos.proposals.map((p) => (
              <Group key={p.id} gap='sm' wrap='wrap' className={cssP.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }} data-testid='cronograma-propuesta'>
                {p.agent && <AgentAvatar code={p.agent.code} displayName={p.agent.displayName} avatarUrl={p.agent.avatarUrl} avatarVersion={p.agent.avatarVersion} size={32} showStatus={false} withTooltip={false} />}
                <div className={cssP.item} style={{ flex: '1 1 220px' }}>
                  <Group gap={6} wrap='nowrap'>
                    <Badge size='xs' variant='light' color='grape' style={{ flexShrink: 0 }}>
                      {p.kindLabel}
                    </Badge>
                    <Text size='xs' c='dimmed' className={cssP.truncar}>
                      {p.agent?.displayName ?? 'Asistente'}
                      {p.requestedFor ? ` · a nombre de ${p.requestedFor.name}` : ' · desde una conversación del proyecto'} · {fechaCorta(p.createdAt)}
                    </Text>
                  </Group>
                  <Text size='sm' className={cssP.resumen}>
                    {p.summary}
                  </Text>
                </div>
                <Group gap={6} wrap='nowrap' ml='auto'>
                  <Tooltip label={p.motivo ?? ''} disabled={p.puedoConfirmar} withArrow multiline maw={260}>
                    <div>
                      <Button size='xs' variant='subtle' color='gray' leftSection={<IconX size={14} />} disabled={!p.puedoConfirmar} loading={decidiendo === p.id} onClick={() => void decidir(p, 'rechazar')}>
                        Rechazar
                      </Button>
                    </div>
                  </Tooltip>
                  <Tooltip label={p.motivo ?? ''} disabled={p.puedoConfirmar} withArrow multiline maw={260}>
                    <div>
                      <Button size='xs' color='green' leftSection={<IconCheck size={14} />} disabled={!p.puedoConfirmar} loading={decidiendo === p.id} onClick={() => void decidir(p, 'confirmar')} data-testid='cronograma-confirmar'>
                        Confirmar
                      </Button>
                    </div>
                  </Tooltip>
                </Group>
              </Group>
            ))}
          </Stack>
          )}
        </Card>
      )}

      <div className={css.barra}>
        <SegmentedControl
          value={vista}
          onChange={(v) => setVista(v as 'gantt' | 'calendario')}
          data={[
            { value: 'gantt', label: <Group gap={6} wrap='nowrap'><IconTimeline size={16} /><span>Cronograma</span></Group> },
            { value: 'calendario', label: <Group gap={6} wrap='nowrap'><IconCalendarMonth size={16} /><span>Calendario</span></Group> },
          ]}
          data-testid='cronograma-vista'
        />
        {vista === 'gantt' && (
          <SegmentedControl value={zoom} onChange={(v) => setZoom(v as ZoomGantt)} data={ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))} data-testid='cronograma-zoom' />
        )}
        <Group gap={6} ml={escritorio ? 'auto' : undefined} wrap='wrap'>
          {datos.capabilities.vincular && (
            <Button variant='default' leftSection={<IconTicket size={16} />} onClick={onVincularSolicitud}>
              Vincular solicitud
            </Button>
          )}
          {!proyecto.archived && (
            <Button variant='default' leftSection={<IconKey size={16} />} onClick={() => setModal('asistente')} data-testid='cronograma-asistente'>
              {escritorio ? 'Gestionar con un asistente' : 'Asistente'}
            </Button>
          )}
          {datos.capabilities.crear && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setEditando(false);
                setModal('tarea');
              }}
              data-testid='cronograma-nueva-tarea'
            >
              Nueva tarea
            </Button>
          )}
        </Group>
      </div>

      {vista === 'gantt' && !vacio && (
        <Group justify='space-between' gap='xs' wrap='wrap'>
          <div className={css.leyenda} aria-label='Colores por estado'>
            {LEYENDA.map((e) => (
              <Group key={e} gap={4} wrap='nowrap'>
                <span className={css.punto} style={{ ...(coloresDe(e, ESTADO_VISUAL_COLOR[e]) as CSSProperties), background: `var(--mantine-color-${ESTADO_VISUAL_COLOR[e]}-filled)` }} />
                <Text size='xs' c='dimmed'>
                  {ESTADO_VISUAL_LABELS[e]}
                </Text>
              </Group>
            ))}
          </div>
          {datos.tasks.length > 0 && <Switch size='sm' label='Agrupar por responsable' checked={porResponsable} onChange={(e) => setPorResponsable(e.currentTarget.checked)} data-testid='cronograma-agrupar' />}
        </Group>
      )}

      {vacio ? (
        <Stack align='center' gap={6} py='xl' px='sm' data-testid='cronograma-vacio'>
          <ThemeIcon size={44} radius='xl' variant='light'>
            <IconTimeline size={24} />
          </ThemeIcon>
          <Text fw={600}>El cronograma está vacío</Text>
          <Text size='sm' c='dimmed' ta='center' maw={420}>
            {datos.capabilities.crear
              ? 'Cree la primera tarea o vincule una solicitud: aparecerán aquí con sus fechas, y también en el calendario.'
              : 'Cuando el dueño o un editor agreguen tareas o vinculen solicitudes, aparecerán aquí.'}
          </Text>
        </Stack>
      ) : vista === 'gantt' ? (
        <Gantt
          grupos={grupos}
          hoy={datos.hoy}
          zoom={zoom}
          expandidas={expandidas}
          onAlternar={(k) => {
            const n = new Set(expandidas);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            setExpandidas(n);
          }}
          onAbrir={abrirItem}
        />
      ) : (
        <CalendarioProyecto eventos={eventos} hoy={datos.hoy} onAbrir={abrirEvento} />
      )}

      <TareaModal opened={modal === 'tarea'} idProject={proyecto.idProject} cronograma={datos} tarea={editando ? tarea : null} onClose={() => setModal(null)} onGuardada={(t) => listo(t)} />
      <DetalleTareaModal
        opened={modal === 'detalleTarea'}
        idProject={proyecto.idProject}
        tarea={tarea}
        hoy={datos.hoy}
        onClose={() => setModal(null)}
        onEditar={() => {
          setEditando(true);
          setModal('tarea');
        }}
        onBorrar={() => setModal('borrar')}
      />
      <DetalleSolicitudModal opened={modal === 'detalleSolicitud'} idProject={proyecto.idProject} solicitud={solicitud} hoy={datos.hoy} onClose={() => setModal(null)} onGuardada={(t) => listo(t, false)} />
      <GestionarAsistenteModal opened={modal === 'asistente'} proyecto={proyecto} onClose={() => setModal(null)} onListo={(t) => avisar({ tipo: 'ok', texto: t })} />
      <ConfirmarModal
        opened={modal === 'borrar'}
        titulo='Borrar la tarea'
        texto={`«${tarea?.title ?? ''}» sale del cronograma. El historial de cambios se conserva.`}
        accion='Borrar'
        color='red'
        cargando={false}
        onClose={() => setModal('detalleTarea')}
        onConfirmar={() => void borrar()}
      />
    </Stack>
  );
}
