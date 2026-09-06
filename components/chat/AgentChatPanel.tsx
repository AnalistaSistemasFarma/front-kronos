'use client';

import Link from 'next/link';
import { ActionIcon, Affix, Box, Group, Paper, Text, Tooltip, Transition } from '@mantine/core';
import { IconArrowsMaximize, IconX } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import ChatThread from './ChatThread';
import { describeAgentStatus, type ChatAgentDto, type ChatStatusDto } from '../../lib/chat/client';

/**
 * Panel flotante del chat (esquina inferior derecha).
 *
 * Reusa la CÁSCARA visual del asistente que quedó en la rama
 * Implement-New-Agent (components/ai/AiAssistantChat.tsx): `Affix` +
 * `Transition` + `Paper` con encabezado, cuerpo desplazable y caja de
 * escritura. Lo que NO se reusó es su cerebro: aquel chat corría un modelo
 * dentro del navegador y no guardaba nada. Aquí el hilo vive en la base y del
 * otro lado hay un agente de la flota.
 */
export default function AgentChatPanel({
  agent,
  status,
  opened,
  onClose,
}: {
  agent: ChatAgentDto | null;
  status: ChatStatusDto | null;
  opened: boolean;
  onClose: () => void;
}) {
  const view = describeAgentStatus(status);

  return (
    <Affix position={{ bottom: 24, right: 24 }} zIndex={401}>
      <Transition mounted={opened && agent !== null} transition='pop-bottom-right' duration={180}>
        {(styles) =>
          agent ? (
            <Paper
              style={{
                ...styles,
                width: 'min(460px, calc(100vw - 32px))',
                height: 'min(640px, calc(100vh - 96px))',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              className='chat-panel'
              shadow='xl'
              radius='lg'
              withBorder
              role='dialog'
              aria-label={`Conversación con ${agent.displayName}`}
            >
              <Group
                justify='space-between'
                p='sm'
                wrap='nowrap'
                className='chat-panel__header'
              >
                <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
                  <AgentAvatar
                    code={agent.code}
                    displayName={agent.displayName}
                    avatarUrl={agent.avatarUrl}
                    status={status}
                    size={34}
                    withTooltip={false}
                  />
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={600} size='sm' lineClamp={1}>
                      {agent.displayName}
                    </Text>
                    <Text size='xs' lineClamp={1} className='chat-text-muted'>
                      {view.label}
                    </Text>
                  </Box>
                </Group>

                <Group gap={2} wrap='nowrap'>
                  <Tooltip label='Abrir en la página de chats' withArrow>
                    <ActionIcon
                      component={Link}
                      href={`/process/chat?agent=${encodeURIComponent(agent.code)}`}
                      variant='subtle'
                      color='gray'
                      onClick={onClose}
                      aria-label='Abrir en la página de chats'
                    >
                      <IconArrowsMaximize size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={onClose}
                    aria-label='Cerrar conversación'
                  >
                    <IconX size={18} />
                  </ActionIcon>
                </Group>
              </Group>

              <Box style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <ChatThread agent={agent} active={opened} />
              </Box>
            </Paper>
          ) : (
            <div />
          )
        }
      </Transition>
    </Affix>
  );
}
