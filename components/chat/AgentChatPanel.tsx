'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ActionIcon, Affix, Box, Group, Paper, Text, Tooltip, Transition } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowLeft, IconArrowsMaximize, IconX } from '@tabler/icons-react';
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

  // En el celular el panel flotante de 460 px queda como una ventanita con
  // márgenes y hay que hacer scroll de página para llegar a escribir. Ahí el
  // chat pasa a PANTALLA COMPLETA, al estilo de las aplicaciones de mensajería:
  // encabezado fijo, mensajes ocupando todo el alto y el compositor pegado
  // abajo. En escritorio no cambia nada.
  const enPantallaPequena = useMediaQuery('(max-width: 768px)');
  const aPantallaCompleta = Boolean(enPantallaPequena) && opened && agent !== null;

  // Con el chat a pantalla completa, el documento de atrás no debe desplazarse:
  // si no, el "rebote" del scroll de la página se lleva el teclado y el
  // compositor. Se restaura siempre al cerrar o al desmontar.
  useEffect(() => {
    if (!aPantallaCompleta) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, [aPantallaCompleta]);

  return (
    <Affix
      position={
        aPantallaCompleta ? { top: 0, right: 0, bottom: 0, left: 0 } : { bottom: 24, right: 24 }
      }
      zIndex={401}
    >
      <Transition
        mounted={opened && agent !== null}
        transition={aPantallaCompleta ? 'slide-up' : 'pop-bottom-right'}
        duration={180}
      >
        {(styles) =>
          agent ? (
            <Paper
              style={{
                ...styles,
                // dvh y no vh en los dos casos: con el teclado del móvil
                // abierto, `vh` sigue midiendo la pantalla completa y el
                // compositor queda debajo, tapado.
                width: aPantallaCompleta ? '100vw' : 'min(460px, calc(100vw - 32px))',
                // `--alto-visible` la publica useAltoVisible desde el visual
                // viewport, que es lo único que se encoge cuando sale el teclado
                // del celular. Sin eso el compositor queda debajo del teclado.
                height: aPantallaCompleta
                  ? 'var(--alto-visible, 100dvh)'
                  : 'min(640px, calc(100dvh - 96px))',
                borderRadius: aPantallaCompleta ? 0 : undefined,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              className='chat-panel'
              shadow='xl'
              radius={aPantallaCompleta ? 0 : 'lg'}
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
                  {aPantallaCompleta && (
                    <ActionIcon
                      variant='subtle'
                      color='gray'
                      onClick={onClose}
                      aria-label='Volver'
                    >
                      <IconArrowLeft size={20} />
                    </ActionIcon>
                  )}
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
                  {/* A pantalla completa no tiene sentido "maximizar" ni una
                      segunda X: la flecha de la izquierda ya cierra. */}
                  {!aPantallaCompleta && (
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
                  )}
                  {!aPantallaCompleta && (
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={onClose}
                    aria-label='Cerrar conversación'
                  >
                    <IconX size={18} />
                  </ActionIcon>
                  )}
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
