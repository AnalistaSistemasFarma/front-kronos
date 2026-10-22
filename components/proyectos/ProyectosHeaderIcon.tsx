'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ActionIcon,
  Badge,
  Box,
  Drawer,
  Group,
  Indicator,
  Loader,
  Popover,
  ScrollArea,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconChevronRight, IconFolders, IconRobot, IconUser } from '@tabler/icons-react';
import { chatFetch } from '../../lib/chat/client';
import {
  EVENTO_ACTIVIDAD_PROYECTOS,
  EVENTO_PROYECTO_LEIDO,
  ICONO_PROYECTOS_ANTIRREBOTE_MS,
  ICONO_PROYECTOS_RETRASO_MS,
  ICONO_PROYECTOS_TTL_MS,
  PROYECTOS_HREF,
  ariaIconoProyectos,
  borrarEstado,
  debeMostrarIconoProyectos,
  estadoDesdeRespuesta,
  estadoVencido,
  etiquetaNoLeidos,
  guardarEstado,
  horaCorta,
  leerEstadoGuardado,
  sinConversacion,
  urlConversacion,
  type EstadoIconoProyectos,
  type ItemNoLeidoDto,
} from '../../lib/proyectos/iconoHeader';
import AgentAvatar from '../chat/AgentAvatar';
import { LineaEstadoAgente } from './EstadoAgente';
import { useEstadosAgentes } from './useEstadosAgentes';
import {
  textoSubagentes,
  vistaEstadoAgente,
  type EstadoAgenteProyectoDto,
} from '../../lib/proyectos/estado-agente';

/**
 * Acceso directo al módulo «Proyectos» en la cabecera, junto al Correo y la
 * campana (2026-10-19, Nicolás Rivera). Mismo aspecto que ellos: ActionIcon
 * «subtle» gris, icono Tabler de 18 px (la carpeta del menú de Procesos),
 * tooltip y contador rojo con las conversaciones que tienen mensajes nuevos.
 *
 * Al tocarlo abre el panel con esas conversaciones (proyecto, conversación y
 * asistente, quién escribió, un fragmento y la hora) con las mismas clases de la
 * campana; en el celular el panel sale como hoja inferior. Solo aparece si el
 * servidor confirma el permiso del módulo (lib/proyectos/iconoHeader.ts).
 */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// Compartido entre montajes (la cabecera se vuelve a montar al cambiar de layout).
let memoria: EstadoIconoProyectos | null = null;
let enVuelo: Promise<EstadoIconoProyectos | null> | null = null;

async function consultar(email: string): Promise<EstadoIconoProyectos | null> {
  if (enVuelo) return enVuelo;
  enVuelo = (async () => {
    try {
      const res = await chatFetch('/api/proyectos/no-leidos');
      // 429 / 5xx: no se cambia lo que ya se sabía (fallo silencioso).
      if (res.status === 429 || res.status >= 500) return null;
      const body = res.status === 200 ? await res.json().catch(() => null) : null;
      const e = estadoDesdeRespuesta(email, res.status, body, Date.now());
      memoria = e;
      guardarEstado(storage(), e);
      return e;
    } catch {
      return null;
    } finally {
      enVuelo = null;
    }
  })();
  return enVuelo;
}

type Panel = { cargando: boolean; error: boolean; items: ItemNoLeidoDto[] };

// Agentes trabajando (2026-10-20): lo último que trajo el panel, compartido entre montajes.
let memoriaTrabajando: EstadoAgenteProyectoDto[] = [];

