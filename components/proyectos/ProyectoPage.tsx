'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ActionIcon, Anchor, Badge, Box, Card, Group, NavLink, Skeleton, Stack, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconFile,
  IconFolder,
  IconInfoCircle,
  IconLink,
  IconLock,
  IconMessages,
  IconShieldLock,
  IconTimeline,
  IconUsers,
  IconUsersGroup,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import AgentAvatar from '../chat/AgentAvatar';
import ChatThread from '../chat/ChatThread';
import { EsqueletoHilo } from '../chat/ChatSkeletons';
import type { ChatAgentDto } from '../../lib/chat/client';
import type { ProyectoDetalleDto } from '../../lib/proyectos/tipos';
import { apiGet, apiSend } from './api';
import {
  ConfirmarModal,
  DesignarAgenteModal,
  InvitarModal,
  NuevaConversacionModal,
  VincularCorreoModal,
  VincularSolicitudModal,
} from './modales';
import { ListaConversaciones, SeccionArchivos, SeccionDetalles, SeccionMiembros, SeccionVinculados } from './secciones';
import SeccionCronograma from './cronograma/SeccionCronograma';
import SeccionEquipo from './equipo/SeccionEquipo';
import SeccionPermisos from './permisos/SeccionPermisos';
import { AgentesApilados, AvisoArriba, BadgeRol, CONSULTA_ESCRITORIO, Encabezado, EsqueletoFilas, type Aviso } from './ui';
import css from './proyectos.module.css';
import { useEstadosAgentes } from './useEstadosAgentes';
import MedidorConsumo, { useConsumoAnthropic } from './MedidorConsumo';
import type { EstadoAgenteProyectoDto } from '../../lib/proyectos/estado-agente';

/**
 * UN PROYECTO — /process/proyectos/<id>.
 *
 * Escritorio (≥ 62em): dos columnas fijas a la pantalla, como el Correo y el
 * chat. A la izquierda el proyecto (nombre, empresa, asistentes, secciones y la
 * lista de conversaciones); a la derecha la conversación abierta —el mismo
 * ChatThread del chat— o la sección escogida. La página no se desplaza: la caja
 * de escribir queda SIEMPRE a la vista.
 *
 * Celular y tableta: encabezado compacto, pestañas de una sola fila que se
 * desplazan de lado y la sección a pantalla completa. Una conversación se abre
 * a pantalla completa (modo inmersivo del chat), con ← para volver.
 *
 * Las pantallas no deciden ningún permiso: la reja está en el servidor
 * (`capabilities` solo dice qué botones pintar).
 */

// «Equipo» (F2, 2026-10-18): los subagentes del proyecto, junto al cronograma.
// «Permisos» (2026-10-20): qué pueden hacer los agentes con el código del proyecto.
type Seccion = 'conversaciones' | 'cronograma' | 'equipo' | 'vinculados' | 'archivos' | 'miembros' | 'permisos' | 'detalles';
const SECCIONES: Seccion[] = ['conversaciones', 'cronograma', 'equipo', 'vinculados', 'archivos', 'miembros', 'permisos', 'detalles'];

function esSeccion(v: string | null): v is Seccion {
  return v !== null && (SECCIONES as string[]).includes(v);
}

type Confirmacion = { titulo: string; texto: string; accion: string; color?: string; hacer: () => Promise<boolean> } | null;

