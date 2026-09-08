'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  ActionIcon,
  Box,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import { useTituloDeEstado } from './useTituloDeEstado';
import AgentChatPanel from './AgentChatPanel';
import { useChatOverview } from './useChatOverview';
import {
  AGENT_BAR_VISIBLE,
  describeAgentStatus,
  sortAgentsForBar,
  type ChatAgentDto,
} from '../../lib/chat/client';

/**
 * Avatares de los agentes en la barra superior — UN AVATAR POR AGENTE.
 *
 * Nicolás eligió explícitamente esta opción (en vez de un solo icono con una
 * lista dentro): cada agente con su cara, su contador de mensajes sin leer y
 * su indicador de estado, y al hacer clic se abre el chat con ese agente.
 *
 * Sigue la FORMA de components/NotificationBell.tsx, que es el patrón aprobado
 * de esta cabecera:
 *   - `Indicator` de Mantine para el contador.
 *   - `Popover` de 400 px + `ScrollArea` para lo que no cabe.
 *   - Sondeo que se PAUSA con la pestaña oculta (en useChatOverview).
 *   - Marcador deshabilitado mientras carga la sesión, para no provocar un
 *     salto de la barra ni un error de hidratación.
 *
 * Cuando el usuario tiene más de cinco agentes, el orden se vuelve DINÁMICO y
 * los que tienen mensajes pendientes se van al frente (ver sortAgentsForBar);
 * con pocos, el orden se queda quieto para que nadie tenga que buscar un
 * avatar que se movió solo.
 */
export default function ChatAgentBar() {
  const { status } = useSession();
  const overview = useChatOverview();
  const [mounted, setMounted] = useState(false);
  const [openAgentId, setOpenAgentId] = useState<number | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // El estado de los asistentes también se cuenta en la PESTAÑA del navegador.
  // Va aquí porque esta barra vive en el encabezado de toda la aplicación: así
  // se ve desde cualquier pantalla. El hook se llama SIEMPRE, antes de
  // cualquier retorno temprano, porque las reglas de los hooks no admiten
  // llamadas condicionales.
  useTituloDeEstado(overview.agents, overview.statusByAgent, overview.totalUnread);

  const ordered = useMemo(
    () => sortAgentsForBar(overview.agents, overview.unreadByAgent),
    [overview.agents, overview.unreadByAgent]
  );

  const visible = ordered.slice(0, AGENT_BAR_VISIBLE);
  const overflow = ordered.slice(AGENT_BAR_VISIBLE);

  const overflowUnread = useMemo(
    () => overflow.reduce((total, agent) => total + (overview.unreadByAgent.get(agent.idAgent) ?? 0), 0),
    [overflow, overview.unreadByAgent]
  );

  const openAgent = useMemo(
    () => ordered.find((agent) => agent.idAgent === openAgentId) ?? null,
    [ordered, openAgentId]
  );

  // Antes de montar (o sin sesión / sin permiso) no se pinta nada: la barra es
  // opcional y no debe reservar espacio ni parpadear.
  if (!mounted || status !== 'authenticated') return null;
  if (!overview.canUseChat || ordered.length === 0) return null;

  const handleClick = (agent: ChatAgentDto) => {
    setOverflowOpen(false);
    setOpenAgentId((current) => (current === agent.idAgent ? null : agent.idAgent));
  };

  return (
    <>
      <Group gap={2} wrap='nowrap' className='chat-agent-bar' aria-label='Asistentes'>
        {visible.map((agent) => {
          const unread = overview.unreadByAgent.get(agent.idAgent) ?? 0;
          const agentStatus = overview.statusByAgent.get(agent.idAgent) ?? null;
          return (
            <UnstyledButton
              key={agent.idAgent}
              onClick={() => handleClick(agent)}
              className={[
                'chat-agent-bar__item',
                openAgentId === agent.idAgent ? 'chat-agent-bar__item--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={`Chat con ${agent.displayName}${unread > 0 ? `, ${unread} sin leer` : ''}`}
            >
              <AgentAvatar
                code={agent.code}
                displayName={agent.displayName}
                avatarUrl={agent.avatarUrl}
                unread={unread}
                status={agentStatus}
                size={32}
              />
            </UnstyledButton>
          );
        })}

        {overflow.length > 0 && (
          <Popover
            opened={overflowOpen}
            onChange={setOverflowOpen}
            position='bottom-end'
            width={400}
            withArrow
            shadow='md'
          >
            <Popover.Target>
              <Indicator
                label={overflowUnread > 99 ? '99+' : overflowUnread}
                size={16}
                disabled={overflowUnread === 0}
                color='red'
                offset={4}
              >
                <Tooltip label={`Otros ${overflow.length} asistentes`} withArrow>
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={() => setOverflowOpen((o) => !o)}
                    aria-label='Ver los demás asistentes'
                  >
                    <IconDotsVertical size={18} />
                  </ActionIcon>
                </Tooltip>
              </Indicator>
            </Popover.Target>

            <Popover.Dropdown p={0} className='chat-surface'>
              <Box px='md' pt='sm' pb='xs'>
                <Text size='sm' fw={600}>
                  Otros asistentes
                </Text>
              </Box>
              <ScrollArea.Autosize mah={360}>
                <ul className='list-none m-0 p-0'>
                  {overflow.map((agent) => {
                    const unread = overview.unreadByAgent.get(agent.idAgent) ?? 0;
                    const agentStatus = overview.statusByAgent.get(agent.idAgent) ?? null;
                    const view = describeAgentStatus(agentStatus);
                    return (
                      <li key={agent.idAgent}>
                        <UnstyledButton
                          w='100%'
                          onClick={() => handleClick(agent)}
                          className='chat-list-row'
                        >
                          <Group gap='sm' wrap='nowrap' px='md' py='sm'>
                            <AgentAvatar
                              code={agent.code}
                              displayName={agent.displayName}
                              avatarUrl={agent.avatarUrl}
                              unread={unread}
                              status={agentStatus}
                              size={34}
                              withTooltip={false}
                            />
                            <Box style={{ flex: 1, minWidth: 0 }}>
                              <Text size='sm' fw={600} lineClamp={1}>
                                {agent.displayName}
                              </Text>
                              <Text size='xs' lineClamp={1} className='chat-text-muted'>
                                {view.label}
                              </Text>
                            </Box>
                          </Group>
                        </UnstyledButton>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea.Autosize>
            </Popover.Dropdown>
          </Popover>
        )}
      </Group>

      <AgentChatPanel
        agent={openAgent}
        status={openAgent ? overview.statusByAgent.get(openAgent.idAgent) ?? null : null}
        opened={openAgent !== null}
        onClose={() => setOpenAgentId(null)}
      />
    </>
  );
}
