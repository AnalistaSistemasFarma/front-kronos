'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertCircle, IconDownload, IconMessage2 } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import AgentTaskTable from './AgentTaskTable';
import ChatComposer from './ChatComposer';
import ChatMarkdown from './ChatMarkdown';
import { useChatConversation } from './useChatConversation';
import {
  describeAgentStatus,
  formatChatTime,
  type ChatAgentDto,
  type ChatMessageDto,
} from '../../lib/chat/client';
import { formatBytes } from '../../lib/chat/attachments';

/**
 * El hilo de conversación: burbujas con Markdown real, indicador de qué está
 * haciendo el agente y la caja de escritura.
 *
 * VISUAL — de dónde sale y qué NO se copió
 * ----------------------------------------
 * La forma (ScrollArea con viewportRef, autoscroll al final, burbujas
 * `rounded-2xl` alineadas por autor) viene del historial de interacciones de
 * app/(hub)/process/request-general/view-request/page.tsx. Lo que NO se copió
 * son sus colores: allí están en duro (`bg-blue-400`, `bg-gray-100`,
 * `text-gray-800`) y no respetan el modo oscuro — una burbuja gris claro con
 * texto gris oscuro sobre fondo oscuro queda ilegible. Aquí todo sale de los
 * tokens --app-* de app/globals.css.
 */

/**
 * Adjuntos de un mensaje, como fichas descargables.
 *
 * El enlace apunta SIEMPRE a /api/chat/attachments/<id> (nunca a OneDrive):
 * ahí se vuelve a comprobar el permiso en cada descarga. Mientras el mensaje
 * está en vuelo el id todavía no existe, así que la ficha se muestra sin
 * enlace en vez de ofrecer una descarga que daría 404.
 */
function MessageAttachments({ message }: { message: ChatMessageDto }) {
  if (message.attachments.length === 0) return null;

  return (
    <Stack gap={4} mt={6}>
      {message.attachments.map((attachment) => {
        const content = (
          <>
            <IconDownload size={13} />
            <Text size='xs' lineClamp={1} className='chat-attachment__name'>
              {attachment.fileName}
            </Text>
            {attachment.sizeBytes !== null && (
              <Text size='xs' className='chat-attachment__size'>
                {formatBytes(attachment.sizeBytes)}
              </Text>
            )}
          </>
        );

        if (!attachment.downloadUrl) {
          return (
            <span key={attachment.id} className='chat-attachment'>
              {content}
            </span>
          );
        }

        return (
          <a
            key={attachment.id}
            href={attachment.downloadUrl}
            download={attachment.fileName}
            className='chat-attachment chat-attachment--link'
            title={`Descargar ${attachment.fileName}`}
          >
            {content}
          </a>
        );
      })}
    </Stack>
  );
}

function MessageBubble({ message, agent }: { message: ChatMessageDto; agent: ChatAgentDto }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <Center>
        <Box className='chat-bubble chat-bubble--system'>
          <ChatMarkdown content={message.body} />
          <MessageAttachments message={message} />
        </Box>
      </Center>
    );
  }

  return (
    <Group
      align='flex-end'
      gap='xs'
      justify={isUser ? 'flex-end' : 'flex-start'}
      wrap='nowrap'
    >
      {!isUser && (
        <Box style={{ flexShrink: 0 }}>
          <AgentAvatar
            code={agent.code}
            displayName={agent.displayName}
            avatarUrl={agent.avatarUrl}
            size={28}
            showStatus={false}
            withTooltip={false}
          />
        </Box>
      )}

      <Box
        className={[
          'chat-bubble',
          isUser ? 'chat-bubble--user' : 'chat-bubble--agent',
          message.pending ? 'chat-bubble--pending' : '',
          message.failed ? 'chat-bubble--failed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!isUser && (
          <Text size='xs' fw={600} className='chat-bubble__author'>
            {agent.displayName}
          </Text>
        )}

        {message.body.trim().length > 0 && <ChatMarkdown content={message.body} />}
        <MessageAttachments message={message} />

        <Text size='xs' className='chat-bubble__meta'>
          {message.failed
            ? 'No se pudo enviar'
            : message.pending
              ? 'Enviando…'
              : formatChatTime(message.createdAt)}
        </Text>
      </Box>
    </Group>
  );
}