export default function ProyectoPage({ idProject }: { idProject: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: sesion } = useSession();
  const miId = sesion?.user?.id as string | undefined;
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  // Cupo de Anthropic de los agentes del proyecto (2026-10-22): en el encabezado, para todos los miembros.
  // Fijo y siempre visible para TODOS los miembros (no depende del rol ni de `capabilities`).
  const { agentes: consumo, cargado: consumoCargado } = useConsumoAnthropic(idProject);

  const [proyecto, setProyecto] = useState<ProyectoDetalleDto | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [seccion, setSeccion] = useState<Seccion>(() => {
    const s = searchParams.get('seccion');
    return esSeccion(s) ? s : 'conversaciones';
  });
  const [idConversacion, setIdConversacion] = useState<number | null>(() => {
    const n = Number(searchParams.get('conversacion'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [ocupado, setOcupado] = useState(false);
  const [modal, setModal] = useState<'conversacion' | 'correo' | 'solicitud' | 'invitar' | 'agentes' | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmacion>(null);
  // Cronograma (2026-10-18): sube cada vez que el proyecto se recarga, para que la sección se refresque.
  const [version, setVersion] = useState(0);

  const avisar = useCallback((a: Aviso) => {
    setAviso(a);
    if (a?.tipo === 'ok') toast.success(a.texto);
    else if (a?.tipo === 'error') toast.error(a.texto);
  }, []);

  const cargar = useCallback(async () => {
    const r = await apiGet<{ project: ProyectoDetalleDto }>(`/api/proyectos/${idProject}`, 'No se pudo cargar el proyecto.');
    if (r.ok) {
      setProyecto(r.data.project);
      setVersion((v) => v + 1);
      setSinAcceso(false);
      // En escritorio se abre de una vez la conversación más reciente; en el
      // celular, no: primero se ve el proyecto.
      const anchoAhora = window.matchMedia(CONSULTA_ESCRITORIO).matches;
      setIdConversacion((actual) => actual ?? (anchoAhora ? r.data.project.conversations[0]?.id ?? null : null));
    } else if (r.status === 404) {
      setSinAcceso(true);
    } else if (r.error) {
      avisar({ tipo: 'error', texto: r.error });
    }
  }, [idProject, avisar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const creado = searchParams.get('creado');
    if (creado === '1') setAviso({ tipo: 'ok', texto: 'Proyecto creado. Abra una conversación con uno de sus asistentes.' });
    // Equipo de subagentes (F2): se pidió la sugerencia al crear.
    if (creado === 'equipo') {
      setAviso({ tipo: 'ok', texto: 'Proyecto creado. El asistente está armando una propuesta de equipo: revísela en «Equipo» en unos minutos.' });
    }
  }, [searchParams]);

  // La dirección refleja la conversación y la sección: «atrás» funciona y el enlace se puede compartir.
  useEffect(() => {
    const p = new URLSearchParams();
    if (seccion !== 'conversaciones') p.set('seccion', seccion);
    if (idConversacion) p.set('conversacion', String(idConversacion));
    const qs = p.toString();
    window.history.replaceState(null, '', `/process/proyectos/${idProject}${qs ? `?${qs}` : ''}`);
  }, [idProject, seccion, idConversacion]);

  // Estado en vivo de los agentes de ESTE proyecto (2026-10-20): lo que trajo la
  // carga y, después, lo que entrega el pulso del chat. Sin peticiones propias.
  const semillaEstados = useMemo(
    () => (proyecto?.conversations ?? []).map((c) => c.agentStatus).filter((e): e is EstadoAgenteProyectoDto => !!e),
    [proyecto]
  );
  const estados = useEstadosAgentes(semillaEstados, (e) => e.idProject === idProject);

  const conversacion = proyecto?.conversations.find((c) => c.id === idConversacion) ?? null;
  const agenteConversacion: ChatAgentDto | null = useMemo(() => {
    if (!proyecto || !conversacion) return null;
    return {
      ...conversacion.agent,
      description: null,
      sortOrder: 0,
      companies: [{ ...proyecto.company, isPrimary: false }],
      busy: false,
    } as ChatAgentDto;
  }, [proyecto, conversacion]);

  // CELULAR con una conversación abierta: pantalla completa como el chat. La
  // marca se quita SIEMPRE al salir, o la aplicación quedaría sin navegación.
  const inmersivo = !escritorio && conversacion !== null && seccion === 'conversaciones';
  useLayoutEffect(() => {
    if (!inmersivo) return;
    const y = window.scrollY;
    document.body.classList.add('chat-inmersivo');
    document.documentElement.classList.add('chat-inmersivo');
    return () => {
      document.body.classList.remove('chat-inmersivo');
      document.documentElement.classList.remove('chat-inmersivo');
      window.scrollTo({ top: y, behavior: 'instant' });
    };
  }, [inmersivo]);

  /* ─────────────────────────────── Acciones ─────────────────────────────── */

  const accion = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okTexto: string | null
  ): Promise<boolean> => {
    setOcupado(true);
    const r = await fn();
    setOcupado(false);
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error ?? 'No se pudo completar la acción.' });
      return false;
    }
    if (okTexto) avisar({ tipo: 'ok', texto: okTexto });
    await cargar();
    return true;
  };

  const base = `/api/proyectos/${idProject}`;

  const subirArchivos = (archivos: File[]) => {
    if (archivos.length === 0) return;
    const form = new FormData();
    for (const a of archivos) form.append('files', a);
    void accion(() => apiSend('POST', `${base}/archivos`, form, 'No se pudieron cargar los archivos.'), archivos.length === 1 ? 'Archivo cargado al proyecto.' : `${archivos.length} archivos cargados al proyecto.`);
  };

  const pedirConfirmacion = (c: NonNullable<Confirmacion>) => setConfirmar(c);

  const retirarMiembro = (idUser: string, esYo: boolean) =>
    pedirConfirmacion({
      titulo: esYo ? 'Salir del proyecto' : 'Retirar del proyecto',
      texto: esYo ? 'Dejará de ver este proyecto y sus conversaciones. El dueño puede volver a invitarlo.' : 'La persona dejará de ver el proyecto y sus conversaciones.',
      accion: esYo ? 'Salir' : 'Retirar',
      hacer: async () => {
        const ok = await accion(() => apiSend('DELETE', `${base}/miembros?idUser=${encodeURIComponent(idUser)}`), esYo ? null : 'Persona retirada del proyecto.');
        if (ok && esYo) router.push('/process/proyectos');
        return ok;
      },
    });

  /* ─────────────────────────────── Pantallas ────────────────────────────── */

  if (sinAcceso) {
    return (
      <div className={css.pantalla}>
        <Encabezado titulo='Proyectos' />
        <Stack align='center' gap={8} py={48} px='md'>
          <ThemeIcon size={48} radius='xl' variant='light' color='yellow'>
            <IconLock size={26} />
          </ThemeIcon>
          <Text fw={600}>Proyecto no disponible</Text>
          <Text size='sm' c='dimmed' ta='center' maw={420}>
            Este proyecto no existe, fue archivado o usted no forma parte de él.
          </Text>
          <Anchor component={Link} href='/process/proyectos' size='sm'>
            Volver a Proyectos
          </Anchor>
        </Stack>
      </div>
    );
  }

  const conteo: Record<Seccion, number | null> = {
    conversaciones: proyecto?.conversations.length ?? null,
    cronograma: proyecto ? proyecto.taskCount + proyecto.links.requests.length : null,
    equipo: proyecto?.teamCount ?? null,
    vinculados: proyecto ? proyecto.links.emails.length + proyecto.links.requests.length : null,
    archivos: proyecto?.files.length ?? null,
    miembros: proyecto?.members.length ?? null,
    permisos: null,
    detalles: null,
  };
  const etiqueta: Record<Seccion, string> = {
    conversaciones: 'Conversaciones',
    cronograma: 'Cronograma',
    equipo: 'Equipo',
    vinculados: 'Vinculados',
    archivos: 'Archivos',
    miembros: 'Miembros',
    permisos: 'Permisos',
    detalles: 'Detalles',
  };
  const icono: Record<Seccion, React.ReactNode> = {
    conversaciones: <IconMessages size={18} />,
    cronograma: <IconTimeline size={18} />,
    equipo: <IconUsersGroup size={18} />,
    vinculados: <IconLink size={18} />,
    archivos: <IconFile size={18} />,
    miembros: <IconUsers size={18} />,
    permisos: <IconShieldLock size={18} />,
    detalles: <IconInfoCircle size={18} />,
  };

  const contenidoSeccion = (s: Seccion) => {
    if (!proyecto) return <EsqueletoFilas n={5} />;
    switch (s) {
      case 'conversaciones':
        return (
          <ListaConversaciones
            proyecto={proyecto}
            activa={idConversacion}
            onAbrir={(id) => setIdConversacion(id)}
            onNueva={() => setModal('conversacion')}
            estados={estados}
          />
        );
      case 'cronograma':
        return <SeccionCronograma proyecto={proyecto} version={version} avisar={avisar} onVincularSolicitud={() => setModal('solicitud')} />;
      case 'equipo':
        return <SeccionEquipo proyecto={proyecto} version={version} avisar={avisar} />;
      case 'permisos':
        return <SeccionPermisos proyecto={proyecto} version={version} avisar={avisar} />;
      case 'vinculados':
        return (
          <SeccionVinculados
            proyecto={proyecto}
            onVincularCorreo={() => setModal('correo')}
            onVincularSolicitud={() => setModal('solicitud')}
            onQuitarCorreo={(id) =>
              pedirConfirmacion({
                titulo: 'Quitar el correo del proyecto',
                texto: 'El hilo sigue en el buzón de quien lo vinculó; solo deja de estar en el proyecto.',
                accion: 'Quitar',
                hacer: () => accion(() => apiSend('DELETE', `${base}/vinculos/correos/${id}`), 'Correo quitado del proyecto.'),
              })
            }
            onQuitarSolicitud={(id) =>
              pedirConfirmacion({
                titulo: 'Quitar la solicitud del proyecto',
                texto: 'El caso no cambia en SynerLink; solo deja de estar en el proyecto.',
                accion: 'Quitar',
                hacer: () => accion(() => apiSend('DELETE', `${base}/vinculos/solicitudes/${id}`), 'Solicitud quitada del proyecto.'),
              })
            }
          />
        );
      case 'archivos':
        return (
          <SeccionArchivos
            proyecto={proyecto}
            subiendo={ocupado}
            onSubir={subirArchivos}
            onQuitar={(id) =>
              pedirConfirmacion({
                titulo: 'Quitar el archivo',
                texto: 'Los asistentes dejarán de leerlo desde su próxima respuesta.',
                accion: 'Quitar',
                hacer: () => accion(() => apiSend('DELETE', `${base}/archivos/${id}`), 'Archivo quitado del proyecto.'),
              })
            }
          />
        );
      case 'miembros':
        return (
          <SeccionMiembros
            proyecto={proyecto}
            miId={miId}
            onInvitar={() => setModal('invitar')}
            onCambiarRol={(idUser, role) => void accion(() => apiSend('PATCH', `${base}/miembros`, { idUser, role }), 'Rol actualizado.')}
            onRetirar={retirarMiembro}
          />
        );
      case 'detalles':
        return (
          <SeccionDetalles
            proyecto={proyecto}
            guardando={ocupado}
            onGuardar={(cambios) => void accion(() => apiSend('PATCH', base, cambios), 'Cambios guardados. Los asistentes los usan desde su próxima respuesta.')}
            onDesignar={() => setModal('agentes')}
            onRetirarAgente={(code) =>
              pedirConfirmacion({
                titulo: 'Retirar el asistente',
                texto: 'Sus conversaciones quedan en el proyecto, pero de solo lectura.',
                accion: 'Retirar',
                hacer: () => accion(() => apiSend('DELETE', `${base}/agentes?code=${encodeURIComponent(code)}`), 'Asistente retirado del proyecto.'),
              })
            }
            onArchivar={() =>
              pedirConfirmacion({
                titulo: 'Archivar el proyecto',
                texto: 'Los miembros y los asistentes dejan de verlo. Usted lo puede restaurar desde «Archivados».',
                accion: 'Archivar',
                hacer: async () => {
                  const ok = await accion(() => apiSend('DELETE', base), null);
                  if (ok) router.push('/process/proyectos');
                  return ok;
                },
              })
            }
            onRestaurar={() => void accion(() => apiSend('PATCH', base, { archived: false }), 'Proyecto restaurado.')}
          />
        );
    }
  };

  const cabeceraHilo = conversacion && agenteConversacion && proyecto && (
    <Group justify='space-between' p='sm' className='chat-panel__header' wrap='nowrap'>
      <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
        {!escritorio && (
          <ActionIcon variant='subtle' color='gray' size={44} onClick={() => setIdConversacion(null)} aria-label='Volver al proyecto'>
            <IconArrowLeft size={20} />
          </ActionIcon>
        )}
        <AgentAvatar code={agenteConversacion.code} displayName={agenteConversacion.displayName} avatarUrl={agenteConversacion.avatarUrl} avatarVersion={agenteConversacion.avatarVersion} size={36} showStatus={false} withTooltip={false} />
        <Box style={{ minWidth: 0 }}>
          <Text fw={600} size='sm' className={css.truncar}>
            {conversacion.title ?? 'Conversación'}
          </Text>
          <Text size='xs' c='dimmed' className={css.truncar}>
            {proyecto.name} · {agenteConversacion.displayName}
          </Text>
        </Box>
      </Group>
    </Group>
  );

  const hilo =
    conversacion && agenteConversacion && proyecto ? (
      <>
        {cabeceraHilo}
        {/* Celular: el hilo va a pantalla completa y tapa el encabezado; la píldora sigue arriba, a la derecha. */}
        {!escritorio && (
          <div className={css.medidorMovil}>
            <MedidorConsumo agentes={consumo} cargado={consumoCargado} />
          </div>
        )}
        <ChatThread
          key={conversacion.id}
          agent={agenteConversacion}
          project={{ idConversation: conversacion.id, name: proyecto.name, readOnly: conversacion.soloLectura }}
          currentUserId={miId}
          active
        />
      </>
    ) : null;

  const modales = proyecto ? (
    <>
      <NuevaConversacionModal
        opened={modal === 'conversacion'}
        proyecto={proyecto}
        onClose={() => setModal(null)}
        onCreada={(id) => {
          setModal(null);
          setSeccion('conversaciones');
          setIdConversacion(id);
          void cargar();
        }}
      />
      <VincularCorreoModal
        opened={modal === 'correo'}
        proyecto={proyecto}
        onClose={() => setModal(null)}
        onVinculado={() => {
          setModal(null);
          avisar({ tipo: 'ok', texto: 'Correo vinculado al proyecto.' });
          void cargar();
        }}
      />
      <VincularSolicitudModal
        opened={modal === 'solicitud'}
        proyecto={proyecto}
        onClose={() => setModal(null)}
        onVinculado={() => {
          setModal(null);
          avisar({ tipo: 'ok', texto: 'Solicitud vinculada al proyecto.' });
          void cargar();
        }}
      />
      <InvitarModal
        opened={modal === 'invitar'}
        proyecto={proyecto}
        onClose={() => setModal(null)}
        onInvitados={(n) => {
          setModal(null);
          avisar({ tipo: 'ok', texto: n === 1 ? 'Persona agregada al proyecto.' : `${n} personas agregadas al proyecto.` });
          void cargar();
        }}
      />
      <DesignarAgenteModal
        opened={modal === 'agentes'}
        proyecto={proyecto}
        onClose={() => setModal(null)}
        onDesignados={() => {
          setModal(null);
          avisar({ tipo: 'ok', texto: 'Asistente agregado al proyecto.' });
          void cargar();
        }}
      />
      <ConfirmarModal
        opened={confirmar !== null}
        titulo={confirmar?.titulo ?? ''}
        texto={confirmar?.texto ?? ''}
        accion={confirmar?.accion ?? ''}
        color={confirmar?.color}
        cargando={ocupado}
        onClose={() => setConfirmar(null)}
        onConfirmar={() => {
          const c = confirmar;
          if (!c) return;
          void c.hacer().then(() => setConfirmar(null));
        }}
      />
    </>
  ) : null;

  // ─── Celular: conversación a pantalla completa ───
  if (inmersivo && hilo) {
    return (
      <div className='chat-page-shell--completa'>
        <Box className='chat-page-thread chat-page-thread--completa' data-testid='proyecto-hilo'>
          {hilo}
        </Box>
        {modales}
      </div>
    );
  }

  const cabeceraProyecto = (
    <div className={css.cabeceraProyecto}>
      <Anchor component={Link} href='/process/proyectos' size='xs' c='dimmed'>
        <Group gap={4} wrap='nowrap'>
          <IconArrowLeft size={14} />
          <span>Proyectos</span>
        </Group>
      </Anchor>
      {proyecto ? (
        <>
          <Title order={2} fz={18} fw={700} mt={6} lineClamp={2} data-testid='proyecto-nombre'>
            {proyecto.name}
          </Title>
          <Group gap={6} mt={6} wrap='wrap'>
            <Badge size='sm' variant='light' color='blue' style={{ textTransform: 'none' }}>
              {proyecto.company.companyName}
            </Badge>
            <BadgeRol role={proyecto.myRole} />
            {proyecto.archived && (
              <Badge size='sm' variant='light' color='yellow'>
                Archivado
              </Badge>
            )}
          </Group>
          <Group gap={8} mt={8} wrap='nowrap'>
            <AgentesApilados agentes={proyecto.agents} size={24} />
            <Text size='xs' c='dimmed' className={css.truncar}>
              {proyecto.agents.map((a) => a.displayName).join(', ')}
            </Text>
          </Group>
        </>
      ) : (
        <Stack gap={8} mt={8}>
          <Skeleton height={18} width='80%' radius='sm' />
          <Skeleton height={12} width='50%' radius='sm' />
        </Stack>
      )}
    </div>
  );

  // ─── Escritorio: dos columnas ───
  if (escritorio) {
    return (
      <div className={css.pantalla}>
        <Encabezado titulo={proyecto?.name ?? 'Proyecto'} derecha={<MedidorConsumo agentes={consumo} cargado={consumoCargado} />} />
        {aviso && <AvisoArriba aviso={aviso} onClose={() => setAviso(null)} />}
        <div className={css.layout}>
          <Card withBorder radius='md' p={0} className={css.columna}>
            {cabeceraProyecto}
            <div className={css.desplazable}>
              <Stack gap={2} p={8}>
                {SECCIONES.map((s) => (
                  <NavLink
                    key={s}
                    active={seccion === s}
                    label={etiqueta[s]}
                    leftSection={icono[s]}
                    rightSection={
                      conteo[s] !== null ? (
                        <Badge size='sm' variant='light' color='gray'>
                          {conteo[s]}
                        </Badge>
                      ) : undefined
                    }
                    onClick={() => setSeccion(s)}
                    style={{ borderRadius: 'var(--mantine-radius-md)', minHeight: 40 }}
                    data-testid={`proyecto-seccion-${s}`}
                  />
                ))}
              </Stack>
              {seccion === 'conversaciones' && <Box px={8} pb={12}>{contenidoSeccion('conversaciones')}</Box>}
            </div>
          </Card>
          <Card withBorder radius='md' p={0} className={css.columna}>
            {seccion === 'conversaciones' ? (
              hilo ? (
                <Box className={`chat-page-thread chat-page-thread--panel ${css.hilo}`} data-testid='proyecto-hilo'>
                  {hilo}
                </Box>
              ) : proyecto ? (
                <Stack align='center' justify='center' gap={6} style={{ flex: 1 }} p='lg'>
                  <IconFolder size={30} color='var(--mantine-color-dimmed)' />
                  <Text size='sm' fw={600}>
                    Escoja o abra una conversación
                  </Text>
                  <Text size='xs' ta='center' c='dimmed' maw={360}>
                    Cada conversación tiene su propia memoria; todas comparten las instrucciones, los archivos y lo vinculado al proyecto.
                  </Text>
                </Stack>
              ) : (
                <EsqueletoHilo />
              )
            ) : (
              <>
                <Group className='chat-panel__header' p='sm' gap={8} wrap='nowrap'>
                  {icono[seccion]}
                  <Text fw={600}>{etiqueta[seccion]}</Text>
                </Group>
                <div className={css.panel}>{contenidoSeccion(seccion)}</div>
              </>
            )}
          </Card>
        </div>
        {modales}
      </div>
    );
  }

  // ─── Celular y tableta: pestañas ───
  return (
    <div className={css.pantalla}>
      <Group gap={4} wrap='nowrap' className={css.encabezado}>
        <ActionIcon component={Link} href='/process/proyectos' variant='subtle' color='gray' size={44} aria-label='Volver a Proyectos'>
          <IconArrowLeft size={20} />
        </ActionIcon>
        <Box style={{ minWidth: 0, flex: 1 }}>
          {proyecto ? (
            <>
              <Title order={1} fz={17} fw={700} className={css.truncar} data-testid='proyecto-nombre'>
                {proyecto.name}
              </Title>
              <Group gap={6} wrap='nowrap'>
                <Text size='xs' c='dimmed' className={css.truncar}>
                  {proyecto.company.companyName} · {proyecto.agents.map((a) => a.displayName).join(', ')}
                </Text>
              </Group>
            </>
          ) : (
            <Stack gap={6}>
              <Skeleton height={16} width='70%' radius='sm' />
              <Skeleton height={10} width='45%' radius='sm' />
            </Stack>
          )}
        </Box>
        {proyecto && <BadgeRol role={proyecto.myRole} />}
      </Group>
      {proyecto && (
        <div className={css.medidorMovil}>
          <MedidorConsumo agentes={consumo} cargado={consumoCargado} />
        </div>
      )}
      <div className={css.pestanas}>
        <Tabs value={seccion} onChange={(v) => esSeccion(v) && setSeccion(v)} variant='default'>
          <Tabs.List>
            {SECCIONES.map((s) => (
              <Tabs.Tab
                key={s}
                value={s}
                leftSection={icono[s]}
                rightSection={
                  conteo[s] ? (
                    <Badge size='xs' variant='light' color='gray' circle={conteo[s]! < 10}>
                      {conteo[s]}
                    </Badge>
                  ) : undefined
                }
                data-testid={`proyecto-tab-${s}`}
              >
                {etiqueta[s]}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </div>
      {aviso && <AvisoArriba aviso={aviso} onClose={() => setAviso(null)} />}
      <div className={css.panel} style={{ padding: '4px 4px 16px' }} data-testid='proyecto-panel'>
        {contenidoSeccion(seccion)}
      </div>
      {modales}
    </div>
  );
}
