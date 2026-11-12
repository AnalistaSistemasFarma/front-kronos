'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Timeline,
  Checkbox,
} from '@mantine/core';
import {
  IconCircleCheck,
  IconClock,
  IconMessages,
  IconMessageCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlayerStop,
  IconPlus,
  IconUserExclamation,
} from '@tabler/icons-react';
import AgentAvatar from '../../chat/AgentAvatar';
import type { ProyectoDetalleDto } from '../../../lib/proyectos/tipos';
import { avisoSinCodigo } from '../../../lib/proyectos/agentes-desarrollo-rules';
import { apiGet, apiSend } from '../api';
import { ConfirmarModal } from '../modales';
import type { Aviso } from '../ui';

/**
 * Sección «Mesas» de un proyecto (2026-11-04; pedido de Nicolás Rivera: «que los
 * agentes puedan discutir de un tema en específico, todo el tiempo… pero que el
 * operador vea lo que está pasando»). Diseño: docs/proyectos-mesas-discusion.md.
 *
 * Lo que ve el operador, en palabras de todos los días:
 *   - en qué va la mesa (activa, en pausa, cerrada) y de quién es el turno;
 *   - qué está haciendo ese agente AHORA (el mismo indicador del chat);
 *   - cuándo es la próxima ronda y cuántos turnos van hoy;
 *   - el registro de lo que pasó, con la frase «En pocas palabras» de cada turno.
 * Se refresca solo cada 10 s mientras la sección está abierta.
 */

interface ParticipanteDto {
  idAgent: number;
  code: string;
  nombre: string;
  rol: string;
}

interface MesaDto {
  idMesa: number;
  idConversation: number;
  tema: string;
  estado: 'activa' | 'pausada' | 'cerrada';
  motivoPausa: 'manual' | 'sin_aporte' | null;
  ronda: number;
  esSintesis: boolean;
  idAgentDeTurno: number | null;
  turnoDesde: string | null;
  proximoTurnoAt: string | null;
  turnosHoy: number;
  reglas: { ritmoMin: number; topeDia: number; sintesisCada: number; horarioDesde: number; horarioHasta: number; soloHabiles: boolean };
  idAgentModerador: number;
  participantes: ParticipanteDto[];
  createdAt: string;
}

interface CandidatoDto {
  idAgent: number;
  code: string;
  nombre: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  designado: boolean;
  conConectores: boolean;
  esDesarrollo: boolean;
}

interface EventoDto {
  id: number;
  tipo: string;
  ronda: number | null;
  idAgent: number | null;
  idMessage: number | null;
  detalle: string | null;
  createdAt: string;
}

interface DetalleDto extends MesaDto {
  estadosAgentes: { idAgent: number; state: string; label: string | null; updatedAt: string }[];
  eventos: EventoDto[];
}

const REFRESCO_MS = 10_000;

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutosDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function EstadoBadge({ mesa }: { mesa: MesaDto }) {
  if (mesa.estado === 'cerrada') return <Badge color='gray'>Cerrada</Badge>;
  if (mesa.estado === 'pausada') {
    return <Badge color='yellow'>{mesa.motivoPausa === 'sin_aporte' ? 'En pausa: sin ideas nuevas' : 'En pausa'}</Badge>;
  }
  return mesa.idAgentDeTurno ? <Badge color='green'>Discutiendo</Badge> : <Badge color='blue'>Esperando la próxima ronda</Badge>;
}

/** Frase de estado para el operador: qué está pasando ahora mismo. */
function queEstaPasando(mesa: MesaDto, detalle: DetalleDto | null): string {
  const nombre = (id: number | null) => mesa.participantes.find((p) => p.idAgent === id)?.nombre ?? 'El moderador';
  if (mesa.estado === 'cerrada') return 'La mesa terminó. La conversación queda para consulta.';
  if (mesa.estado === 'pausada') {
    return mesa.motivoPausa === 'sin_aporte'
      ? 'Los agentes ya no tenían nada nuevo que decir y la mesa se pausó sola. Puede agregar una pregunta en la conversación y reanudarla.'
      : 'Una persona pausó la mesa. Nadie habla hasta que se reanude.';
  }
  if (mesa.idAgentDeTurno) {
    const quien = nombre(mesa.idAgentDeTurno);
    const est = detalle?.estadosAgentes.find((e) => e.idAgent === mesa.idAgentDeTurno);
    const trabajando = est && est.state !== 'idle';
    const hace = minutosDesde(mesa.turnoDesde);
    const accion = mesa.esSintesis ? 'está resumiendo lo que lleva la mesa' : 'tiene la palabra';
    const detalleTrabajo = trabajando ? ` En este momento: ${est!.label?.trim() || 'pensando su respuesta'}.` : ' Todavía no ha empezado a responder.';
    return `${quien} ${accion} (desde hace ${hace ?? 0} min).${detalleTrabajo}`;
  }
  return `Ronda ${mesa.ronda} terminada. La próxima empieza ${hora(mesa.proximoTurnoAt)}.`;
}