/** Indicador de "qué está haciendo el agente" — lo que evita el efecto congelado. */
function AgentActivity({
  agent,
  status,
}: {
  agent: ChatAgentDto;
  status: Parameters<typeof describeAgentStatus>[0];
}) {
  const view = describeAgentStatus(status);
  if (!view.busy) return null;

  return (
    <Box role='status' aria-live='polite'>
      <Group gap='xs' align='center' className='chat-activity'>
        <AgentAvatar
          code={agent.code}
          displayName={agent.displayName}
          avatarUrl={agent.avatarUrl}
          size={24}
          showStatus={false}
          withTooltip={false}
        />
        <span className='chat-typing' aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <Text size='xs' className='chat-activity__label'>
          {view.label}
        </Text>
      </Group>

      {/* Solo aparece cuando el agente reporta sub-agentes trabajando. */}
      <AgentTaskTable tasks={status?.tasks} />
    </Box>
  );
}

export default function ChatThread({
  agent,
  active = true,
  height,
}: {
  agent: ChatAgentDto;
  /** El hilo está a la vista (marca leído y arranca el sondeo). */
  active?: boolean;
  /** Alto del área de mensajes. Sin valor, ocupa el espacio disponible. */
  height?: string | number;
}) {
  const thread = useChatConversation(agent.idAgent, active);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastCountRef = useRef(0);

  // Autoscroll al final SOLO si el usuario ya estaba abajo: si subió a leer
  // algo, un mensaje nuevo no debe arrancarle la vista.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const grew = thread.messages.length > lastCountRef.current;
    lastCountRef.current = thread.messages.length;
    if (!grew || !stickToBottom) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, [thread.messages, stickToBottom]);

  // Al abrir el hilo, al fondo sin animación.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || thread.loading) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [thread.loading, agent.idAgent]);

  const onScrollPositionChange = ({ y }: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceToBottom = viewport.scrollHeight - viewport.clientHeight - y;
    setStickToBottom(distanceToBottom < 80);
  };

  return (
    <Box className='chat-thread' style={height ? { height } : undefined}>
      <ScrollArea
        className='chat-thread__scroll'
        viewportRef={viewportRef}
        onScrollPositionChange={onScrollPositionChange}
        offsetScrollbars
      >
        <Stack gap='sm' p='sm'>
          {thread.hasOlder && (
            <Center>
              <Button
                size='xs'
                variant='subtle'
                loading={thread.loadingOlder}
                onClick={() => void thread.loadOlder()}
              >
                Ver mensajes anteriores
              </Button>
            </Center>
          )}

          {thread.loading && thread.messages.length === 0 && (
            <Center py='xl'>
              <Loader size='sm' />
            </Center>
          )}

          {!thread.loading && thread.messages.length === 0 && !thread.error && (
            <Center py='xl'>
              <Stack align='center' gap={6}>
                <IconMessage2 size={28} className='chat-empty__icon' />
                <Text size='sm' fw={600}>
                  Todavía no han hablado
                </Text>
                <Text size='xs' ta='center' className='chat-text-muted' maw={320}>
                  {agent.description ||
                    `Escríbale a ${agent.displayName} para empezar la conversación.`}
                </Text>
              </Stack>
            </Center>
          )}

          {thread.messages.map((message) => (
            <MessageBubble key={message.id} message={message} agent={agent} />
          ))}

          <AgentActivity agent={agent} status={thread.status} />
        </Stack>
      </ScrollArea>

      {thread.error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color='red'
          radius='md'
          mx='sm'
          mb='xs'
          py={6}
        >
          <Text size='xs'>{thread.error}</Text>
        </Alert>
      )}

      <Box className='chat-thread__composer'>
        <ChatComposer
          onSend={(body, files) => thread.send(body, files)}
          sending={thread.sending}
          disabled={thread.loading || thread.conversation === null}
          placeholder={`Escríbale a ${agent.displayName}…`}
        />
      </Box>
    </Box>
  );
}
