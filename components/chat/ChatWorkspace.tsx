'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Grid,
  Group,
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
  IconHierarchy2,
  IconMaximize,
  IconMinimize,
  IconSend,
  IconLock,
  IconPlus,
  IconSearch,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import { EsqueletoPantallaChat } from './ChatSkeletons';
import ChatBroadcastModal from './ChatBroadcastModal';
import ChatGroupModal from './ChatGroupModal';
import ChatThread from './ChatThread';
import { useChatOverview } from './useChatOverview';
import {
  describeAgentStatus,
  findAgentByRouteKey,
  formatChatTime,
  groupAgentsByCompany,
  toPlainPreview,
  type ChatAgentDto,
  type ChatConversationDto,
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
          working={agent.busy}
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

/**
 * Tarjeta de un GRUPO en la misma lista de los asistentes.
 *
 * Pedido de Nicolás (2026-09-08): "quiero ordenar es como la vista chat, pero
 * que ahí aparezcan los grupos también". Antes vivían en una pantalla aparte;
 * tener dos bandejas obliga a mirar en dos sitios para saber si le escribieron,
 * que es justo lo que un chat no debe hacer.
 *
 * Deliberadamente comparte las clases de `AgentCard` (`chat-agent-card`): en
 * una misma lista, dos tarjetas con estilos distintos se ven como un error.
 * Lo único distinto es el icono —un grupo no tiene una cara— y la línea de
 * abajo, que dice de qué empresa es y cuánta gente hay.
 */
function GroupCard({
  grupo,
  selected,
  compact,
  onSelect,
}: {
  grupo: ChatConversationDto;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const agentes = (grupo.participants ?? []).filter((p) => p.kind === 'agent');
  const personas = (grupo.participants ?? []).filter((p) => p.kind === 'user');
  const trabajando = (grupo.agentStatuses ?? []).filter((s) => s.state !== 'idle');

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
      aria-label={`Abrir el grupo ${grupo.title ?? ''}`}
    >
      <Group gap='sm' wrap='nowrap' align='flex-start'>
        <Box className='chat-grupo__icono' style={{ flexShrink: 0 }}>
          <IconUsersGroup size={compact ? 20 : 24} />
          {grupo.unreadCount > 0 && (
            <Badge size='xs' circle className='chat-grupo__contador'>
              {grupo.unreadCount}
            </Badge>
          )}
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap='nowrap' justify='space-between'>
            <Text size='sm' fw={600} lineClamp={1}>
              {grupo.title ?? 'Grupo'}
            </Text>
            {grupo.lastMessageAt && (
              <Text size='xs' className='chat-text-muted' style={{ flexShrink: 0 }}>
                {formatChatTime(grupo.lastMessageAt)}
              </Text>
            )}
          </Group>

          {trabajando.length > 0 ? (
            <Text size='xs' c='blue' lineClamp={1}>
              {trabajando.length === 1
                ? `${trabajando[0].agentName ?? 'Un asistente'} está trabajando…`
                : `${trabajando.length} asistentes trabajando…`}
            </Text>
          ) : grupo.lastMessage ? (
            <Text size='xs' className='chat-text-muted' lineClamp={1}>
              {toPlainPreview(grupo.lastMessage.preview)}
            </Text>
          ) : (
            <Text size='xs' className='chat-text-muted' lineClamp={1}>
              Sin mensajes todavía
            </Text>
          )}

          <Text size='xs' className='chat-text-muted' lineClamp={1}>
            {grupo.company?.companyName ?? 'Sin empresa'} · {personas.length}{' '}
            {personas.length === 1 ? 'persona' : 'personas'} · {agentes.length}{' '}
            {agentes.length === 1 ? 'asistente' : 'asistentes'}
          </Text>
        </Box>
      </Group>
    </UnstyledButton>
  );
}

export default function ChatWorkspace({
  initialAgentCode,
  initialGroupId,
}: {
  initialAgentCode?: string;
  /** Grupo a abrir de entrada: es lo que usa /process/chat/grupo/[id]. */
  initialGroupId?: number;
}) {
  const overview = useChatOverview();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // Quién soy. En un grupo es lo que distingue MIS mensajes de los de las otras
  // personas; sin esto, todo se pintaría alineado a la izquierda como ajeno.
  const miId = session?.user?.id;

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedCode, setSelectedCode] = useState<string | null>(initialAgentCode ?? null);
  // La selección es UNA sola cosa: un asistente o un grupo. Se guardan en dos
  // estados por comodidad, pero abrir uno siempre limpia el otro (ver
  // `selectAgent` y `selectGroup`): con los dos puestos a la vez, la pantalla
  // no sabría qué mostrar.
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(initialGroupId ?? null);
  const [grupoNuevoAbierto, setGrupoNuevoAbierto] = useState(false);

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
  const conversacionSola =
    soloConversacion || Boolean(enPantallaAngosta && (selectedCode || selectedGroupId));

  // ESCRITORIO con una conversación abierta: el chat ocupa la pantalla y la
  // lista de agentes se convierte en una barra lateral angosta con su propio
  // desplazamiento, como en cualquier aplicación de mensajería de escritorio.
  // Pedido de Nicolás. Sin conversación abierta la página sigue siendo la
  // rejilla de carpetas de siempre, que es donde uno escoge.
  const modoEscritorio =
    !enPantallaAngosta && !conversacionSola && Boolean(selectedCode || selectedGroupId);

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
    (conversacionSola && Boolean(selectedCode || selectedGroupId)) ||
    (modoEscritorio && expandido);
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
    if (fromUrl) {
      setSelectedCode(fromUrl);
      // Si venía un grupo abierto, se cierra: `?agent=` es una orden explícita
      // de abrir a ESE asistente.
      setSelectedGroupId(null);
    }
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
    // Abrir un asistente cierra el grupo que estuviera abierto: la selección es
    // una sola.
    setSelectedGroupId(null);
    // Se refleja en la URL para poder compartir/volver al mismo hilo, sin
    // recargar la página.
    router.replace(`/process/chat?agent=${encodeURIComponent(agent.code)}`, { scroll: false });
  };

  const selectGroup = (id: number) => {
    setSelectedGroupId(id);
    setSelectedCode(null);
    router.replace(`/process/chat/grupo/${id}`, { scroll: false });
  };

  // El grupo abierto, resuelto contra la bandeja. Se toma de ahí y no de un
  // estado propio para que el sondeo de la bandeja (cada 30 s) mantenga al día
  // sus integrantes y sus indicadores sin código extra.
  const selectedGroup = useMemo(
    () => overview.groups.find((g) => g.id === selectedGroupId) ?? null,
    [overview.groups, selectedGroupId]
  );

  // Grupos que pasan el filtro del buscador. Se busca por nombre, empresa e
  // integrantes: en un grupo, "¿dónde estaba eso que hablamos con Cali?" se
  // busca por el nombre de Cali, no por el del grupo.
  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return overview.groups;
    return overview.groups.filter(
      (g) =>
        (g.title ?? '').toLowerCase().includes(query) ||
        (g.company?.companyName ?? '').toLowerCase().includes(query) ||
        (g.participants ?? []).some((p) => p.name.toLowerCase().includes(query))
    );
  }, [overview.groups, search]);

  // Empresas donde el usuario tiene el módulo, sin repetir: es lo que necesita
  // el cuadro de crear grupo.
  const empresasDisponibles = useMemo(
    () =>
      overview.agents
        .flatMap((a) => a.companies)
        .filter((c, i, arr) => arr.findIndex((x) => x.idCompany === c.idCompany) === i),
    [overview.agents]
  );

  /* ───────────────────────────── Estados base ──────────────────────────── */

  if (!overview.ready) {
    return <EsqueletoPantallaChat />;
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
  /**
   * La carpeta de GRUPOS, que va ANTES de las de empresa.
   *
   * Arriba y no abajo a propósito: un grupo es de varias empresas a la vez en
   * la práctica (la gente de GSS hablando de Farmalógica), así que no cabe
   * dentro de ninguna carpeta de empresa sin mentir. Y arriba es donde uno
   * mira primero.
   *
   * Si el usuario no está en ningún grupo, la carpeta NO se pinta —salvo que
   * pueda crearlos, y entonces se muestra solo con el botón—: una carpeta
   * vacía permanente es ruido.
   */
  const renderGrupos = (comoLista: boolean) => {
    if (filteredGroups.length === 0 && !overview.canCreateGroups) return null;
    if (filteredGroups.length === 0 && search.trim() !== '') return null;

    return (
      <Box mb={comoLista ? 'md' : 'lg'} className='chat-folder'>
        <Group gap='xs' mb='sm' className='chat-folder__header' wrap='nowrap'>
          <IconUsersGroup size={18} className='chat-folder__icon' />
          <Text fw={700} size='sm'>
            Grupos
          </Text>
          {filteredGroups.length > 0 && (
            <Badge size='xs' variant='light' color='gray'>
              {filteredGroups.length}
            </Badge>
          )}
          {overview.groupUnread > 0 && (
            <Badge size='xs' color='red'>
              {overview.groupUnread}
            </Badge>
          )}
          {overview.canCreateGroups && (
            <Tooltip label='Crear un grupo' withArrow>
              <ActionIcon
                variant='subtle'
                color='gray'
                size='sm'
                ml='auto'
                onClick={() => setGrupoNuevoAbierto(true)}
                aria-label='Crear un grupo'
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        {filteredGroups.length === 0 ? (
          <Text size='xs' className='chat-text-muted'>
            Todavía no hay grupos. Cree uno con el <b>+</b>.
          </Text>
        ) : (
          <SimpleGrid
            cols={
              comoLista || viewMode === 'list'
                ? 1
                : selectedAgent || selectedGroup
                  ? { base: 1, sm: 2 }
                  : { base: 1, sm: 2, lg: 3 }
            }
            spacing='sm'
          >
            {filteredGroups.map((grupo) => (
              <GroupCard
                key={grupo.id}
                grupo={grupo}
                selected={selectedGroupId === grupo.id}
                compact={comoLista || viewMode === 'list' || Boolean(selectedAgent || selectedGroup)}
                onSelect={() => selectGroup(grupo.id)}
              />
            ))}
          </SimpleGrid>
        )}
      </Box>
    );
  };

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
                  compact={
                    comoLista || viewMode === 'list' || Boolean(selectedAgent || selectedGroup)
                  }
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
    setSelectedGroupId(null);
    setSoloConversacion(false);
    router.replace('/process/chat', { scroll: false });
  };

  // Se define una sola vez y se monta en los dos armazones (escritorio y
  // rejilla): duplicar el cuadro llevaría a que uno de los dos se quede sin
  // los arreglos del otro.
  const modalDeGrupo = overview.canCreateGroups ? (
    <ChatGroupModal
      abierto={grupoNuevoAbierto}
      onCerrar={() => setGrupoNuevoAbierto(false)}
      companies={empresasDisponibles}
      onCreado={(grupo) => {
        setGrupoNuevoAbierto(false);
        // La bandeja se refresca para que el grupo nuevo aparezca en la lista,
        // y de una se abre: acabar de crearlo y tener que buscarlo sería raro.
        overview.refresh();
        selectGroup(grupo.id);
      }}
    />
  ) : null;

  // Los dos botones de la derecha del encabezado. Iguales para el hilo de un
  // asistente y para el de un grupo: un encabezado que cambia de botones según
  // lo que uno abrió se siente como dos pantallas distintas.
  const botonesDelEncabezado = (
    <Group gap={4} wrap='nowrap'>
      {/* Solo en escritorio: en el celular la barra ya se esconde sola y el
          botón no tendría nada que hacer. */}
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
  );

  /**
   * El hilo de un GRUPO, con el mismo marco que el de un asistente.
   *
   * El encabezado dice quién está: en un grupo, "con quién estoy hablando" no
   * se resuelve con una foto y un nombre. Y debajo, una línea por cada
   * asistente que esté trabajando — sin eso, el usuario no sabe si le va a
   * contestar el que le importa.
   */
  const renderGrupo = (clase: string) => {
    if (!selectedGroup) return null;

    const agentes = (selectedGroup.participants ?? []).filter((p) => p.kind === 'agent');
    const personas = (selectedGroup.participants ?? []).filter((p) => p.kind === 'user');

    return (
      <Box className={clase}>
        <Group justify='space-between' p='sm' className='chat-panel__header' wrap='nowrap'>
          <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
            <Box className='chat-grupo__icono chat-grupo__icono--grande' style={{ flexShrink: 0 }}>
              <IconUsersGroup size={22} />
            </Box>
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} size='sm' lineClamp={1}>
                {selectedGroup.title ?? 'Grupo'}
              </Text>
              <Text size='xs' className='chat-text-muted' lineClamp={1}>
                {selectedGroup.company?.companyName ?? 'Sin empresa'} · {personas.length}{' '}
                {personas.length === 1 ? 'persona' : 'personas'} ·{' '}
                {agentes.map((a) => a.name).join(', ') || 'sin asistentes'}
              </Text>
            </Box>
          </Group>
          {botonesDelEncabezado}
        </Group>

        <ChatThread
          group={{
            idConversation: selectedGroup.id,
            title: selectedGroup.title ?? 'Grupo',
            participants: selectedGroup.participants,
          }}
          currentUserId={miId}
          active
        />
      </Box>
    );
  };

  // El hilo con su encabezado. `clase` decide si va como tarjeta (la rejilla de
  // siempre) o como panel de borde a borde (escritorio y pantalla completa).
  const renderConversacion = (clase: string) =>
    selectedGroup ? (
      renderGrupo(clase)
    ) : selectedAgent ? (
      <Box className={clase}>
        <Group justify='space-between' p='sm' className='chat-panel__header' wrap='nowrap'>
          <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
            <AgentAvatar
              code={selectedAgent.code}
              working={selectedAgent.busy}
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
          {botonesDelEncabezado}
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
  // "Hay algo abierto": un asistente o un grupo. A partir de aquí la pantalla
  // se comporta igual con los dos.
  const hayAlgoAbierto = Boolean(selectedAgent || selectedGroup);

  if (modoEscritorio && hayAlgoAbierto) {
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
            {renderGrupos(true)}
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

        {modalDeGrupo}
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
        <header className='mb-6' hidden={Boolean(conversacionSola && hayAlgoAbierto)}>
          <h1 className='ios-process-hub__title text-3xl sm:text-4xl mb-2'>Asistentes IA</h1>
          <p className='ios-process-hub__subtitle mb-5'>
            Sus asistentes agrupados por empresa, y sus grupos. Elija uno para conversar.
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
            {overview.canBroadcast && (
              <Tooltip label='Ver el organigrama de la flota' withArrow>
                <Button
                  variant='subtle'
                  color='gray'
                  radius='md'
                  leftSection={<IconHierarchy2 size={16} />}
                  component={Link}
                  href='/process/chat/organigrama'
                >
                  Organigrama
                </Button>
              </Tooltip>
            )}

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
          {!(conversacionSola && hayAlgoAbierto) && (
            <Grid.Col span={{ base: 12, lg: hayAlgoAbierto ? 5 : 12 }}>
              {renderGrupos(false)}
              {renderCarpetas(false)}
              {pieDeLista}
            </Grid.Col>
          )}

          {/* Columna del hilo */}
          {hayAlgoAbierto && (
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

      {modalDeGrupo}
    </div>
  );
}