const ICONO_EVENTO: Record<string, React.ReactNode> = {
  creada: <IconPlus size={14} />,
  turno: <IconMessages size={14} />,
  respuesta: <IconMessageCircle size={14} />,
  vencido: <IconUserExclamation size={14} />,
  tope: <IconClock size={14} />,
  pausada: <IconPlayerPause size={14} />,
  reanudada: <IconPlayerPlay size={14} />,
  cerrada: <IconPlayerStop size={14} />,
  ronda_ahora: <IconPlayerSkipForward size={14} />,
};

function textoEvento(e: EventoDto, mesa: MesaDto): { titulo: string; texto: string | null } {
  const nombre = mesa.participantes.find((p) => p.idAgent === e.idAgent)?.nombre ?? 'Un agente';
  switch (e.tipo) {
    case 'creada':
      return { titulo: 'Se abrió la mesa', texto: null };
    case 'turno':
      return { titulo: e.detalle ?? `Turno de ${nombre}`, texto: null };
    case 'respuesta':
      return { titulo: `${nombre} dijo:`, texto: e.detalle };
    case 'vencido':
      return { titulo: `${nombre} no respondió a tiempo`, texto: 'La mesa siguió con el turno siguiente.' };
    case 'tope':
      return { titulo: 'Se llegó al máximo de turnos del día', texto: 'La mesa sigue mañana.' };
    default:
      return { titulo: e.detalle ?? e.tipo, texto: null };
  }
}