export default function ProyectosHeaderIcon() {
  const { data: session, status } = useSession();
  const email = session?.user?.email ?? null;
  const pathname = usePathname();
  const router = useRouter();
  const celular = useMediaQuery('(max-width: 48em)') ?? false;
  const [estado, setEstado] = useState<EstadoIconoProyectos | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [panel, setPanel] = useState<Panel>({ cargando: false, error: false, items: [] });
  const [marcando, setMarcando] = useState(false);
  // «Orus está trabajando…» (2026-10-20): semilla del panel + lo que entrega el pulso del chat.
  const [semillaTrabajando, setSemillaTrabajando] = useState<EstadoAgenteProyectoDto[]>(() => memoriaTrabajando);
  const estadosAgentes = useEstadosAgentes(semillaTrabajando);
  const trabajando = [...estadosAgentes.values()]
    .filter((e) => vistaEstadoAgente(e, e.agent.displayName).trabajando)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const emailRef = useRef(email);
  emailRef.current = email;
  const abiertoRef = useRef(abierto);
  abiertoRef.current = abierto;

  const aplicar = useCallback(
    (e: EstadoIconoProyectos | null, paraEmail: string) => {
      if (e && emailRef.current === paraEmail) setEstado(e);
    },
    []
  );

  const cargarPanel = useCallback(async () => {
    const paraEmail = emailRef.current;
    if (!paraEmail) return;
    setPanel((p) => ({ ...p, cargando: true, error: false }));
    try {
      const res = await chatFetch('/api/proyectos/no-leidos?detalle=1');
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (emailRef.current !== paraEmail) return;
      if (!body) {
        setPanel((p) => ({ ...p, cargando: false, error: true }));
        return;
      }
      const e = estadoDesdeRespuesta(paraEmail, res.status, body, Date.now());
      memoria = e;
      guardarEstado(storage(), e);
      setEstado(e);
      setPanel({ cargando: false, error: false, items: Array.isArray(body.items) ? (body.items as ItemNoLeidoDto[]) : [] });
      if (Array.isArray(body.trabajando)) {
        memoriaTrabajando = body.trabajando as EstadoAgenteProyectoDto[];
        setSemillaTrabajando(memoriaTrabajando);
      }
    } catch {
      setPanel((p) => ({ ...p, cargando: false, error: true }));
    }
  }, []);

  // Estado guardado (instantáneo) y primera consulta diferida.
  useEffect(() => {
    if (status !== 'authenticated' || !email) {
      if (status === 'unauthenticated') {
        memoria = null;
        borrarEstado(storage());
      }
      setEstado(null);
      return;
    }
    const guardado = memoria ?? leerEstadoGuardado(storage());
    if (guardado && guardado.email.toLowerCase() === email.toLowerCase()) setEstado(guardado);
    if (!estadoVencido(guardado, email, Date.now())) return;
    let cancelado = false;
    const t = setTimeout(() => {
      void consultar(email).then((e) => {
        if (!cancelado) aplicar(e, email);
      });
    }, ICONO_PROYECTOS_RETRASO_MS);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [status, email, aplicar]);

  // Refresco de respaldo: al volver a la pestaña, al navegar y cada TTL, solo si la caché venció.
  useEffect(() => {
    if (status !== 'authenticated' || !email) return;
    const refrescar = () => {
      if (document.visibilityState !== 'visible') return;
      if (!estadoVencido(memoria, email, Date.now())) return;
      void consultar(email).then((e) => aplicar(e, email));
    };
    document.addEventListener('visibilitychange', refrescar);
    const intervalo = setInterval(refrescar, ICONO_PROYECTOS_TTL_MS);
    return () => {
      document.removeEventListener('visibilitychange', refrescar);
      clearInterval(intervalo);
    };
  }, [status, email, aplicar]);

  useEffect(() => {
    if (status !== 'authenticated' || !email || !memoria) return;
    if (!estadoVencido(memoria, email, Date.now())) return;
    void consultar(email).then((e) => aplicar(e, email));
  }, [pathname, status, email, aplicar]);

  // Avisos al instante: el pulso del chat (mensaje nuevo en un proyecto) y la lectura de una conversación.
  useEffect(() => {
    if (status !== 'authenticated' || !email) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const alAviso = () => {
      // Sin el módulo (403 ya confirmado) no hay nada que contar.
      if (memoria && !memoria.visible) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        if (abiertoRef.current) void cargarPanel();
        else void consultar(email).then((e) => aplicar(e, email));
      }, ICONO_PROYECTOS_ANTIRREBOTE_MS);
    };
    window.addEventListener(EVENTO_ACTIVIDAD_PROYECTOS, alAviso);
    window.addEventListener(EVENTO_PROYECTO_LEIDO, alAviso);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener(EVENTO_ACTIVIDAD_PROYECTOS, alAviso);
      window.removeEventListener(EVENTO_PROYECTO_LEIDO, alAviso);
    };
  }, [status, email, aplicar, cargarPanel]);

  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  if (!debeMostrarIconoProyectos(email, estado)) return null;

  const noLeidos = estado?.noLeidos ?? null;
  const etiqueta = etiquetaNoLeidos(noLeidos);
  const activo = pathname?.startsWith(PROYECTOS_HREF) ?? false;

  const alternar = () => {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir) void cargarPanel();
  };

  const abrirConversacion = (item: ItemNoLeidoDto) => {
    const r = sinConversacion(memoria ?? estado, panel.items, item.idConversation);
    if (r.estado) {
      memoria = r.estado;
      guardarEstado(storage(), r.estado);
      setEstado(r.estado);
    }
    setPanel((p) => ({ ...p, items: r.items }));
    setAbierto(false);
    router.push(urlConversacion(item.idProject, item.idConversation));
  };

  const abrirTrabajando = (e: EstadoAgenteProyectoDto) => {
    setAbierto(false);
    router.push(urlConversacion(e.idProject, e.idConversation));
  };

  const marcarTodo = async () => {
    if (marcando) return;
    setMarcando(true);
    try {
      const res = await chatFetch('/api/proyectos/no-leidos', { method: 'POST', body: JSON.stringify({ accion: 'leer-todo' }) });
      if (res.ok) await cargarPanel();
    } finally {
      setMarcando(false);
    }
  };

  const textoTrabajando =
    trabajando.length === 0 ? '' : trabajando.length === 1 ? `${trabajando[0].agent.displayName} está trabajando` : `${trabajando.length} asistentes trabajando`;
  const boton = (
    <Indicator label={etiqueta ?? undefined} size={16} disabled={!etiqueta} color='red' offset={4}>
      <Indicator
        position='bottom-end'
        size={8}
        offset={6}
        color='blue'
        processing
        disabled={trabajando.length === 0}
        withBorder
        data-testid='header-proyectos-trabajando'
      >
      <Tooltip label={textoTrabajando ? `Proyectos · ${textoTrabajando}` : 'Proyectos'} withArrow disabled={abierto}>
        <ActionIcon
          variant='subtle'
          color='gray'
          onClick={alternar}
          aria-label={textoTrabajando ? `${ariaIconoProyectos(noLeidos)}. ${textoTrabajando}` : ariaIconoProyectos(noLeidos)}
          aria-haspopup='dialog'
          aria-expanded={abierto}
          aria-current={activo ? 'page' : undefined}
          data-testid='header-proyectos'
        >
          <IconFolders size={18} />
        </ActionIcon>
      </Tooltip>
      </Indicator>
    </Indicator>
  );

  const contenido = (
    <>
      <div className='notification-bell-header border-b border-[var(--app-border)]'>
        <Group justify='space-between' wrap='nowrap' gap='xs' px='md' py='sm'>
          <Text size='sm' fw={600} className='notification-bell-text' style={{ flexShrink: 0 }}>
            Mensajes nuevos
          </Text>
          {panel.items.length > 0 && (
            <UnstyledButton onClick={() => void marcarTodo()} disabled={marcando} data-testid='proyectos-leer-todo'>
              <Group gap={4}>
                {marcando ? <Loader size={12} /> : <IconCheck size={14} className='notification-bell-accent' />}
                <Text size='xs' className='notification-bell-accent' fw={600}>
                  Marcar todo como leído
                </Text>
              </Group>
            </UnstyledButton>
          )}
        </Group>
      </div>

      <ScrollArea.Autosize mah={celular ? '60dvh' : 420}>
        {trabajando.length > 0 && (
          <div data-testid='proyectos-trabajando'>
            <Text size='xs' fw={600} px='md' pt='sm' pb={4} className='notification-bell-text-muted'>
              Trabajando ahora
            </Text>
            <ul className='list-none m-0 p-0'>
              {trabajando.map((e) => (
                <FilaTrabajando key={e.idConversation} estado={e} onAbrir={abrirTrabajando} />
              ))}
            </ul>
          </div>
        )}
        {panel.cargando && panel.items.length === 0 ? (
          <Group justify='center' py='xl'>
            <Loader size='sm' />
          </Group>
        ) : panel.error && panel.items.length === 0 ? (
          <Text size='sm' ta='center' py='xl' c='red'>
            No se pudieron cargar los mensajes nuevos.{' '}
            <UnstyledButton onClick={() => void cargarPanel()} className='notification-bell-accent' fw={600} fz='sm'>
              Reintentar
            </UnstyledButton>
          </Text>
        ) : panel.items.length === 0 ? (
          <Text size='sm' ta='center' py={trabajando.length > 0 ? 'md' : 'xl'} className='notification-bell-text-muted'>
            No tiene mensajes nuevos en sus proyectos
          </Text>
        ) : (
          <ul className='list-none m-0 p-0' data-testid='proyectos-no-leidos'>
            {panel.items.map((item) => (
              <FilaNoLeido key={item.idConversation} item={item} onAbrir={abrirConversacion} />
            ))}
          </ul>
        )}
      </ScrollArea.Autosize>

      <Group justify='center' px='md' py='sm' className='notification-bell-footer border-t border-[var(--app-border)]'>
        <Text
          component={Link}
          href={PROYECTOS_HREF}
          prefetch={false}
          size='sm'
          fw={600}
          className='notification-bell-accent'
          onClick={() => setAbierto(false)}
        >
          Ver todos los proyectos
        </Text>
      </Group>
    </>
  );

  if (celular) {
    return (
      <>
        {boton}
        <Drawer
          opened={abierto}
          onClose={() => setAbierto(false)}
          position='bottom'
          size='auto'
          radius='lg'
          padding={0}
          withCloseButton={false}
          classNames={{ content: 'notification-bell-dropdown proyectos-hoja', body: 'proyectos-hoja__cuerpo' }}
          aria-label='Mensajes nuevos en Proyectos'
        >
          <div className='proyectos-hoja__asa' aria-hidden />
          {contenido}
        </Drawer>
      </>
    );
  }

  return (
    <Popover opened={abierto} onChange={setAbierto} position='bottom-end' width={400} withArrow shadow='md'>
      <Popover.Target>{boton}</Popover.Target>
      <Popover.Dropdown p={0} className='notification-bell-dropdown' aria-label='Mensajes nuevos en Proyectos'>
        {contenido}
      </Popover.Dropdown>
    </Popover>
  );
}

