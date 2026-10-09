'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
  Box,
  CloseButton,
  Drawer,
  Group,
  Indicator,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessages,
  IconPin,
  IconPinFilled,
  IconSearch,
} from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import dynamic from 'next/dynamic';

// El panel (hilo, editor, voz, markdown) solo se descarga al abrir un asistente: la barra
// va en la cabecera de TODAS las páginas.
const AgentChatPanel = dynamic(() => import('./AgentChatPanel'), { ssr: false });
import { useChatOverview } from './useChatOverview';
import { useChatPins } from './useChatPins';
import { useTituloDeEstado } from './useTituloDeEstado';
import {
  describeAgentStatus,
  formatChatTime,
  toPlainPreview,
  type ChatStatusDto,
} from '../../lib/chat/client';
import {
  CHAT_RAIL_OPEN_EVENT,
  agentKey,
  buildRailItems,
  buildRailSections,
  conversationKey,
  formatUnread,
  railItemHref,
  railOpenDetail,
  totalUnread,
  type ChatRailItem,
  type ChatRailSection,
} from '../../lib/chat/rail';

/**
 * BARRA LATERAL DEL CHAT (2026-09-30, aprobada por Nicolás).
 *
 * Reemplaza a los avatares de la cabecera (ChatAgentBar): con tantos
 * asistentes y personas ya no cabían. Los chats quedan anclados a la
 * izquierda, debajo de la cabecera:
 *
 *   - CONTRAÍDA (por defecto): solo los avatares, con el contador de
 *     pendientes y el punto de estado de siempre (AgentAvatar). Nombre en el
 *     tooltip.
 *   - EXPANDIDA (botón): nombre, último mensaje, buscador y las secciones
 *     📌 Anclados, 🤖 Agentes, 👥 Personas (y Grupos si los hay). Se recuerda
 *     en este equipo si la persona la dejó expandida.
 *   - CELULAR: no ocupa pantalla; un botón en la cabecera la abre como menú
 *     deslizable (Drawer).
 *
 * Qué hace cada clic —igual que antes en la cabecera—:
 *   - En la página del chat, le pide a ChatWorkspace que abra el chat SIN
 *     navegar (evento CHAT_RAIL_OPEN_EVENT; ver lib/chat/rail.ts).
 *   - Asistente en escritorio: el panel flotante (AgentChatPanel).
 *   - Lo demás: la página del chat correspondiente.
 *
 * RENDIMIENTO: la barra vive en TODAS las pantallas. Las filas van
 * memorizadas y con callbacks estables; el sondeo de la bandeja ya descarta
 * respuestas idénticas (useChatOverview), así que la barra solo se repinta
 * cuando de verdad cambió algo.
 */

const CLAVE_EXPANDIDA = 'synerlink:chat-rail-expandida';

function leerExpandida(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_EXPANDIDA) === '1';
  } catch {
    return false;
  }
}

function guardarExpandida(valor: boolean) {
  try {
    window.localStorage.setItem(CLAVE_EXPANDIDA, valor ? '1' : '0');
  } catch {
    /* modo privado: dura lo que dura la pestaña */
  }
}

/** Qué chat está abierto según la dirección (para marcarlo en la barra). */
function claveActivaDeRuta(pathname: string, items: ChatRailItem[]): string | null {
  const persona = pathname.match(/^\/process\/chat\/persona\/(\d+)/);
  if (persona) return conversationKey(Number(persona[1]));
  const grupo = pathname.match(/^\/process\/chat\/grupo\/(\d+)/);
  if (grupo) return conversationKey(Number(grupo[1]));
  const agente = pathname.match(/^\/process\/chat\/([^/]+)$/);
  if (agente) {
    const code = decodeURIComponent(agente[1]).toLowerCase();
    const item = items.find((i) => i.kind === 'agent' && i.agentCode?.toLowerCase() === code);
    return item?.key ?? null;
  }
  return null;
}

/* ───────────────────────────── Fila ───────────────────────────── */