export default function SeccionMesas({
  proyecto,
  version,
  avisar,
  onAbrirConversacion,
  onCambio,
}: {
  proyecto: ProyectoDetalleDto;
  version: number;
  avisar: (a: Aviso) => void;
  onAbrirConversacion: (id: number) => void | Promise<void>;
  /** Se creó o cerró una mesa: el proyecto recarga su lista de conversaciones. */
  onCambio?: () => void;
}) {
  const base = `/api/proyectos/${proyecto.idProject}/mesas`;
  const puedeManejar = proyecto.capabilities.write && !proyecto.archived;
  const [mesas, setMesas] = useState<MesaDto[] | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<DetalleDto | null>(null);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  const cargar = useCallback(async () => {
    const r = await apiGet<{ mesas: MesaDto[] }>(base, 'No se pudieron cargar las mesas.');
    if (r.ok) {
      setMesas(r.data.mesas);
      setAbierta((a) => a ?? r.data.mesas[0]?.idMesa ?? null);
    } else if (r.error) avisar({ tipo: 'error', texto: r.error });
  }, [base, avisar]);

  const cargarDetalle = useCallback(async () => {
    if (abierta === null) return setDetalle(null);
    const r = await apiGet<{ mesa: DetalleDto }>(`${base}/${abierta}`, 'No se pudo cargar la mesa.');
    if (r.ok) setDetalle(r.data.mesa);
  }, [abierta, base]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  useEffect(() => {
    void cargarDetalle();
    const t = setInterval(() => {
      void cargar();
      void cargarDetalle();
    }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar, cargarDetalle]);

  const accion = async (a: 'pausar' | 'reanudar' | 'cerrar' | 'ronda_ahora') => {
    if (abierta === null) return;
    setOcupado(true);
    const r = await apiSend<{ ok: true }>('POST', `${base}/${abierta}`, { accion: a });
    setOcupado(false);
    if (!r.ok) return avisar({ tipo: 'error', texto: r.error });
    const textos = { pausar: 'Mesa en pausa.', reanudar: 'Mesa reanudada.', cerrar: 'Mesa cerrada.', ronda_ahora: 'Arrancó una ronda nueva.' };
    avisar({ tipo: 'ok', texto: textos[a] });
    await Promise.all([cargar(), cargarDetalle()]);
  };

  const mesa = useMemo(() => mesas?.find((m) => m.idMesa === abierta) ?? null, [mesas, abierta]);

  if (mesas === null) return <Skeleton h={160} radius='md' />;

  return (
    <Stack gap='md' data-testid='seccion-mesas'>
      <Group justify='space-between' align='flex-start'>
        <div>
          <Text fw={600}>Mesas de discusión</Text>
          <Text size='sm' c='dimmed' maw={640}>
            Ustedes plantean un tema y los agentes lo discuten por turnos, cada uno desde su papel. Solo discuten y proponen: no
            envían correos ni cambian nada. Aquí se ve en todo momento qué está pasando.
          </Text>
        </div>
        {puedeManejar && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreando(true)} data-testid='mesa-nueva'>
            Nueva mesa
          </Button>
        )}
      </Group>

      {mesas.length === 0 ? (
        <Alert color='blue' variant='light'>
          Todavía no hay mesas en este proyecto.{puedeManejar ? ' Cree la primera con «Nueva mesa».' : ''}
        </Alert>
      ) : (
        <Group gap='xs'>
          {mesas.map((m) => (
            <Button
              key={m.idMesa}
              size='xs'
              variant={m.idMesa === abierta ? 'filled' : 'light'}
              onClick={() => setAbierta(m.idMesa)}
              maw={320}
            >
              <Text size='xs' truncate>
                {m.tema}
              </Text>
            </Button>
          ))}
        </Group>
      )}

      {mesa && (
        <Card withBorder radius='md' p='md'>
          <Stack gap='sm'>
            <Group justify='space-between' align='flex-start' wrap='nowrap'>
              <div style={{ minWidth: 0 }}>
                <Text fw={600}>{mesa.tema}</Text>
                <Text size='xs' c='dimmed'>
                  Ronda {mesa.ronda} · {mesa.turnosHoy} de {mesa.reglas.topeDia} turnos hoy · una ronda cada {mesa.reglas.ritmoMin} min, de{' '}
                  {hhmm(mesa.reglas.horarioDesde)} a {hhmm(mesa.reglas.horarioHasta)}
                  {mesa.reglas.soloHabiles ? ' en días hábiles' : ''}
                </Text>
              </div>
              <EstadoBadge mesa={mesa} />
            </Group>

            <Alert color={mesa.estado === 'activa' ? 'green' : mesa.estado === 'pausada' ? 'yellow' : 'gray'} variant='light' title='Qué está pasando'>
              <Text size='sm' data-testid='mesa-que-pasa'>
                {queEstaPasando(mesa, detalle)}
              </Text>
            </Alert>

            <Group gap='md'>
              {mesa.participantes.map((p) => {
                const deTurno = p.idAgent === mesa.idAgentDeTurno;
                const ag = proyecto.agents.find((a) => a.idAgent === p.idAgent);
                return (
                  <Group key={p.idAgent} gap={6} style={{ opacity: mesa.idAgentDeTurno && !deTurno ? 0.6 : 1 }}>
                    <AgentAvatar
                      code={p.code}
                      displayName={p.nombre}
                      avatarUrl={ag?.avatarUrl ?? null}
                      avatarVersion={ag?.avatarVersion ?? null}
                      size={28}
                      showStatus={false}
                    />
                    <div>
                      <Text size='sm' fw={deTurno ? 700 : 500}>
                        {p.nombre}
                        {p.idAgent === mesa.idAgentModerador ? ' · modera' : ''}
                      </Text>
                      <Text size='xs' c='dimmed'>
                        {p.rol}
                      </Text>
                    </div>
                    {deTurno && <Loader size='xs' type='dots' />}
                  </Group>
                );
              })}
            </Group>

            <Group gap='xs'>
              <Button size='xs' variant='light' leftSection={<IconMessages size={14} />} onClick={() => onAbrirConversacion(mesa.idConversation)}>
                Ver la conversación completa
              </Button>
              {puedeManejar && mesa.estado === 'activa' && (
                <>
                  <Button size='xs' variant='light' color='yellow' loading={ocupado} leftSection={<IconPlayerPause size={14} />} onClick={() => accion('pausar')}>
                    Pausar
                  </Button>
                  {!mesa.idAgentDeTurno && (
                    <Button size='xs' variant='light' loading={ocupado} leftSection={<IconPlayerSkipForward size={14} />} onClick={() => accion('ronda_ahora')}>
                      Ronda ahora
                    </Button>
                  )}
                </>
              )}
              {puedeManejar && mesa.estado === 'pausada' && (
                <Button size='xs' variant='light' color='green' loading={ocupado} leftSection={<IconPlayerPlay size={14} />} onClick={() => accion('reanudar')}>
                  Reanudar
                </Button>
              )}
              {puedeManejar && mesa.estado !== 'cerrada' && (
                <Button size='xs' variant='subtle' color='red' loading={ocupado} leftSection={<IconPlayerStop size={14} />} onClick={() => setConfirmarCierre(true)}>
                  Cerrar mesa
                </Button>
              )}
            </Group>

            <Text fw={600} size='sm' mt='xs'>
              Lo que ha pasado
            </Text>
            {!detalle ? (
              <Skeleton h={80} />
            ) : detalle.eventos.length === 0 ? (
              <Text size='sm' c='dimmed'>
                Aún no hay movimientos.
              </Text>
            ) : (
              <Timeline bulletSize={22} lineWidth={2} data-testid='mesa-registro'>
                {detalle.eventos.slice(0, 40).map((e) => {
                  const t = textoEvento(e, mesa);
                  return (
                    <Timeline.Item
                      key={e.id}
                      bullet={<ThemeIcon size={22} radius='xl' variant='light'>{ICONO_EVENTO[e.tipo] ?? <IconCircleCheck size={14} />}</ThemeIcon>}
                      title={<Text size='sm' fw={500}>{t.titulo}</Text>}
                    >
                      {t.texto && <Text size='sm'>{t.texto}</Text>}
                      <Text size='xs' c='dimmed'>
                        {hora(e.createdAt)}
                        {e.ronda ? ` · ronda ${e.ronda}` : ''}
                      </Text>
                    </Timeline.Item>
                  );
                })}
              </Timeline>
            )}
          </Stack>
        </Card>
      )}

      {creando && (
        <NuevaMesaModal
          proyecto={proyecto}
          onClose={() => setCreando(false)}
          onCreada={async (idMesa) => {
            setCreando(false);
            avisar({ tipo: 'ok', texto: 'Mesa creada. Si está en horario, la primera ronda arranca ya.' });
            onCambio?.();
            setAbierta(idMesa);
            await cargar();
          }}
          avisar={avisar}
          base={base}
        />
      )}

      <ConfirmarModal
        opened={confirmarCierre}
        titulo='Cerrar la mesa'
        texto='Los agentes dejan de discutir este tema. La conversación queda para consulta y no se puede reabrir.'
        accion='Cerrar mesa'
        color='red'
        cargando={ocupado}
        onClose={() => setConfirmarCierre(false)}
        onConfirmar={async () => {
          setConfirmarCierre(false);
          await accion('cerrar');
        }}
      />
    </Stack>
  );
}

