'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Menu,
  SegmentedControl,
  Skeleton,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconFileText,
  IconHierarchy2,
  IconPencil,
  IconPlayerStop,
  IconPlugConnected,
  IconRestore,
  IconSparkles,
  IconUsersGroup,
  IconWorld,
  IconWriting,
  IconX,
} from '@tabler/icons-react';
import AgentAvatar from '../../chat/AgentAvatar';
import { HERRAMIENTA_INFO, MODELO_INFO } from '../../../lib/proyectos/equipo-rules';
import type { CorridaSubagenteDto, EquipoDto, HerramientaEquipoDto, ProyectoDetalleDto, SubagenteDto } from '../../../lib/proyectos/tipos';
import { apiGet, apiSend, fechaCorta } from '../api';
import { ConfirmarModal } from '../modales';
import { CONSULTA_ESCRITORIO, type Aviso } from '../ui';
import SubagenteModal from './SubagenteModal';
import css from './equipo.module.css';
import cssP from '../proyectos.module.css';

/**
 * Sección «Equipo» de un proyecto (F2, 2026-10-18; pedido de Nicolás Rivera: «sugerir
 * subagentes especializados para hacer las actividades que ellos requieran»).
 *
 *   - «Sugerir equipo»: el asistente propone de 3 a 6 subagentes (quedan PROPUESTOS).
 *   - El dueño aprueba, edita o descarta cada uno; solo los APROBADOS trabajan, y solo
 *     cuando el asistente decide delegar en una conversación del proyecto.
 *   - Topes a la vista: cuántos a la vez, que no se anidan y el perfil de conectores.
 *   - Actividad reciente y consumo por subagente (lo reporta el puente).
 *
 * La reja de permisos está en el servidor; `capacidades` solo dice qué botones pintar. Los
 * avisos van ARRIBA y con color (lineamiento de SynerLink); refrescar no desmonta los modales.
 */

const ICONO_HERRAMIENTA: Record<HerramientaEquipoDto, React.ReactNode> = {
  archivos: <IconFileText size={13} />,
  trabajo: <IconWriting size={13} />,
  web: <IconWorld size={13} />,
  conectores: <IconPlugConnected size={13} />,
};
const COLORES = ['blue', 'grape', 'teal', 'orange', 'indigo', 'cyan', 'pink', 'lime'];