const RailRow = memo(function RailRow({
  item,
  expandida,
  anclado,
  activo,
  status,
  puedeAnclar,
  onOpen,
  onTogglePin,
}: {
  item: ChatRailItem;
  expandida: boolean;
  anclado: boolean;
  activo: boolean;
  status: ChatStatusDto | null;
  puedeAnclar: boolean;
  onOpen: (item: ChatRailItem) => void;
  onTogglePin: (key: string, pinned: boolean) => void;
}) {
  const esAgente = item.kind === 'agent';
  const view = esAgente ? describeAgentStatus(status) : null;
  const pendientes = formatUnread(item.unread);
  const etiqueta = [
    item.kind === 'group' ? `Grupo ${item.name}` : `Chat con ${item.name}`,
    pendientes ? `${pendientes} sin leer` : null,
    view ? view.label : null,
  ]
    .filter(Boolean)
    .join(', ');

  const avatar = (
    <AgentAvatar
      code={item.avatarCode}
      displayName={item.name}
      avatarUrl={item.avatarUrl}
      avatarVersion={item.avatarVersion ?? null}
      unread={item.unread}
      status={status}
      working={item.busy ?? false}
      showStatus={esAgente}
      withTooltip={false}
      size={expandida ? 36 : 38}
    />
  );

  if (!expandida) {
    const tooltip = [item.name, pendientes ? `${pendientes} sin leer` : null, view?.label]
      .filter(Boolean)
      .join(' · ');
    return (
      <li className='chat-rail__li'>
        <Tooltip label={tooltip} position='right' withArrow openDelay={150}>
          <UnstyledButton
            className={`chat-rail__icono${activo ? ' chat-rail__icono--activo' : ''}`}
            onClick={() => onOpen(item)}
            aria-label={etiqueta}
            aria-current={activo ? 'page' : undefined}
          >
            {avatar}
          </UnstyledButton>
        </Tooltip>
      </li>
    );
  }

  const subtitulo =
    view && view.busy ? view.label : item.preview ?? (esAgente ? view?.label : 'Sin mensajes todavía');

  return (
    <li className={`chat-rail__fila${activo ? ' chat-rail__fila--activa' : ''}`}>
      <UnstyledButton
        className='chat-rail__fila-boton'
        onClick={() => onOpen(item)}
        aria-label={etiqueta}
        aria-current={activo ? 'page' : undefined}
      >
        {avatar}
        <Box className='chat-rail__texto'>
          <Group gap={6} wrap='nowrap' justify='space-between'>
            <Text size='sm' fw={item.unread > 0 ? 700 : 600} lineClamp={1}>
              {item.name}
            </Text>
            {item.lastMessageAt && (
              <Text size='xs' className='chat-text-muted' style={{ flexShrink: 0 }}>
                {formatChatTime(item.lastMessageAt)}
              </Text>
            )}
          </Group>
          <Text size='xs' className='chat-text-muted' lineClamp={1}>
            {subtitulo}
          </Text>
        </Box>
      </UnstyledButton>
      {puedeAnclar && (
        <Tooltip label={anclado ? 'Desanclar' : 'Anclar arriba'} withArrow openDelay={300}>
          <ActionIcon
            variant='subtle'
            color={anclado ? 'blue' : 'gray'}
            size='sm'
            className={`chat-rail__ancla${anclado ? ' chat-rail__ancla--puesta' : ''}`}
            onClick={() => onTogglePin(item.key, !anclado)}
            aria-label={anclado ? `Desanclar ${item.name}` : `Anclar ${item.name}`}
            aria-pressed={anclado}
          >
            {anclado ? <IconPinFilled size={15} /> : <IconPin size={15} />}
          </ActionIcon>
        </Tooltip>
      )}
    </li>
  );
});

/* ─────────────────────────── Lista ─────────────────────────── */

const ICONO_SECCION: Record<ChatRailSection['id'], string> = {
  pinned: '📌',
  agents: '🤖',
  people: '👥',
  groups: '💬',
};

