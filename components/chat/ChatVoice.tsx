'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconMicrophone, IconPhoneOff } from '@tabler/icons-react';
import { useVoiceCall } from './useVoiceCall';

/**
 * Mic button of the composer. The call itself is app-level (useVoiceCall):
 * unmounting this button (leaving the chat, switching conversation, closing
 * the floating panel) never hangs up. The floating <VoiceCallBar> keeps the
 * controls at hand anywhere in SynerLink.
 */
export default function ChatVoice({ conversationId }: { conversationId: number }) {
  const call = useVoiceCall();
  const [opened, setOpened] = useState(false);
  const here = call.conversationId === conversationId;
  const state = here ? call.status : 'idle';
  const elsewhere = !here && call.status !== 'idle';
  const error = here ? call.error : '';
  useEffect(() => { if (error) setOpened(true); }, [error]);
  const session = call.session;
  // While this conversation is on screen, its mic is the call control and the floating bar steps aside.
  useEffect(() => session?.attachInline(conversationId), [session, conversationId]);

  const start = () => {
    if (call.status !== 'idle') return;
    void call.session?.start(conversationId, window.location.pathname + window.location.search);
  };
  const label = state === 'connecting' ? 'Conectando…' : state === 'connected' ? 'Controles de llamada' : 'Hablar en tiempo real';
  return <Popover opened={opened} onChange={setOpened} position='top-end' width={280} withArrow withinPortal>
    <Popover.Target>
      <Tooltip label={label} disabled={opened} withArrow>
        <ActionIcon size={34} radius='xl' variant={state === 'idle' ? 'subtle' : 'light'} color={state === 'connected' ? 'green' : 'blue'}
          aria-label={label} aria-expanded={opened} onClick={() => {
            setOpened(!opened);
            if (state === 'idle' && !elsewhere) start();
          }}>
          <IconMicrophone size={20} />
        </ActionIcon>
      </Tooltip>
    </Popover.Target>
    <Popover.Dropdown>
      <Stack gap='xs'>
        <Text size='sm' fw={600} role='status'>{elsewhere ? 'Llamada activa en otra conversación' : state === 'connecting' ? 'Conectando…' : state === 'connected' ? 'Voz conectada' : 'Hablar en tiempo real'}</Text>
        <Group gap='xs'>
          {state === 'idle' && !elsewhere && <Button size='xs' variant='light' onClick={start}>Iniciar llamada</Button>}
          {(state !== 'idle' || elsewhere) && <Button size='xs' color='red' variant='light' leftSection={<IconPhoneOff size={16} />} onClick={() => call.session?.hangUp()}>Colgar</Button>}
          {state === 'connected' && <Button size='xs' variant='subtle' aria-pressed={call.muted} onClick={() => call.session?.toggleMute()}>
            {call.muted ? 'Activar micrófono' : 'Silenciar'}</Button>}
        </Group>
        <Text size='xs' c='dimmed'>Voz IA · Máximo 10 minutos. Puede seguir trabajando en otras secciones: la llamada continúa.</Text>
        {error && <Alert color='orange' role='alert' withCloseButton onClose={() => call.session?.dismissError()}>{error}</Alert>}
      </Stack>
    </Popover.Dropdown>
  </Popover>;
}