function colorDe(slug: string): string {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES[h % COLORES.length];
}
function iniciales(nombre: string): string {
  const partes = nombre.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter((p) => p.length > 2 || /^\p{Lu}/u.test(p));
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || 'SA';
}
const numero = (n: number) => n.toLocaleString('es-CO');
function duracion(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60} s`;
}

function Herramientas({ tools }: { tools: HerramientaEquipoDto[] }) {
  return (
    <Group gap={4} wrap='wrap'>
      {tools.map((t) => (
        <Tooltip key={t} label={HERRAMIENTA_INFO[t].description} withArrow multiline maw={260} openDelay={300}>
          <Badge size='sm' variant='light' color='gray' leftSection={ICONO_HERRAMIENTA[t]} style={{ textTransform: 'none' }}>
            {HERRAMIENTA_INFO[t].label}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

function TarjetaSubagente({
  s,
  acciones,
}: {
  s: SubagenteDto;
  acciones: React.ReactNode;
}) {
  const [verInstrucciones, setVerInstrucciones] = useState(false);
  return (
    <div className={css.tarjeta} data-testid={`equipo-subagente-${s.slug}`}>
      <div className={css.tarjetaCuerpo}>
        <Avatar color={colorDe(s.slug)} radius='xl' size={38} variant='light' style={{ flexShrink: 0 }} aria-hidden>
          {iniciales(s.name)}
        </Avatar>
        <div className={css.tarjetaTexto}>
          <Group gap={6} wrap='wrap'>
            <Text fw={600} size='sm' className={css.nombre}>
              {s.name}
            </Text>
            <Badge size='xs' variant='outline' color='gray' style={{ textTransform: 'none' }}>
              {s.model ? MODELO_INFO[s.model].split(' (')[0] : 'Modelo del asistente'}
            </Badge>
          </Group>
          <Text size='sm' c='dimmed' className={cssP.resumen}>
            {s.purpose}
          </Text>
          <Herramientas tools={s.tools} />
          {s.instructions && (
            <>
              <UnstyledButton className={css.verMas} onClick={() => setVerInstrucciones((v) => !v)} aria-expanded={verInstrucciones}>
                <Text size='xs' c='blue' fw={500}>
                  {verInstrucciones ? 'Ocultar instrucciones' : 'Ver instrucciones'}
                </Text>
                <IconChevronDown size={14} style={{ transform: verInstrucciones ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} color='var(--mantine-color-blue-filled)' />
              </UnstyledButton>
              <Collapse in={verInstrucciones}>
                <Text size='sm' className={`${cssP.resumen} ${css.instrucciones}`}>
                  {s.instructions}
                </Text>
              </Collapse>
            </>
          )}
          <Text size='xs' c='dimmed'>
            {s.origin === 'agente' ? `Sugerido por ${s.suggestedBy ?? 'el asistente'}` : 'Creado por una persona'}
            {s.reviewedBy && s.status !== 'propuesto' ? ` · ${s.status === 'aprobado' ? 'aprobado' : 'descartado'} por ${s.reviewedBy.name} ${fechaCorta(s.reviewedAt)}` : ''}
            {s.uso30d.corridas > 0 ? ` · ${s.uso30d.corridas === 1 ? '1 tarea' : `${s.uso30d.corridas} tareas`} y ${numero(s.uso30d.tokens)} fichas en 30 días` : ''}
          </Text>
        </div>
      </div>
      {acciones && <div className={css.acciones}>{acciones}</div>}
    </div>
  );
}

function FilaCorrida({ c }: { c: CorridaSubagenteDto }) {
  const icono =
    c.status === 'ok' ? (
      <IconCircleCheck size={18} color='var(--mantine-color-green-filled)' aria-label='Terminó bien' />
    ) : c.status === 'error' ? (
      <IconCircleX size={18} color='var(--mantine-color-red-filled)' aria-label='Terminó con error' />
    ) : (
      <IconPlayerStop size={18} color='var(--mantine-color-yellow-filled)' aria-label='Se detuvo' />
    );
  return (
    <div className={css.corrida} data-testid='equipo-corrida'>
      <div className={css.corridaIcono}>{icono}</div>
      <div className={css.tarjetaTexto}>
        <Text size='sm' className={css.corridaTitulo}>
          <b>{c.name}</b> · {c.description}
        </Text>
        <Text size='xs' c='dimmed' className={cssP.truncar}>
          {c.conversation?.title ? `«${c.conversation.title}» · ` : ''}
          {fechaCorta(c.startedAt)}
        </Text>
      </div>
      <div className={css.corridaCifras}>
        <Text size='xs' c='dimmed' className={css.cifra}>
          <IconClock size={12} /> {duracion(c.durationMs)}
        </Text>
        <Text size='xs' fw={600} className={css.cifra}>
          {numero(c.totalTokens)} fichas
        </Text>
      </div>
    </div>
  );
}

export default function SeccionEquipo({ proyecto, version, avisar }: { proyecto: ProyectoDetalleDto; version: number; avisar: (a: Aviso) => void }) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [datos, setDatos] = useState<EquipoDto | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | 'sugerir' | 'config' | null>(null);
  const [editando, setEditando] = useState<SubagenteDto | null>(null);
  const [retirando, setRetirando] = useState<SubagenteDto | null>(null);
  const [verDescartados, setVerDescartados] = useState(false);
  const base = `/api/proyectos/${proyecto.idProject}/equipo`;

  const cargar = useCallback(async () => {
    const r = await apiGet<{ team: EquipoDto }>(base, 'No se pudo cargar el equipo.');
    if (r.ok) {
      setDatos(r.data.team);
      setErrorCarga(null);
    } else if (r.error) setErrorCarga(r.error);
  }, [base]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  // Mientras el asistente arma la propuesta, se revisa cada 6 s (sin desmontar nada).
  const enCurso = datos?.pedido && (datos.pedido.status === 'pendiente' || datos.pedido.status === 'en_curso');
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(() => void cargar(), 6000);
    return () => clearInterval(t);
  }, [enCurso, cargar]);

  const propuestos = useMemo(() => datos?.members.filter((m) => m.status === 'propuesto') ?? [], [datos]);
  const aprobados = useMemo(() => datos?.members.filter((m) => m.status === 'aprobado') ?? [], [datos]);
  const descartados = useMemo(() => datos?.members.filter((m) => m.status === 'descartado') ?? [], [datos]);

  const cambiar = async (s: SubagenteDto, cuerpo: Record<string, unknown>, ok: string): Promise<boolean> => {
    setOcupado(s.id);
    const r = await apiSend('PATCH', `${base}/${s.id}`, cuerpo, 'No se pudo guardar el cambio.');
    setOcupado(null);
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error });
      void cargar();
      return false;
    }
    avisar({ tipo: cuerpo.action === 'descartar' ? 'advertencia' : 'ok', texto: ok });
    void cargar();
    return true;
  };

  const sugerir = async (agentCode?: string) => {
    setOcupado('sugerir');
    const r = await apiSend('POST', `${base}/sugerencias`, agentCode ? { agentCode } : {}, 'No se pudo pedir la sugerencia.');
    setOcupado(null);
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error });
      return;
    }
    avisar({ tipo: 'ok', texto: 'Pedido enviado. El asistente armará una propuesta de equipo; aparecerá aquí en unos minutos.' });
    void cargar();
  };

  const configurar = async (cambios: { enabled?: boolean; maxParallel?: number }) => {
    setOcupado('config');
    const r = await apiSend('PATCH', base, cambios, 'No se pudo guardar la configuración.');
    setOcupado(null);
    if (!r.ok) avisar({ tipo: 'error', texto: r.error });
    else
      avisar({
        tipo: 'ok',
        texto:
          cambios.enabled === false
            ? 'Equipo apagado: el asistente trabajará solo hasta que lo vuelva a encender.'
            : cambios.enabled === true
              ? 'Equipo encendido: el asistente podrá delegar en los subagentes aprobados.'
              : `Listo: hasta ${cambios.maxParallel} subagentes a la vez.`,
      });
    void cargar();
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
      <Stack gap='sm' aria-hidden='true' data-testid='equipo-esqueleto'>
        <Skeleton height={110} radius='md' />
        {Array.from({ length: 3 }, (_, i) => (
          <Group key={i} gap='sm' wrap='nowrap' p='sm' style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)' }}>
            <Skeleton height={38} circle />
            <Stack gap={6} style={{ flex: 1 }}>
              <Skeleton height={12} width='40%' radius='sm' />
              <Skeleton height={10} width='85%' radius='sm' />
              <Skeleton height={16} width='50%' radius='xl' />
            </Stack>
          </Group>
        ))}
      </Stack>
    );
  }

  const caps = datos.capacidades;
  const pedido = datos.pedido;
  const sugeridores = datos.sugeridores;
  const reciente = (iso: string | null) => (iso ? Date.now() - new Date(iso).getTime() < 24 * 60 * 60_000 : false);
  const botonSugerir = caps.sugerir ? (
    sugeridores.length > 1 ? (
      <Menu position='bottom-end' withinPortal>
        <Menu.Target>
          <Button leftSection={<IconSparkles size={18} />} rightSection={<IconChevronDown size={14} />} loading={ocupado === 'sugerir'} disabled={!!enCurso} data-testid='equipo-sugerir'>
            Sugerir equipo
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>¿Qué asistente propone el equipo?</Menu.Label>
          {sugeridores.map((a) => (
            <Menu.Item key={a.code} leftSection={<AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={22} showStatus={false} withTooltip={false} />} onClick={() => void sugerir(a.code)} style={{ minHeight: 44 }}>
              {a.displayName}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    ) : (
      <Tooltip label='No tiene asignado ninguno de los asistentes del proyecto.' disabled={sugeridores.length > 0} withArrow>
        <div>
          <Button leftSection={<IconSparkles size={18} />} loading={ocupado === 'sugerir'} disabled={!!enCurso || sugeridores.length === 0} onClick={() => void sugerir(sugeridores[0]?.code)} data-testid='equipo-sugerir'>
            Sugerir equipo
          </Button>
        </div>
      </Tooltip>
    )
  ) : null;

  return (
    <Stack gap='sm' data-testid='equipo'>
      {/* ── Cabecera: qué es, topes y acciones ── */}
      <Card withBorder radius='md' p='sm' className={css.cabecera}>
        <div className={css.cabeceraFila}>
          <Group gap={10} wrap='nowrap' style={{ minWidth: 0, flex: '1 1 260px' }}>
            <ThemeIcon size={40} radius='md' variant='light' color='indigo' style={{ flexShrink: 0 }}>
              <IconUsersGroup size={22} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={700}>Equipo de subagentes</Text>
              <Text size='sm' c='dimmed'>
                {escritorio
                  ? 'Especialistas en los que el asistente reparte el trabajo de una conversación. Solo trabajan los aprobados, con las herramientas aprobadas, y no escriben en SynerLink ni en SAP.'
                  : 'Especialistas que apoyan al asistente. Solo trabajan los aprobados y no escriben en SynerLink ni en SAP.'}
              </Text>
            </div>
          </Group>
          <Group gap={8} wrap='wrap' className={css.cabeceraAcciones}>
            {caps.configurar ? (
              <Switch
                checked={datos.enabled}
                onChange={(e) => void configurar({ enabled: e.currentTarget.checked })}
                disabled={ocupado === 'config'}
                label={datos.enabled ? 'Encendido' : 'Apagado'}
                size='md'
                className={css.interruptor}
                data-testid='equipo-interruptor'
              />
            ) : (
              <Badge variant='light' color={datos.enabled ? 'green' : 'gray'}>
                {datos.enabled ? 'Encendido' : 'Apagado'}
              </Badge>
            )}
            {botonSugerir}
          </Group>
        </div>
        <div className={css.topes} data-testid='equipo-topes'>
          <Group gap={6} wrap='nowrap'>
            <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
              A la vez:
            </Text>
            {caps.configurar ? (
              <SegmentedControl
                size='xs'
                value={String(datos.maxParallel)}
                onChange={(v) => void configurar({ maxParallel: Number(v) })}
                data={Array.from({ length: datos.topeMaximo }, (_, i) => String(i + 1))}
                disabled={ocupado === 'config'}
                aria-label='Subagentes a la vez'
                data-testid='equipo-tope'
              />
            ) : (
              <Badge size='sm' variant='light' color='indigo'>
                hasta {datos.maxParallel}
              </Badge>
            )}
          </Group>
          <Badge size='sm' variant='light' color='gray' leftSection={<IconHierarchy2 size={12} />} style={{ textTransform: 'none' }}>
            No lanzan otros subagentes
          </Badge>
          <Badge size='sm' variant='light' color='gray' leftSection={<IconPlugConnected size={12} />} style={{ textTransform: 'none' }}>
            Conectores: {datos.profileLabel}
          </Badge>
          <Badge size='sm' variant='light' color='gray' style={{ textTransform: 'none' }}>
            {aprobados.length}/{datos.maxEquipo} aprobados
          </Badge>
        </div>
      </Card>

      {/* ── Pedido de sugerencia ── */}
      {pedido && enCurso && (
        <Alert color='blue' radius='md' icon={<Loader size={16} />} py={8} data-testid='equipo-pedido'>
          <b>{pedido.agent?.displayName ?? 'El asistente'}</b> está armando una propuesta de equipo
          {pedido.requestedBy ? ` (la pidió ${pedido.requestedBy.name} ${fechaCorta(pedido.requestedAt)})` : ''}. Suele tardar uno o dos minutos.
        </Alert>
      )}
      {pedido && (pedido.status === 'fallida' || pedido.status === 'vencida') && reciente(pedido.finishedAt) && propuestos.length === 0 && (
        <Alert color='yellow' radius='md' icon={<IconAlertTriangle size={18} />} py={8} data-testid='equipo-pedido-error'>
          La última sugerencia no salió: {pedido.error ?? 'el asistente no respondió.'} {caps.sugerir ? 'Puede pedirla de nuevo.' : ''}
        </Alert>
      )}

      {/* ── Propuestos ── */}
      {propuestos.length > 0 && (
        <Card withBorder radius='md' p='sm' className={css.bloquePropuesto} data-testid='equipo-propuestos'>
          <Group gap={6} mb={8} wrap='nowrap'>
            <Badge color='grape' variant='light' style={{ flexShrink: 0 }}>
              {propuestos.length === 1 ? '1 propuesto' : `${propuestos.length} propuestos`}
            </Badge>
            <Text size='sm' fw={600} className={cssP.truncar}>
              {caps.aprobar ? (escritorio ? 'Revise cada uno: apruébelo, edítelo o descártelo' : 'Apruebe, edite o descarte') : escritorio ? 'Esperando la decisión del dueño del proyecto' : 'Esperan al dueño'}
            </Text>
          </Group>
          <Stack gap={8}>
            {propuestos.map((s) => (
              <TarjetaSubagente
                key={s.id}
                s={s}
                acciones={
                  caps.aprobar ? (
                    <>
                      {escritorio ? (
                        <Button variant='subtle' color='gray' size='xs' leftSection={<IconX size={14} />} loading={ocupado === s.id} onClick={() => void cambiar(s, { action: 'descartar' }, `«${s.name}» descartado.`)} data-testid='equipo-descartar'>
                          Descartar
                        </Button>
                      ) : (
                        <ActionIcon variant='default' size={44} radius='md' aria-label={`Descartar «${s.name}»`} loading={ocupado === s.id} onClick={() => void cambiar(s, { action: 'descartar' }, `«${s.name}» descartado.`)} data-testid='equipo-descartar' className={css.descartar}>
                          <IconX size={18} />
                        </ActionIcon>
                      )}
                      <Button variant='default' size='xs' leftSection={<IconPencil size={14} />} onClick={() => setEditando(s)} data-testid='equipo-editar'>
                        Editar
                      </Button>
                      <Tooltip label={`El equipo admite ${datos.maxEquipo} aprobados.`} disabled={aprobados.length < datos.maxEquipo} withArrow>
                        <div>
                          <Button color='green' size='xs' leftSection={<IconCheck size={14} />} loading={ocupado === s.id} disabled={aprobados.length >= datos.maxEquipo} onClick={() => void cambiar(s, { action: 'aprobar' }, `«${s.name}» aprobado: el asistente ya puede delegarle trabajo.`)} data-testid='equipo-aprobar'>
                            Aprobar
                          </Button>
                        </div>
                      </Tooltip>
                    </>
                  ) : null
                }
              />
            ))}
          </Stack>
        </Card>
      )}

      {/* ── Aprobados ── */}
      <Stack gap={8}>
        <Group justify='space-between' wrap='nowrap' gap='xs'>
          <Text fw={600}>Equipo aprobado</Text>
          {!datos.enabled && aprobados.length > 0 && (
            <Badge color='gray' variant='light'>
              En pausa
            </Badge>
          )}
        </Group>
        {aprobados.length === 0 ? (
          <Stack align='center' gap={6} py='lg' px='sm' className={css.vacio} data-testid='equipo-vacio'>
            <ThemeIcon size={44} radius='xl' variant='light' color='indigo'>
              <IconUsersGroup size={24} />
            </ThemeIcon>
            <Text fw={600}>Todavía no hay subagentes aprobados</Text>
            <Text size='sm' c='dimmed' ta='center' maw={460}>
              {caps.sugerir
                ? 'Pida al asistente que sugiera un equipo: analizará el nombre, la descripción, las instrucciones, lo vinculado y el cronograma, y propondrá de 3 a 6 especialistas.'
                : 'Cuando el dueño apruebe subagentes, aparecerán aquí. Mientras tanto, el asistente trabaja solo.'}
            </Text>
          </Stack>
        ) : (
          aprobados.map((s) => (
            <TarjetaSubagente
              key={s.id}
              s={s}
              acciones={
                caps.aprobar ? (
                  <>
                    <Button variant='subtle' color='red' size='xs' leftSection={<IconX size={14} />} onClick={() => setRetirando(s)} data-testid='equipo-retirar'>
                      Retirar
                    </Button>
                    <Button variant='default' size='xs' leftSection={<IconPencil size={14} />} onClick={() => setEditando(s)}>
                      Editar
                    </Button>
                  </>
                ) : null
              }
            />
          ))
        )}
      </Stack>

      {/* ── Actividad y consumo ── */}
      <Stack gap={8}>
        <Group justify='space-between' wrap='wrap' gap='xs'>
          <Text fw={600}>Actividad reciente</Text>
          <Text size='xs' c='dimmed'>
            30 días: {datos.consumo30d.corridas === 1 ? '1 tarea' : `${numero(datos.consumo30d.corridas)} tareas`} · {numero(datos.consumo30d.tokens)} fichas
          </Text>
        </Group>
        {datos.corridas.length === 0 ? (
          <Text size='sm' c='dimmed' className={css.vacioLinea}>
            Aquí verá qué hizo cada subagente, en qué conversación, cuánto tardó y cuánto consumió. En el chat, mientras trabajan, aparecen en la tablita de sub-agentes.
          </Text>
        ) : (
          <div className={css.listaCorridas}>
            {datos.corridas.map((c) => (
              <FilaCorrida key={c.id} c={c} />
            ))}
          </div>
        )}
      </Stack>

      {/* ── Descartados ── */}
      {descartados.length > 0 && (
        <Stack gap={6}>
          <UnstyledButton className={css.verMas} onClick={() => setVerDescartados((v) => !v)} aria-expanded={verDescartados} data-testid='equipo-ver-descartados'>
            <Text size='sm' c='dimmed' fw={500}>
              Descartados ({descartados.length})
            </Text>
            <IconChevronDown size={16} style={{ transform: verDescartados ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} color='var(--mantine-color-dimmed)' />
          </UnstyledButton>
          <Collapse in={verDescartados}>
            <Stack gap={6}>
              {descartados.map((s) => (
                <div key={s.id} className={css.descartado}>
                  <Avatar color='gray' radius='xl' size={30} variant='light' aria-hidden>
                    {iniciales(s.name)}
                  </Avatar>
                  <div className={css.tarjetaTexto}>
                    <Text size='sm' className={cssP.truncar}>
                      {s.name}
                    </Text>
                    <Text size='xs' c='dimmed' className={cssP.truncar}>
                      {s.purpose}
                    </Text>
                  </div>
                  {caps.aprobar && (
                    <Button variant='subtle' size='xs' leftSection={<IconRestore size={14} />} loading={ocupado === s.id} onClick={() => void cambiar(s, { action: 'restaurar' }, `«${s.name}» volvió a propuestos.`)}>
                      Restaurar
                    </Button>
                  )}
                </div>
              ))}
            </Stack>
          </Collapse>
        </Stack>
      )}

      <SubagenteModal
        opened={editando !== null}
        subagente={editando}
        disponibles={datos.disponibles}
        profileLabel={datos.profileLabel}
        puedeAprobar={caps.aprobar && aprobados.length < datos.maxEquipo}
        onClose={() => setEditando(null)}
        onGuardar={async (cambios, aprobar) => {
          if (!editando) return false;
          const ok = await cambiar(editando, aprobar ? { ...cambios, action: 'aprobar' } : { ...cambios }, aprobar ? `«${cambios.name}» guardado y aprobado.` : 'Cambios guardados. El asistente los usa desde su próxima respuesta.');
          if (ok) setEditando(null);
          return ok;
        }}
      />
      <ConfirmarModal
        opened={retirando !== null}
        titulo='Retirar del equipo'
        texto={`«${retirando?.name ?? ''}» deja de trabajar para el asistente desde su próxima respuesta. Queda en «Descartados» y se puede restaurar.`}
        accion='Retirar'
        color='red'
        cargando={retirando !== null && ocupado === retirando.id}
        onClose={() => setRetirando(null)}
        onConfirmar={() => {
          const s = retirando;
          if (!s) return;
          void cambiar(s, { action: 'descartar' }, `«${s.name}» retirado del equipo.`).then(() => setRetirando(null));
        }}
      />
    </Stack>
  );
}