function RailList({
  sections,
  expandida,
  pinnedSet,
  activeKey,
  statusByAgent,
  puedeAnclar,
  onOpen,
  onTogglePin,
  busqueda,
}: {
  sections: ChatRailSection[];
  expandida: boolean;
  pinnedSet: ReadonlySet<string>;
  activeKey: string | null;
  statusByAgent: Map<number, ChatStatusDto | null>;
  puedeAnclar: boolean;
  onOpen: (item: ChatRailItem) => void;
  onTogglePin: (key: string, pinned: boolean) => void;
  busqueda: string;
}) {
  if (sections.length === 0) {
    return expandida ? (
      <Text size='sm' className='chat-text-muted' px='md' py='sm'>
        {busqueda.trim() ? `Ningún chat coincide con «${busqueda.trim()}».` : 'No tiene chats todavía.'}
      </Text>
    ) : null;
  }

  return (
    <>
      {sections.map((section, i) => (
        <section
          key={section.id}
          className='chat-rail__seccion'
          aria-label={section.title}
        >
          {expandida ? (
            <Text component='h3' size='xs' fw={700} className='chat-rail__titulo'>
              <span aria-hidden='true'>{ICONO_SECCION[section.id]}</span> {section.title}
            </Text>
          ) : (
            i > 0 && <hr className='chat-rail__separador' aria-hidden='true' />
          )}
          <ul className='chat-rail__lista'>
            {section.items.map((item) => (
              <RailRow
                key={item.key}
                item={item}
                expandida={expandida}
                anclado={pinnedSet.has(item.key)}
                activo={activeKey === item.key}
                status={item.idAgent ? statusByAgent.get(item.idAgent) ?? null : null}
                puedeAnclar={puedeAnclar}
                onOpen={onOpen}
                onTogglePin={onTogglePin}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/* ─────────────────────────── Barra ─────────────────────────── */

export default function ChatRail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const overview = useChatOverview();
  // Mismo corte que AgentChatPanel y la barra anterior: por debajo de 768 px
  // la barra no ocupa pantalla y se abre como menú deslizable.
  // `undefined` en el primer render (Mantine lo resuelve en un efecto): con
  // eso se evita pintar la barra fija un instante en el celular.
  const enCelular = useMediaQuery('(max-width: 768px)') as boolean | undefined;
  const [mounted, setMounted] = useState(false);
  const [expandida, setExpandida] = useState(false);
  const [drawerAbierto, setDrawerAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [openAgentId, setOpenAgentId] = useState<number | null>(null);
  // Tras abrirlo una vez se queda montado (conserva la animación de cierre y el estado).
  const [panelUsado, setPanelUsado] = useState(false);
  if (openAgentId !== null && !panelUsado) setPanelUsado(true);
  const buscadorRef = useRef<HTMLInputElement>(null);
  const enfocarBuscador = useRef(false);

  useEffect(() => {
    setMounted(true);
    setExpandida(leerExpandida());
  }, []);

  // El estado de los asistentes en la PESTAÑA del navegador. Antes lo ponía
  // ChatAgentBar; va aquí porque esta barra también vive en toda la app.
  useTituloDeEstado(overview.agents, overview.statusByAgent, overview.totalUnread);

  const visible = mounted && status === 'authenticated' && overview.canUseChat;
  const pins = useChatPins(visible);

  const items = useMemo(
    () =>
      buildRailItems({
        agents: overview.agents,
        conversationByAgent: overview.conversationByAgent,
        unreadByAgent: overview.unreadByAgent,
        people: overview.people,
        groups: overview.groups,
        miId: session?.user?.id,
        toPreview: toPlainPreview,
      }),
    [
      overview.agents,
      overview.conversationByAgent,
      overview.unreadByAgent,
      overview.people,
      overview.groups,
      session?.user?.id,
    ]
  );

  // Contraída se ignora el buscador: con solo íconos no se ve qué se filtró.
  const mostrarExpandida = expandida || Boolean(enCelular);
  const sections = useMemo(
    () => buildRailSections(items, pins.pins, mostrarExpandida ? busqueda : ''),
    [items, pins.pins, busqueda, mostrarExpandida]
  );
  const pendientes = useMemo(() => totalUnread(items), [items]);

  const activeKey = useMemo(
    () => (openAgentId !== null ? agentKey(openAgentId) : claveActivaDeRuta(pathname, items)),
    [openAgentId, pathname, items]
  );

  const openAgent = useMemo(
    () => overview.agents.find((a) => a.idAgent === openAgentId) ?? null,
    [overview.agents, openAgentId]
  );

  const hayChats = items.length > 0;
  const barraFija = visible && hayChats && enCelular === false;

  // La barra fija corre el contenido de la página: marca en <body> y el ancho
  // en una variable CSS (globals.css, `.con-chat-rail`). Se QUITA al desmontar
  // o al pasar a celular; si quedara pegada, la página quedaría corrida.
  useEffect(() => {
    if (!barraFija) return;
    const body = document.body;
    body.classList.add('con-chat-rail');
    body.classList.toggle('con-chat-rail--expandida', expandida);
    return () => {
      body.classList.remove('con-chat-rail', 'con-chat-rail--expandida');
    };
  }, [barraFija, expandida]);

  // Al cambiar de pantalla se cierra el menú del celular.
  useEffect(() => {
    setDrawerAbierto(false);
  }, [pathname]);

  useEffect(() => {
    if (expandida && enfocarBuscador.current) {
      enfocarBuscador.current = false;
      buscadorRef.current?.focus();
    }
  }, [expandida]);

  const alternarExpandida = useCallback(() => {
    setExpandida((actual) => {
      const nueva = !actual;
      guardarExpandida(nueva);
      if (!nueva) setBusqueda('');
      return nueva;
    });
  }, []);

  const abrirBuscador = useCallback(() => {
    enfocarBuscador.current = true;
    setExpandida(true);
    guardarExpandida(true);
  }, []);

  const enCelularRef = useRef(enCelular);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    enCelularRef.current = enCelular;
    pathnameRef.current = pathname;
  }, [enCelular, pathname]);

  const onOpen = useCallback(
    (item: ChatRailItem) => {
      setDrawerAbierto(false);

      // En la página del chat: que ella misma lo abra, sin navegar. Si la
      // página lo atendió, cancela el evento (preventDefault).
      if (pathnameRef.current.startsWith('/process/chat')) {
        const evento = new CustomEvent(CHAT_RAIL_OPEN_EVENT, {
          detail: railOpenDetail(item),
          cancelable: true,
        });
        if (!window.dispatchEvent(evento)) {
          setOpenAgentId(null);
          return;
        }
      }

      if (item.kind === 'agent' && !enCelularRef.current && item.idAgent) {
        const id = item.idAgent;
        setOpenAgentId((actual) => (actual === id ? null : id));
        return;
      }

      setOpenAgentId(null);
      router.push(railItemHref(item));
    },
    [router]
  );

  const onTogglePin = pins.setPinned;

  if (!visible || !hayChats) return null;

  const avisoError = pins.error ? (
    <Alert
      color='red'
      variant='light'
      mx='sm'
      mb='xs'
      p='xs'
      role='alert'
      withCloseButton
      closeButtonLabel='Cerrar aviso'
      onClose={pins.clearError}
    >
      <Text size='xs'>{pins.error}</Text>
    </Alert>
  ) : null;

  const buscador = (
    <TextInput
      ref={buscadorRef}
      // 16 px (size md): con menos, Safari del iPhone hace zoom al enfocar
      // (ver la nota del compositor del chat).
      size='md'
      radius='xl'
      value={busqueda}
      onChange={(e) => setBusqueda(e.currentTarget.value)}
      placeholder='Buscar chat'
      aria-label='Buscar chat por nombre'
      leftSection={<IconSearch size={16} />}
      rightSection={
        busqueda ? (
          <CloseButton size='sm' aria-label='Limpiar búsqueda' onClick={() => setBusqueda('')} />
        ) : null
      }
      className='chat-rail__buscador'
    />
  );

  const lista = (expandidaLista: boolean) => (
    <RailList
      sections={sections}
      expandida={expandidaLista}
      pinnedSet={pins.pinnedSet}
      activeKey={activeKey}
      statusByAgent={overview.statusByAgent}
      puedeAnclar={pins.available}
      onOpen={onOpen}
      onTogglePin={onTogglePin}
      busqueda={busqueda}
    />
  );

  const enlaceChat = (conTexto: boolean) => (
    <Tooltip label='Abrir el chat completo' position='right' withArrow disabled={conTexto}>
      <Link href='/process/chat' className='chat-rail__pie-enlace' aria-label='Abrir el chat completo'>
        <IconMessages size={18} aria-hidden='true' />
        {conTexto && <span>Abrir el chat completo</span>}
      </Link>
    </Tooltip>
  );

  const panel = panelUsado && (
    <AgentChatPanel
      agent={openAgent}
      status={openAgent ? overview.statusByAgent.get(openAgent.idAgent) ?? null : null}
      opened={openAgent !== null}
      onClose={() => setOpenAgentId(null)}
    />
  );

  /* ── Celular: botón en la cabecera + menú deslizable ── */
  if (enCelular) {
    return (
      <>
        <Indicator
          label={formatUnread(pendientes)}
          size={16}
          disabled={pendientes === 0}
          color='red'
          offset={4}
        >
          <ActionIcon
            variant='subtle'
            color='gray'
            onClick={() => setDrawerAbierto(true)}
            aria-label={pendientes > 0 ? `Abrir chats, ${pendientes} sin leer` : 'Abrir chats'}
            aria-expanded={drawerAbierto}
            aria-controls='chat-rail-drawer'
          >
            <IconMessages size={20} />
          </ActionIcon>
        </Indicator>
        <Drawer
          id='chat-rail-drawer'
          opened={drawerAbierto}
          onClose={() => setDrawerAbierto(false)}
          position='left'
          size='min(85vw, 340px)'
          padding={0}
          title='Chats'
          closeButtonProps={{ 'aria-label': 'Cerrar chats' }}
          classNames={{ content: 'chat-rail chat-rail--drawer', header: 'chat-rail__drawer-cabecera' }}
        >
          <Box px='sm' pb='xs'>
            {buscador}
          </Box>
          {avisoError}
          <nav aria-label='Chats' className='chat-rail__nav'>
            {lista(true)}
          </nav>
          <div className='chat-rail__pie'>{enlaceChat(true)}</div>
        </Drawer>
        {panel}
      </>
    );
  }

  // Todavía no se sabe el ancho (primer render): no se pinta para no saltar.
  if (enCelular === undefined) return null;

  /* ── Escritorio: barra fija a la izquierda ── */
  const barra = (
    <aside
      className={`chat-rail chat-rail--fija${expandida ? ' chat-rail--expandida' : ''}`}
      aria-label='Chats'
    >
      <div className='chat-rail__cabecera'>
        {expandida && (
          <Text size='sm' fw={700} className='chat-rail__nombre'>
            Chats
          </Text>
        )}
        <Tooltip
          label={expandida ? 'Contraer' : 'Expandir'}
          position='right'
          withArrow
          openDelay={200}
        >
          <ActionIcon
            variant='subtle'
            color='gray'
            onClick={alternarExpandida}
            aria-label={expandida ? 'Contraer la barra de chats' : 'Expandir la barra de chats'}
            aria-expanded={expandida}
          >
            {expandida ? (
              <IconLayoutSidebarLeftCollapse size={20} />
            ) : (
              <IconLayoutSidebarLeftExpand size={20} />
            )}
          </ActionIcon>
        </Tooltip>
      </div>

      {expandida ? (
        <Box px='sm' pb='xs'>
          {buscador}
        </Box>
      ) : (
        <div className='chat-rail__cabecera chat-rail__cabecera--buscar'>
          <Tooltip label='Buscar chat' position='right' withArrow openDelay={200}>
            <ActionIcon
              variant='subtle'
              color='gray'
              onClick={abrirBuscador}
              aria-label='Buscar chat'
            >
              <IconSearch size={18} />
            </ActionIcon>
          </Tooltip>
        </div>
      )}

      {expandida && avisoError}

      <ScrollArea className='chat-rail__scroll' type='hover' scrollbarSize={6}>
        <nav aria-label='Chats'>{lista(expandida)}</nav>
      </ScrollArea>

      <div className='chat-rail__pie'>{enlaceChat(expandida)}</div>
    </aside>
  );

  return (
    <>
      {createPortal(barra, document.body)}
      {panel}
    </>
  );
}
