'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  SimpleGrid,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconBuilding,
  IconFolderOff,
  IconLayoutGrid,
  IconList,
  IconMaximize,
  IconMinimize,
  IconSend,
  IconLock,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import ChatBroadcastModal from './ChatBroadcastModal';
import ChatThread from './ChatThread';
import { useChatOverview } from './useChatOverview';
import {
  describeAgentStatus,
  findAgentByRouteKey,
  formatChatTime,
  groupAgentsByCompany,
  toPlainPreview,
  type ChatAgentDto,
} from '../../lib/chat/client';

/**
 * Página de chats — /process/chat.
 *
 * Estructura pedida por Nicolás: CARPETAS AGRUPADAS POR EMPRESA, "porque hay
 * agentes de distintas empresas". La forma (búsqueda, agrupación, alternancia
 * cuadrícula/lista, tarjetas) sigue components/process/ProcessView.tsx, que es
 * el patrón del hub.
 *
 * ⚠️ REGLA DE PERMISOS QUE NO SE PUEDE ROMPER
 * Las carpetas se construyen con las empresas de los AGENTES PERMITIDOS
 * (`agent_company`, vía /api/chat/access), NUNCA con las empresas del usuario
 * (`company_user`). Si se derivaran del usuario, alguien con permiso explícito
 * sobre un agente de GSS pero sin fila de GSS no vería a ese agente: el permiso
 * existiría y la carpeta donde mostrarlo no. La agrupación vive en
 * groupAgentsByCompany() (lib/chat/client.ts).
 */