function NuevaMesaModal({
  proyecto,
  onClose,
  onCreada,
  avisar,
  base,
}: {
  proyecto: ProyectoDetalleDto;
  onClose: () => void;
  onCreada: (idMesa: number) => void;
  avisar: (a: Aviso) => void;
  base: string;
}) {
  // Todos los agentes que la persona puede poner en una mesa (2026-11-05: «que pueda
  // elegir todos los agentes que quiera»): los del proyecto y los demás que tiene
  // asignados en la empresa. Los que no están en el proyecto se suman al crear la mesa.
  const [disponibles, setDisponibles] = useState<CandidatoDto[] | null>(null);
  // El proyecto tiene acceso a código: los agentes de negocio participan sin él (aviso, no bloqueo).
  const [conCodigo, setConCodigo] = useState(false);
  useEffect(() => {
    void apiGet<{ candidatos: CandidatoDto[]; conCodigo?: boolean }>(`${base}?candidatos=1`, 'No se pudieron cargar los agentes.').then((r) => {
      if (r.ok) {
        setDisponibles(r.data.candidatos);
        setConCodigo(r.data.conCodigo === true);
      } else {
        setDisponibles([]);
        if (r.error) setError(r.error);
      }
    });
  }, [base]);
  const esDueno = proyecto.capabilities.manageAgents;
  const [tema, setTema] = useState('');
  const [elegidos, setElegidos] = useState<Record<number, string>>({});
  const [moderador, setModerador] = useState<string | null>(null);
  const [ritmo, setRitmo] = useState<number | string>(30);
  const [tope, setTope] = useState<number | string>(40);
  const [sintesis, setSintesis] = useState<number | string>(3);
  const [todoElDia, setTodoElDia] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const ids = Object.keys(elegidos).map(Number);
  const opcionesModerador = (disponibles ?? [])
    .filter((a) => ids.includes(a.idAgent))
    .map((a) => ({ value: String(a.idAgent), label: a.nombre }));
  const seleccionables = (disponibles ?? []).filter((a) => a.designado || esDueno);
  const todosMarcados = seleccionables.length > 0 && seleccionables.every((a) => a.idAgent in elegidos);
  const avisoNegocio = conCodigo ? avisoSinCodigo((disponibles ?? []).filter((a) => ids.includes(a.idAgent) && !a.esDesarrollo).map((a) => a.nombre)) : '';

  const crear = async () => {
    setError(null);
    setGuardando(true);
    const r = await apiSend<{ idMesa: number }>('POST', base, {
      tema,
      participantes: ids.map((idAgent) => ({ idAgent, rol: elegidos[idAgent] })),
      idAgentModerador: moderador ? Number(moderador) : null,
      reglas: {
        ritmoMin: Number(ritmo),
        topeDia: Number(tope),
        sintesisCada: Number(sintesis),
        ...(todoElDia ? { horarioDesde: 0, horarioHasta: 1440, soloHabiles: false } : {}),
      },
    });
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    onCreada(r.data.idMesa);
  };

  return (
    <Modal opened onClose={onClose} title='Nueva mesa de discusión' size='lg'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' variant='light'>
            {error}
          </Alert>
        )}
        <Textarea
          label='Tema o pregunta'
          description='Lo que quieren que los agentes discutan. Sea concreto.'
          placeholder='¿Cómo reducimos las demoras de Tesorería en OLP?'
          autosize
          minRows={2}
          maxLength={2000}
          value={tema}
          onChange={(e) => setTema(e.currentTarget.value)}
          data-testid='mesa-tema'
        />
        <div>
          <Text size='sm' fw={500}>
            Agentes que participan (mínimo 2) y su papel
          </Text>
          <Text size='xs' c='dimmed' mb={6}>
            El papel orienta su aporte: por ejemplo «propone soluciones», «critica las propuestas», «revisa los datos».
          </Text>
          {disponibles === null ? (
            <Skeleton h={80} />
          ) : seleccionables.length < 2 ? (
            <Alert color='yellow' variant='light'>
              Necesita al menos dos agentes asignados a usted en la empresa del proyecto, con Proyectos habilitado.
            </Alert>
          ) : (
            <Checkbox
              mb={6}
              label={`Seleccionar todos (${seleccionables.length})`}
              checked={todosMarcados}
              indeterminate={!todosMarcados && ids.length > 0}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setElegidos((prev) => {
                  if (!v) return {};
                  const n = { ...prev };
                  for (const a of seleccionables) if (!(a.idAgent in n)) n[a.idAgent] = '';
                  return n;
                });
                if (!v) setModerador(null);
              }}
            />
          )}
          <Stack gap={6}>
            {seleccionables.map((a) => {
              const marcado = a.idAgent in elegidos;
              const notas = [!a.designado ? 'se suma al proyecto' : null, !a.conConectores ? 'conversa sin conectores' : null].filter(Boolean);
              return (
                <Group key={a.idAgent} wrap='nowrap' align='flex-start'>
                  <Checkbox
                    checked={marcado}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setElegidos((prev) => {
                        const n = { ...prev };
                        if (v) n[a.idAgent] = '';
                        else delete n[a.idAgent];
                        return n;
                      });
                      if (!v && moderador === String(a.idAgent)) setModerador(null);
                    }}
                    label={a.nombre}
                    description={notas.length > 0 ? notas.join(' · ') : undefined}
                    w={190}
                  />
                  <TextInput
                    size='xs'
                    style={{ flex: 1 }}
                    disabled={!marcado}
                    placeholder='Su papel en la mesa'
                    maxLength={80}
                    value={elegidos[a.idAgent] ?? ''}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setElegidos((prev) => ({ ...prev, [a.idAgent]: v }));
                    }}
                  />
                </Group>
              );
            })}
          </Stack>
        </div>
        {avisoNegocio && (
          <Alert color='blue' variant='light' data-testid='mesa-negocio-sin-codigo'>
            {avisoNegocio}
          </Alert>
        )}
        <Select
          label='Moderador'
          description='Hace un resumen cada cierto número de rondas.'
          data={opcionesModerador}
          value={moderador}
          onChange={setModerador}
          placeholder='Elija entre los participantes'
          comboboxProps={{ withinPortal: true }}
        />
        <Group grow>
          <NumberInput label='Minutos entre rondas' min={10} max={240} value={ritmo} onChange={setRitmo} />
          <NumberInput label='Máximo de turnos al día' min={1} max={200} value={tope} onChange={setTope} />
          <NumberInput label='Resumen cada (rondas)' min={1} max={10} value={sintesis} onChange={setSintesis} />
        </Group>
        <Switch
          checked={todoElDia}
          onChange={(e) => setTodoElDia(e.currentTarget.checked)}
          label='Todo el día, todos los días'
          description='Si está apagado, la mesa solo habla de 7:00 a. m. a 7:00 p. m. en días hábiles.'
        />
        <Group justify='flex-end' mt='sm'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={crear} loading={guardando} disabled={!tema.trim() || ids.length < 2 || !moderador} data-testid='mesa-crear'>
            Crear mesa
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