function FilaNoLeido({ item, onAbrir }: { item: ItemNoLeidoDto; onAbrir: (item: ItemNoLeidoDto) => void }) {
  const u = item.ultimo;
  const esAgente = u?.autorTipo === 'agente';
  const Icono = esAgente ? IconRobot : IconUser;
  return (
    <li>
      <UnstyledButton
        onClick={() => onAbrir(item)}
        w='100%'
        style={{ display: 'block' }}
        aria-label={`Abrir ${item.conversationTitle} en ${item.projectName}: ${item.noLeidos} ${item.noLeidos === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`}
      >
        <Group
          gap='sm'
          wrap='nowrap'
          align='flex-start'
          px='md'
          py='sm'
          className='notification-bell-row notification-bell-row--unread notification-bell-row--interactive border-b border-[var(--app-border)] transition-colors'
        >
          <ThemeIcon size={36} radius='md' variant='light' color='blue' style={{ flexShrink: 0 }}>
            <IconFolders size={18} />
          </ThemeIcon>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap='nowrap' mb={2}>
              <Text size='sm' fw={600} lineClamp={1} style={{ flex: 1 }} className='notification-bell-text'>
                {item.projectName}
              </Text>
              <Badge size='xs' variant='filled' color='red' style={{ flexShrink: 0 }}>
                {item.noLeidos > 99 ? '99+' : item.noLeidos}
              </Badge>
            </Group>
            <Text size='xs' lineClamp={1} className='notification-bell-text-muted'>
              {item.conversationTitle} · {item.agent.displayName}
            </Text>
            {u ? (
              <Group gap={4} wrap='nowrap' mt={4} align='flex-start'>
                <Icono size={14} className='notification-bell-text-muted' style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
                <Text size='xs' lineClamp={2} className='notification-bell-text'>
                  <b>{u.autor}:</b> {u.fragmento}
                </Text>
              </Group>
            ) : null}
            {u ? (
              <Text size='xs' mt={4} className='notification-bell-text-muted'>
                {horaCorta(u.createdAt)}
              </Text>
            ) : null}
          </div>
          <ThemeIcon size='sm' variant='transparent' color='gray' style={{ flexShrink: 0, marginTop: 4 }}>
            <IconChevronRight size={16} />
          </ThemeIcon>
        </Group>
      </UnstyledButton>
    </li>
  );
}