function AgentCard({
  agent,
  unread,
  statusLabel,
  lastPreview,
  lastAt,
  selected,
  compact,
  onSelect,
  status,
}: {
  agent: ChatAgentDto;
  unread: number;
  statusLabel: string;
  lastPreview: string | null;
  lastAt: string | null;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
  status: Parameters<typeof describeAgentStatus>[0];
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      className={[
        'chat-agent-card',
        compact ? 'chat-agent-card--compact' : '',
        selected ? 'chat-agent-card--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Abrir el chat con ${agent.displayName}`}
    >
      <Group gap='sm' wrap='nowrap' align='flex-start'>
        <AgentAvatar
          code={agent.code}
          displayName={agent.displayName}
          avatarUrl={agent.avatarUrl}
          unread={unread}
          status={status}
          size={compact ? 34 : 42}
          withTooltip={false}
        />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap='nowrap' justify='space-between'>
            <Text size='sm' fw={600} lineClamp={1}>
              {agent.displayName}
            </Text>
            {lastAt && (
              <Text size='xs' className='chat-text-muted' style={{ flexShrink: 0 }}>
                {formatChatTime(lastAt)}
              </Text>
            )}
          </Group>
          <Text size='xs' lineClamp={compact ? 1 : 2} className='chat-text-muted'>
            {lastPreview || agent.description || statusLabel}
          </Text>
          {!compact && (
            <Group gap={6} mt={6}>
              <Badge size='xs' variant='light' color={describeAgentStatus(status).color}>
                {statusLabel}
              </Badge>
              {agent.handle && (
                <Text size='xs' className='chat-text-muted'>
                  {agent.handle}
                </Text>
              )}
            </Group>
          )}
        </Box>
      </Group>
    </UnstyledButton>
  );
}

/** Clave de localStorage donde se recuerda el chat expandido en ESTE equipo */
const CHAT_EXPANDIDO_KEY = 'chat-escritorio-expandido';

export default function ChatWorkspace({ initialAgentCode }: { initialAgentCode?: string }) {
  const overview = useChatOverview();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedCode, setSelectedCode] = useState<string | null>(initialAgentCode ?? null);

  // En pantallas angostas las dos columnas de la rejilla se APILAN: la lista de
  // asistentes arriba y la conversación debajo. Al llegar desde una
  // notificación uno cae en la lista y la conversación queda fuera de la
  // pantalla, así que parece que no lo llevó a ninguna parte y toca volver a
  // tocar el agente. Ahí se pasa a maestro-detalle: con un agente elegido se
  // muestra SOLO la conversación, y la flecha del encabezado devuelve a las
  // carpetas. En pantalla ancha no cambia nada: siguen las dos columnas.
  const enPantallaAngosta = useMediaQuery('(max-width: 992px)');

  // Llegar por un ENLACE DIRECTO (la notificación, o /process/chat/<code>) no
  // es lo mismo que elegir un agente en la lista: el que llega por enlace ya
  // sabe con quién quiere hablar, así que la conversación se muestra sola y a
  // todo el ancho, sin la columna de carpetas al lado. Al tocar la flecha de
  // "volver a las carpetas" se sale de ese modo y la página se comporta como
  // siempre.
  const [soloConversacion, setSoloConversacion] = useState(Boolean(initialAgentCode));

  // Solo la conversación: por enlace directo, o en pantalla angosta con un
  // agente abierto (allí las dos columnas se apilan y la conversación quedaría
  // debajo de la lista, fuera de la vista).
  const conversacionSola = soloConversacion || Boolean(enPantallaAngosta && selectedCode);

  // ESCRITORIO con una conversación abierta: el chat ocupa la pantalla y la
  // lista de agentes se convierte en una barra lateral angosta con su propio
  // desplazamiento, como en cualquier aplicación de mensajería de escritorio.
  // Pedido de Nicolás. Sin conversación abierta la página sigue siendo la
  // rejilla de carpetas de siempre, que es donde uno escoge.
  const modoEscritorio = !enPantallaAngosta && !conversacionSola && Boolean(selectedCode);

  // Pantalla completa DE VERDAD en escritorio: también se esconde la barra de
  // SynerLink. Pedido de Nicolás (2026-09-08), y se hizo con un botón —no
  // siempre encendido— porque esconder esa barra deja la aplicación sin
  // navegación, y el chat lo usan otras trece personas que quizá sí la
  // quieren. Cada quien decide.
  //
  // Se recuerda en `localStorage` para no tener que pulsarlo en cada visita.
  // No va al perfil a propósito: es una comodidad del equipo desde el que uno
  // está trabajando, no una preferencia de la persona.
  // Mensaje masivo: solo para administradores (lo decidió Nicolás). El botón se
  // pinta con `overview.canBroadcast`, pero la reja de verdad está en el
  // endpoint: esconder un botón no protege nada.
  const [masivoAbierto, setMasivoAbierto] = useState(false);

  const [expandido, setExpandido] = useState(false);
  useEffect(() => {
    try {
      setExpandido(localStorage.getItem(CHAT_EXPANDIDO_KEY) === '1');
    } catch {
      // Modo privado o almacenamiento bloqueado: se queda sin expandir, que es
      // el comportamiento seguro (con navegación a la vista).
    }
  }, []);
  const alternarExpandido = () => {
    setExpandido((previo) => {
      const siguiente = !previo;
      try {
        localStorage.setItem(CHAT_EXPANDIDO_KEY, siguiente ? '1' : '0');
      } catch {}
      return siguiente;
    });
  };

  // Mientras dura ese modo la PÁGINA no se desplaza: el marco queda clavado a
  // la pantalla y lo único que corre es el interior de la barra lateral y el
  // de la conversación. Sin esto la página conserva su propio desplazamiento
  // detrás del marco fijo y la rueda del ratón mueve el fondo — que es
  // exactamente lo que se veía mal. La marca se quita SIEMPRE al salir.
  useEffect(() => {
    if (!modoEscritorio) return;
    document.body.classList.add('chat-escritorio-abierto');
    return () => {
      document.body.classList.remove('chat-escritorio-abierto');
    };
  }, [modoEscritorio]);

  // Modo inmersivo: mientras la conversación va sola se esconde la barra
  // superior de la aplicación (menú, avatares, campana). Pedido de Nicolás
  // para que al llegar por la notificación el chat ocupe la pantalla de
  // verdad.
  //
  // Se hace marcando el <body> y no desmontando nada, porque la barra la pinta
  // el armazón de la aplicación, muy por encima de este componente. La marca
  // se quita SIEMPRE al salir del modo o al desmontar: una barra de navegación
  // que se queda escondida deja la aplicación sin salida.
  //
  // Dos caminos llegan aquí: la conversación sola (celular o enlace directo) y
  // el escritorio con el botón de expandir pulsado.
  const inmersivo =
    (conversacionSola && Boolean(selectedCode)) || (modoEscritorio && expandido);
  useEffect(() => {
    if (!inmersivo) return;
    document.body.classList.add('chat-inmersivo');
    return () => {
      document.body.classList.remove('chat-inmersivo');
    };
  }, [inmersivo]);

  // El código del agente también puede llegar por la URL (?agent=orus), que es
  // lo que usa el botón "abrir en la página de chats" del panel flotante.
  useEffect(() => {
    const fromUrl = searchParams.get('agent');
    if (fromUrl) setSelectedCode(fromUrl);
  }, [searchParams]);

  const filteredAgents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return overview.agents;
    return overview.agents.filter(
      (agent) =>
        agent.displayName.toLowerCase().includes(query) ||
        (agent.handle ?? '').toLowerCase().includes(query) ||
        (agent.description ?? '').toLowerCase().includes(query) ||
        agent.companies.some((company) => company.companyName.toLowerCase().includes(query))
    );
  }, [overview.agents, search]);

  const folders = useMemo(() => groupAgentsByCompany(filteredAgents), [filteredAgents]);

  // `selectedCode` puede venir del `code` real, del nombre visible (así llega
  // /process/chat/orus) o del handle: findAgentByRouteKey los reconcilia.
  const selectedAgent = useMemo(
    () => findAgentByRouteKey(overview.agents, selectedCode),
    [overview.agents, selectedCode]
  );

  const selectAgent = (agent: ChatAgentDto) => {
    setSelectedCode(agent.code);
    // Se refleja en la URL para poder compartir/volver al mismo hilo, sin
    // recargar la página.
    router.replace(`/process/chat?agent=${encodeURIComponent(agent.code)}`, { scroll: false });
  };

  /* ───────────────────────────── Estados base ──────────────────────────── */

  if (!overview.ready) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <Center py='xl'>
          <Loader size='sm' />
        </Center>
      </div>
    );
  }

  if (!overview.canUseChat) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-3xl mx-auto py-10 px-4'>
          <Alert icon={<IconLock size={18} />} color='yellow' radius='lg' title='Sin acceso'>
            No tiene habilitado el módulo de Asistentes IA. Solicítelo a la administración de
            SynerLink para la empresa correspondiente.
          </Alert>
        </div>
      </div>
    );
  }

  const totalAgents = overview.agents.length;

  /* ─────────── Piezas que comparten los dos armazones de la página ──────── */

  // Las carpetas por empresa. `comoLista` las apila en una sola columna: es lo
  // que necesita la barra lateral del escritorio, donde no caben tarjetas de
  // dos columnas.
  const renderCarpetas = (comoLista: boolean) =>
    folders.length === 0 ? (
      <div className='ios-empty'>
        <div className='ios-empty__icon'>
          <IconFolderOff size={26} />
        </div>
        <h2 className='text-lg font-semibold mb-1'>
          {search ? 'Nada coincide con su búsqueda' : 'Aún no tiene asistentes'}
        </h2>
        <p className='ios-process-hub__subtitle mb-4'>
          {search
            ? 'Pruebe con otro nombre o limpie el filtro.'
            : 'Cuando le habiliten un asistente, aparecerá aquí.'}
        </p>
        {search && (
          <Button variant='light' size='xs' onClick={() => setSearch('')}>
            Limpiar búsqueda
          </Button>
        )}
      </div>
    ) : (
      folders.map((folder) => (
        <Box key={folder.idCompany} mb={comoLista ? 'md' : 'lg'} className='chat-folder'>
          <Group gap='xs' mb='sm' className='chat-folder__header'>
            <IconBuilding size={18} className='chat-folder__icon' />
            <Text fw={700} size='sm'>
              {folder.companyName}
            </Text>
            <Badge size='xs' variant='light' color='gray'>
              {folder.agents.length}
            </Badge>
          </Group>

          <SimpleGrid
            cols={
              comoLista || viewMode === 'list'
                ? 1
                : selectedAgent
                  ? { base: 1, sm: 2 }
                  : { base: 1, sm: 2, lg: 3 }
            }
            spacing='sm'
          >
            {folder.agents.map((agent) => {
              const conversation = overview.conversationByAgent.get(agent.idAgent) ?? null;
              const agentStatus = overview.statusByAgent.get(agent.idAgent) ?? null;
              return (
                <AgentCard
                  key={`${folder.idCompany}-${agent.idAgent}`}
                  agent={agent}
                  unread={overview.unreadByAgent.get(agent.idAgent) ?? 0}
                  statusLabel={describeAgentStatus(agentStatus).label}
                  status={agentStatus}
                  lastPreview={
                    conversation?.lastMessage
                      ? toPlainPreview(conversation.lastMessage.preview)
                      : null
                  }
                  lastAt={conversation?.lastMessageAt ?? null}
                  selected={selectedAgent?.idAgent === agent.idAgent}
                  compact={comoLista || viewMode === 'list' || Boolean(selectedAgent)}
                  onSelect={() => selectAgent(agent)}
                />
              );
            })}
          </SimpleGrid>
        </Box>
      ))
    );

  const pieDeLista =
    totalAgents > 0 ? (
      <Text size='xs' className='chat-text-muted'>
        {totalAgents === 1 ? '1 asistente disponible' : `${totalAgents} asistentes disponibles`}
      </Text>
    ) : null;

  const cerrarConversacion = () => {
    setSelectedCode(null);
    setSoloConversacion(false);
    router.replace('/process/chat', { scroll: false });
  };

  // El hilo con su encabezado. `clase` decide si va como tarjeta (la rejilla de
  // siempre) o como panel de borde a borde (escritorio y pantalla completa).
  const renderConversacion = (clase: string) =>
    selectedAgent ? (
      <Box className={clase}>
        <Group justify='space-between' p='sm' className='chat-panel__header' wrap='nowrap'>
          <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
            <AgentAvatar
              code={selectedAgent.code}
              displayName={selectedAgent.displayName}
              avatarUrl={selectedAgent.avatarUrl}
              status={overview.statusByAgent.get(selectedAgent.idAgent) ?? null}
              size={36}
              withTooltip={false}
            />
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} size='sm' lineClamp={1}>
                {selectedAgent.displayName}
              </Text>
              <Text size='xs' className='chat-text-muted' lineClamp={1}>
                {describeAgentStatus(overview.statusByAgent.get(selectedAgent.idAgent) ?? null).label}
              </Text>
            </Box>
          </Group>
          <Group gap={4} wrap='nowrap'>
            {/* Solo en escritorio: en el celular la barra ya se esconde sola y
                el botón no tendría nada que hacer. */}
            {modoEscritorio && (
              <Tooltip
                label={expandido ? 'Mostrar el menú de SynerLink' : 'Pantalla completa'}
                withArrow
              >
                <ActionIcon
                  variant='subtle'
                  color='gray'
                  onClick={alternarExpandido}
                  aria-label={
                    expandido ? 'Salir de pantalla completa' : 'Ver el chat en pantalla completa'
                  }
                  aria-pressed={expandido}
                >
                  {expandido ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label='Volver a las carpetas' withArrow>
              <ActionIcon
                variant='subtle'
                color='gray'
                onClick={cerrarConversacion}
                aria-label='Cerrar la conversación'
              >
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Sin `height`: el alto lo acota el contenedor, y dentro del hilo solo
            scrollea la lista de mensajes — el compositor queda fijo abajo. */}
        <ChatThread agent={selectedAgent} active />
      </Box>
    ) : null;

  /* ───────────── Armazón de ESCRITORIO: aplicación de mensajería ────────── */
  /* Marco clavado a la pantalla (debajo de la barra de SynerLink, que en
     escritorio SÍ se conserva porque es la navegación de toda la aplicación).
     Nada se desplaza salvo el interior de las dos columnas. */
  if (modoEscritorio && selectedAgent) {
    return (
      <div className='chat-escritorio'>
        <aside className='chat-escritorio__lateral'>
          <div className='chat-escritorio__buscador'>
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder='Buscar asistente…'
              leftSection={<IconSearch size={16} />}
              rightSection={
                search ? (
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={() => setSearch('')}
                    aria-label='Limpiar'
                  >
                    <IconX size={14} />
                  </ActionIcon>
                ) : null
              }
              radius='md'
              size='sm'
            />
          </div>
          <div className='chat-escritorio__lista'>
            {renderCarpetas(true)}
            {pieDeLista}
          </div>
        </aside>

        <section className='chat-escritorio__principal'>
          {renderConversacion('chat-page-thread chat-page-thread--panel')}
        </section>

        <ChatBroadcastModal
          opened={masivoAbierto}
          onClose={() => setMasivoAbierto(false)}
          agents={overview.agents}
          onEnviado={overview.refresh}
        />
      </div>
    );
  }

  /* ──────────────── Armazón normal: rejilla de carpetas ─────────────────── */

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div
        className={
          conversacionSola
            ? 'chat-page-shell--completa'
            : 'max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'
        }
      >
        <header className='mb-6' hidden={Boolean(conversacionSola && selectedAgent)}>
          <h1 className='ios-process-hub__title text-3xl sm:text-4xl mb-2'>Asistentes IA</h1>
          <p className='ios-process-hub__subtitle mb-5'>
            Sus asistentes, agrupados por empresa. Elija uno para conversar.
          </p>

          <Group gap='sm' wrap='nowrap'>
            <TextInput
              flex={1}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder='Buscar asistente o empresa…'
              leftSection={<IconSearch size={16} />}
              rightSection={
                search ? (
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={() => setSearch('')}
                    aria-label='Limpiar'
                  >
                    <IconX size={14} />
                  </ActionIcon>
                ) : null
              }
              radius='md'
            />
            {overview.canBroadcast && overview.agents.length > 1 && (
              <Tooltip label='Enviar un mensaje a varios asistentes' withArrow>
                <Button
                  variant='light'
                  radius='md'
                  leftSection={<IconSend size={16} />}
                  onClick={() => setMasivoAbierto(true)}
                >
                  Enviar a todos
                </Button>
              </Tooltip>
            )}

            <Group gap={4} wrap='nowrap'>
              <Tooltip label='Vista en tarjetas' withArrow>
                <ActionIcon
                  variant={viewMode === 'grid' ? 'filled' : 'subtle'}
                  color='gray'
                  size={36}
                  radius='md'
                  onClick={() => setViewMode('grid')}
                  aria-label='Vista en tarjetas'
                >
                  <IconLayoutGrid size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label='Vista en lista' withArrow>
                <ActionIcon
                  variant={viewMode === 'list' ? 'filled' : 'subtle'}
                  color='gray'
                  size={36}
                  radius='md'
                  onClick={() => setViewMode('list')}
                  aria-label='Vista en lista'
                >
                  <IconList size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </header>

        <Grid gutter='lg'>
          {/* Columna de carpetas */}
          {!(conversacionSola && selectedAgent) && (
            <Grid.Col span={{ base: 12, lg: selectedAgent ? 5 : 12 }}>
              {renderCarpetas(false)}
              {pieDeLista}
            </Grid.Col>
          )}

          {/* Columna del hilo */}
          {selectedAgent && (
            <Grid.Col span={{ base: 12, lg: conversacionSola ? 12 : 7 }}>
              {renderConversacion(
                `chat-page-thread${conversacionSola ? ' chat-page-thread--completa' : ''}`
              )}
            </Grid.Col>
          )}
        </Grid>
      </div>

      <ChatBroadcastModal
        opened={masivoAbierto}
        onClose={() => setMasivoAbierto(false)}
        agents={overview.agents}
        onEnviado={overview.refresh}
      />
    </div>
  );
}