/** Una conversación con su agente trabajando (2026-10-20): mismo renglón de la campana. */
function FilaTrabajando({ estado, onAbrir }: { estado: EstadoAgenteProyectoDto; onAbrir: (e: EstadoAgenteProyectoDto) => void }) {
  const vista = vistaEstadoAgente(estado, estado.agent.displayName);
  const detalle = [vista.actividad, textoSubagentes(vista.subagentes.length)].filter(Boolean).join(' · ');
  return (
    <li>
      <UnstyledButton
        onClick={() => onAbrir(estado)}
        w='100%'
        style={{ display: 'block' }}
        aria-label={`Abrir ${estado.conversationTitle} en ${estado.projectName}: ${vista.texto}${detalle ? ` ${detalle}` : ''}`}
      >
        <Group
          gap='sm'
          wrap='nowrap'
          align='flex-start'
          px='md'
          py='sm'
          className='notification-bell-row notification-bell-row--interactive border-b border-[var(--app-border)] transition-colors'
        >
          <div style={{ flexShrink: 0 }}>
            <AgentAvatar
              code={estado.agent.code}
              displayName={estado.agent.displayName}
              avatarUrl={estado.agent.avatarUrl}
              avatarVersion={estado.agent.avatarVersion}
              size={36}
              showStatus={false}
              withTooltip={false}
              working
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size='sm' fw={600} lineClamp={1} className='notification-bell-text'>
              {estado.projectName}
            </Text>
            <Text size='xs' lineClamp={1} className='notification-bell-text-muted'>
              {estado.conversationTitle}
            </Text>
            <Box mt={4}>
              <LineaEstadoAgente vista={vista} />
            </Box>
          </div>
          <ThemeIcon size='sm' variant='transparent' color='gray' style={{ flexShrink: 0, marginTop: 4 }}>
            <IconChevronRight size={16} />
          </ThemeIcon>
        </Group>
      </UnstyledButton>
    </li>
  );
}
